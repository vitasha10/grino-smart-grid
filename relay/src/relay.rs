//! Relay "phone remote -> presentation screen" for the team #27 Grino pitch deck
//! (GreenTech Academy Hackathon, Yerevan, October 2026). In-memory only: no database,
//! no files, no personal data.
//!
//! A subset of the ntfy.sh API plus a two-way WebSocket:
//!   * `POST|PUT /grino/{topic}` — body = message text (<= 4 KB) -> JSON message;
//!   * `GET /grino/{topic}/json?poll=1&since=...[&wait=N]` — NDJSON of messages after `since`
//!     (long-poll up to 25 s with `wait`);
//!   * `GET /grino/{topic}/json` — NDJSON stream (open, messages, keepalive);
//!   * `GET /grino/{topic}/sse` — Server-Sent Events (message events have no `event:` line);
//!   * `GET /grino/{topic}/ws[?since=...]` — WebSocket: server sends the same JSON objects
//!     (open, messages, keepalive every 25 s); every text frame from a client is published to
//!     the same topic and is not echoed back to its sender.
//!
//! `since`: `all` | message id (`g42`) | unix time | duration (`30s`, `10m`, `2h`).
//! Limits: topic `[a-z0-9_-]{1,64}`, <= 4096 topics (only topics without live subscribers are
//! evicted), <= 200 messages per topic, kept 12 h. Topics act as shared secrets; put a rate
//! limit in the reverse proxy in front.

use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path, Query,
    },
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const MAX_TOPICS: usize = 4096;
const MAX_MSGS: usize = 200;
const MAX_BODY: usize = 4096;
const TTL_SECS: i64 = 12 * 3600;
const MAX_WAIT_SECS: u64 = 25;
const KEEPALIVE_SECS: u64 = 25;

/// Секция `[grino_relay]`. Опциональна: без неё релей включён.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct GrinoRelayConfig {
    pub enabled: bool,
}

impl Default for GrinoRelayConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Clone, Debug, Serialize)]
struct Msg {
    id: String,
    time: i64,
    event: &'static str,
    topic: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip)]
    seq: u64,
    /// id WebSocket-соединения-отправителя (0 = HTTP): своё сообщение ему не эхом.
    #[serde(skip)]
    from: u64,
}

impl Msg {
    fn control(event: &'static str, topic: &str) -> Self {
        Self { id: next_id(), time: now(), event, topic: topic.to_string(), message: None, seq: 0, from: 0 }
    }
}

struct Topic {
    msgs: VecDeque<Msg>,
    tx: broadcast::Sender<Msg>,
    last_used: Instant,
}

struct Relay {
    topics: Mutex<HashMap<String, Topic>>,
}

static RELAY: OnceLock<Relay> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);

fn relay() -> &'static Relay {
    RELAY.get_or_init(|| Relay { topics: Mutex::new(HashMap::new()) })
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn next_seq() -> u64 {
    SEQ.fetch_add(1, Ordering::Relaxed) + 1
}

fn next_id() -> String {
    format!("g{}", next_seq())
}

fn valid_topic(t: &str) -> bool {
    !t.is_empty()
        && t.len() <= 64
        && t.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

#[derive(Debug, PartialEq)]
enum Since {
    /// Только новые (нет параметра).
    New,
    All,
    AfterSeq(u64),
    AfterTime(i64),
}

fn parse_since(s: Option<&str>, now: i64) -> Since {
    let Some(s) = s.map(str::trim).filter(|s| !s.is_empty()) else {
        return Since::New;
    };
    if s.eq_ignore_ascii_case("all") {
        return Since::All;
    }
    if let Some(n) = s.strip_prefix('g').and_then(|r| r.parse::<u64>().ok()) {
        return Since::AfterSeq(n);
    }
    if let Ok(ts) = s.parse::<i64>() {
        return Since::AfterTime(ts);
    }
    // Последний символ — единица; char_indices, чтобы «10м» (кириллица) не резал UTF-8.
    let (cut, unit) = s.char_indices().last().unwrap_or((0, ' '));
    if let Ok(n) = s[..cut].parse::<i64>() {
        let mult = match unit {
            's' => Some(1),
            'm' => Some(60),
            'h' => Some(3600),
            _ => None,
        };
        if let Some(m) = mult {
            return Since::AfterTime(now - n.saturating_mul(m));
        }
    }
    Since::All
}

fn matches(m: &Msg, since: &Since) -> bool {
    match since {
        Since::New => false,
        Since::All => true,
        Since::AfterSeq(n) => m.seq > *n,
        Since::AfterTime(t) => m.time >= *t,
    }
}

impl Relay {
    /// Топик (создать при необходимости) + чистка просроченного; под замком.
    fn with_topic<R>(&self, name: &str, f: impl FnOnce(&mut Topic) -> R) -> R {
        let mut map = self.topics.lock().unwrap_or_else(|e| e.into_inner());
        if !map.contains_key(name) && map.len() >= MAX_TOPICS {
            // Evict the least recently used topic WITHOUT live subscribers; topics someone
            // is listening to are never evicted (a flood of new topics cannot kick the deck off).
            if let Some(oldest) = map
                .iter()
                .filter(|(_, t)| t.tx.receiver_count() == 0)
                .min_by_key(|(_, t)| t.last_used)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest);
            }
        }
        let topic = map.entry(name.to_string()).or_insert_with(|| Topic {
            msgs: VecDeque::new(),
            tx: broadcast::channel(256).0,
            last_used: Instant::now(),
        });
        topic.last_used = Instant::now();
        let cutoff = now() - TTL_SECS;
        while topic.msgs.front().is_some_and(|m| m.time < cutoff) {
            topic.msgs.pop_front();
        }
        f(topic)
    }

    fn publish(&self, topic: &str, text: String, from: u64) -> Msg {
        self.with_topic(topic, |t| {
            let seq = next_seq();
            let msg = Msg {
                id: format!("g{seq}"),
                time: now(),
                event: "message",
                topic: topic.to_string(),
                message: Some(text),
                seq,
                from,
            };
            t.msgs.push_back(msg.clone());
            while t.msgs.len() > MAX_MSGS {
                t.msgs.pop_front();
            }
            // Нет подписчиков — не ошибка: сообщение ждёт в истории.
            let _ = t.tx.send(msg.clone());
            msg
        })
    }

    /// История после `since` + подписка, атомарно (ничего не теряется между ними).
    fn backlog_and_subscribe(&self, topic: &str, since: &Since) -> (Vec<Msg>, broadcast::Receiver<Msg>) {
        self.with_topic(topic, |t| {
            let backlog = t.msgs.iter().filter(|m| matches(m, since)).cloned().collect();
            (backlog, t.tx.subscribe())
        })
    }
}

#[derive(Deserialize, Default)]
struct SubQuery {
    since: Option<String>,
    poll: Option<String>,
    wait: Option<u64>,
}

fn is_on(v: &Option<String>) -> bool {
    matches!(v.as_deref(), Some("1") | Some("true") | Some("yes") | Some(""))
}

fn bad_topic() -> Response {
    (StatusCode::BAD_REQUEST, "topic: [a-z0-9_-]{1,64}\n").into_response()
}

fn ndjson(msgs: &[Msg]) -> String {
    let mut out = String::new();
    for m in msgs {
        out.push_str(&serde_json::to_string(m).unwrap_or_default());
        out.push('\n');
    }
    out
}

async fn publish(Path(topic): Path<String>, body: Bytes) -> Response {
    if !valid_topic(&topic) {
        return bad_topic();
    }
    let Ok(text) = String::from_utf8(body.to_vec()) else {
        return (StatusCode::BAD_REQUEST, "body: UTF-8 text\n").into_response();
    };
    let msg = relay().publish(&topic, text, 0);
    (
        [(header::CACHE_CONTROL, "no-store")],
        axum::Json(msg),
    )
        .into_response()
}

async fn sub_json(Path(topic): Path<String>, Query(q): Query<SubQuery>) -> Response {
    if !valid_topic(&topic) {
        return bad_topic();
    }
    let since = parse_since(q.since.as_deref(), now());
    let (mut backlog, mut rx) = relay().backlog_and_subscribe(&topic, &since);
    if is_on(&q.poll) {
        let wait = q.wait.unwrap_or(0).min(MAX_WAIT_SECS);
        if backlog.is_empty() && wait > 0 {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(wait);
            loop {
                match tokio::time::timeout_at(deadline, rx.recv()).await {
                    Ok(Ok(m)) => {
                        backlog.push(m);
                        // Пачка подряд опубликованных — одним ответом.
                        while let Ok(m) = rx.try_recv() {
                            backlog.push(m);
                        }
                        break;
                    }
                    Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                    Ok(Err(broadcast::error::RecvError::Closed)) | Err(_) => break,
                }
            }
        }
        return (
            [
                (header::CONTENT_TYPE, "application/x-ndjson; charset=utf-8"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            ndjson(&backlog),
        )
            .into_response();
    }
    stream_response(topic, backlog, rx, Format::Json)
}

async fn sub_sse(Path(topic): Path<String>, Query(q): Query<SubQuery>) -> Response {
    if !valid_topic(&topic) {
        return bad_topic();
    }
    let since = parse_since(q.since.as_deref(), now());
    let (backlog, rx) = relay().backlog_and_subscribe(&topic, &since);
    stream_response(topic, backlog, rx, Format::Sse)
}

#[derive(Clone, Copy)]
enum Format {
    Json,
    Sse,
}

fn frame(m: &Msg, fmt: Format) -> Bytes {
    let json = serde_json::to_string(m).unwrap_or_default();
    Bytes::from(match fmt {
        Format::Json => format!("{json}\n"),
        Format::Sse if m.event == "message" => format!("data: {json}\n\n"),
        Format::Sse => format!("event: {}\ndata: {json}\n\n", m.event),
    })
}

struct StreamState {
    topic: String,
    pending: VecDeque<Msg>,
    rx: broadcast::Receiver<Msg>,
    fmt: Format,
    last_seq: u64,
}

fn stream_response(topic: String, backlog: Vec<Msg>, rx: broadcast::Receiver<Msg>, fmt: Format) -> Response {
    let mut pending: VecDeque<Msg> = VecDeque::with_capacity(backlog.len() + 1);
    pending.push_back(Msg::control("open", &topic));
    pending.extend(backlog);
    let st = StreamState { topic, pending, rx, fmt, last_seq: 0 };
    let stream = futures_util::stream::unfold(st, |mut st| async move {
        loop {
            if let Some(m) = st.pending.pop_front() {
                if m.event == "message" {
                    if m.seq <= st.last_seq {
                        continue;
                    }
                    st.last_seq = m.seq;
                }
                let bytes = frame(&m, st.fmt);
                return Some((Ok::<Bytes, Infallible>(bytes), st));
            }
            match tokio::time::timeout(Duration::from_secs(KEEPALIVE_SECS), st.rx.recv()).await {
                Ok(Ok(m)) => st.pending.push_back(m),
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                // Топик вытеснен — поток закрывается, клиент переподключится.
                Ok(Err(broadcast::error::RecvError::Closed)) => return None,
                Err(_) => st.pending.push_back(Msg::control("keepalive", &st.topic)),
            }
        }
    });
    let ctype = match fmt {
        Format::Json => "application/x-ndjson; charset=utf-8",
        Format::Sse => "text/event-stream; charset=utf-8",
    };
    let mut resp = Response::new(Body::from_stream(stream));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(ctype));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-store"));
    h.insert(header::CONTENT_ENCODING, HeaderValue::from_static("identity"));
    h.insert("x-accel-buffering", HeaderValue::from_static("no"));
    resp
}

async fn sub_ws(Path(topic): Path<String>, Query(q): Query<SubQuery>, ws: WebSocketUpgrade) -> Response {
    if !valid_topic(&topic) {
        return bad_topic();
    }
    ws.max_message_size(MAX_BODY)
        .max_frame_size(MAX_BODY)
        .on_upgrade(move |socket| ws_session(socket, topic, q.since))
}

fn ws_text(m: &Msg) -> WsMessage {
    WsMessage::Text(serde_json::to_string(m).unwrap_or_default().into())
}

async fn ws_session(mut socket: WebSocket, topic: String, since: Option<String>) {
    let me = next_seq();
    let since = parse_since(since.as_deref(), now());
    let (backlog, mut rx) = relay().backlog_and_subscribe(&topic, &since);
    if socket.send(ws_text(&Msg::control("open", &topic))).await.is_err() {
        return;
    }
    let mut last_seq = 0u64;
    for m in backlog {
        last_seq = m.seq;
        if socket.send(ws_text(&m)).await.is_err() {
            return;
        }
    }
    let mut keepalive = tokio::time::interval(Duration::from_secs(KEEPALIVE_SECS));
    keepalive.tick().await;
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(WsMessage::Text(t))) => {
                    relay().publish(&topic, t.as_str().to_owned(), me);
                }
                Some(Ok(WsMessage::Binary(b))) => match String::from_utf8(b.to_vec()) {
                    Ok(t) => {
                        relay().publish(&topic, t, me);
                    }
                    Err(_) => break,
                },
                // Ping/Pong отвечает сама библиотека; Close / ошибка / конец — выходим.
                Some(Ok(WsMessage::Ping(_))) | Some(Ok(WsMessage::Pong(_))) => {}
                Some(Ok(WsMessage::Close(_))) | Some(Err(_)) | None => break,
            },
            got = rx.recv() => match got {
                Ok(m) => {
                    if m.from == me || m.seq <= last_seq {
                        continue;
                    }
                    last_seq = m.seq;
                    if socket.send(ws_text(&m)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = keepalive.tick() => {
                if socket.send(ws_text(&Msg::control("keepalive", &topic))).await.is_err() {
                    break;
                }
            }
        }
    }
}

/// Роуты релея; состояние — свой `OnceLock`, поэтому роутер generic по `S`.
pub fn routes<S: Clone + Send + Sync + 'static>(cfg: &GrinoRelayConfig) -> Router<S> {
    if !cfg.enabled {
        return Router::new();
    }
    Router::new()
        .route("/grino/{topic}", post(publish).put(publish))
        .route("/grino/{topic}/json", get(sub_json))
        .route("/grino/{topic}/sse", get(sub_sse))
        .route("/grino/{topic}/ws", get(sub_ws))
        .layer(DefaultBodyLimit::max(MAX_BODY))
}

#[allow(dead_code)]
pub fn report_on_start(cfg: &GrinoRelayConfig) {
    tracing::info!("grino_relay: {}", if cfg.enabled { "включён (/grino/{topic})" } else { "выключен" });
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    fn app() -> Router {
        routes(&GrinoRelayConfig::default())
    }

    async fn body_string(resp: Response) -> String {
        let b = axum::body::to_bytes(resp.into_body(), 1 << 20).await.unwrap();
        String::from_utf8(b.to_vec()).unwrap()
    }

    #[test]
    fn since_forms() {
        assert_eq!(parse_since(None, 1000), Since::New);
        assert_eq!(parse_since(Some("all"), 1000), Since::All);
        assert_eq!(parse_since(Some("g42"), 1000), Since::AfterSeq(42));
        assert_eq!(parse_since(Some("1759500000"), 1000), Since::AfterTime(1_759_500_000));
        assert_eq!(parse_since(Some("10m"), 1000), Since::AfterTime(400));
        assert_eq!(parse_since(Some("zzz"), 1000), Since::All);
        assert_eq!(parse_since(Some("10м"), 1000), Since::All);
        assert_eq!(parse_since(Some("ж"), 1000), Since::All);
    }

    #[test]
    fn topic_rules() {
        assert!(valid_topic("grino27-da9f68d2021e3d49-cmd"));
        assert!(!valid_topic(""));
        assert!(!valid_topic("Upper"));
        assert!(!valid_topic("a/b"));
        assert!(!valid_topic(&"a".repeat(65)));
    }

    #[tokio::test]
    async fn publish_then_poll() {
        let t = "t-publish-then-poll";
        let resp = app()
            .oneshot(Request::post(format!("/grino/{t}")).body(Body::from("{\"go\":3}")).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let first: serde_json::Value = serde_json::from_str(&body_string(resp).await).unwrap();
        assert_eq!(first["event"], "message");
        assert_eq!(first["message"], "{\"go\":3}");
        let id = first["id"].as_str().unwrap().to_string();

        app()
            .oneshot(Request::put(format!("/grino/{t}")).body(Body::from("second")).unwrap())
            .await
            .unwrap();

        let all = body_string(
            app()
                .oneshot(Request::get(format!("/grino/{t}/json?poll=1&since=all")).body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(all.lines().count(), 2);

        let after = body_string(
            app()
                .oneshot(Request::get(format!("/grino/{t}/json?poll=1&since={id}")).body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(after.lines().count(), 1);
        assert!(after.contains("\"second\""));
    }

    #[tokio::test]
    async fn long_poll_wakes_on_publish() {
        let t = "t-long-poll";
        let waiter = tokio::spawn(async move {
            let resp = app()
                .oneshot(Request::get(format!("/grino/{t}/json?poll=1&since=all&wait=5")).body(Body::empty()).unwrap())
                .await
                .unwrap();
            body_string(resp).await
        });
        tokio::time::sleep(Duration::from_millis(150)).await;
        relay().publish(t, "next".into(), 0);
        let got = tokio::time::timeout(Duration::from_secs(3), waiter).await.unwrap().unwrap();
        assert!(got.contains("\"next\""), "{got}");
    }

    #[tokio::test]
    async fn sse_frames_like_ntfy() {
        let t = "t-sse";
        relay().publish(t, "hello".into(), 0);
        let resp = app()
            .oneshot(Request::get(format!("/grino/{t}/sse?since=all")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.headers()[header::CONTENT_TYPE], "text/event-stream; charset=utf-8");
        assert_eq!(resp.headers()["x-accel-buffering"], "no");
        let mut body = resp.into_body().into_data_stream();
        use futures_util::StreamExt;
        let open = String::from_utf8(body.next().await.unwrap().unwrap().to_vec()).unwrap();
        assert!(open.starts_with("event: open\ndata: "), "{open}");
        let msg = String::from_utf8(body.next().await.unwrap().unwrap().to_vec()).unwrap();
        assert!(msg.starts_with("data: {") && msg.contains("\"hello\""), "{msg}");
    }

    #[tokio::test]
    async fn rejects_bad_topic_and_big_body() {
        let r = app()
            .oneshot(Request::post("/grino/bad.topic").body(Body::from("x")).unwrap())
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        let r = app()
            .oneshot(Request::post("/grino/t-big").body(Body::from("x".repeat(MAX_BODY + 1))).unwrap())
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn websocket_two_way_without_self_echo() {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::Message as C;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app()).await.unwrap() });
        let url = format!("ws://{addr}/grino/t-ws/ws");
        let (mut deck, _) = tokio_tungstenite::connect_async(url.as_str()).await.unwrap();
        let (mut remote, _) = tokio_tungstenite::connect_async(url.as_str()).await.unwrap();
        async fn next_json(s: &mut (impl StreamExt<Item = Result<C, tokio_tungstenite::tungstenite::Error>> + Unpin)) -> serde_json::Value {
            loop {
                let m = tokio::time::timeout(Duration::from_secs(3), s.next()).await.unwrap().unwrap().unwrap();
                if let C::Text(t) = m {
                    return serde_json::from_str(t.as_str()).unwrap();
                }
            }
        }
        assert_eq!(next_json(&mut deck).await["event"], "open");
        assert_eq!(next_json(&mut remote).await["event"], "open");
        remote.send(C::Text("{\"sun\":0.42}".into())).await.unwrap();
        let got = next_json(&mut deck).await;
        assert_eq!(got["event"], "message");
        assert_eq!(got["message"], "{\"sun\":0.42}");
        // HTTP-публикация доходит до обоих, а своё сообщение отправителю не приходит.
        relay().publish("t-ws", "from-http".into(), 0);
        assert_eq!(next_json(&mut deck).await["message"], "from-http");
        assert_eq!(next_json(&mut remote).await["message"], "from-http");
        // long-poll видит и сообщения, пришедшие через WebSocket.
        let all = body_string(
            app()
                .oneshot(Request::get("/grino/t-ws/json?poll=1&since=all").body(Body::empty()).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(all.lines().count(), 2, "{all}");
    }

    #[test]
    fn disabled_has_no_routes() {
        let cfg = GrinoRelayConfig { enabled: false };
        let _r: Router = routes(&cfg);
    }
}
