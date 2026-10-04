//! Live recording from a phone: the phone uploads independent video segments (one
//! MediaRecorder file per ~4 s); the server keeps them, makes a sped-up copy of every segment
//! in the background, and on request stitches both into `full.mp4` and `fast.mp4`.
//!
//!   POST /grino/rec/{session}/{seq}?k=KEY&ext=mp4   body = segment bytes (<= 64 MB)
//!   GET  /grino/rec/{session}/list?k=KEY             segments, fast copies, built files
//!   GET  /grino/rec/latest?k=KEY                     the most recently updated session
//!   POST /grino/rec/{session}/build?k=KEY            stitch -> {full, fast} URLs
//! Files are served by nginx from GRINO_REC_DIR under /grino/rec/files/{session}/...
//! Enabled only when GRINO_REC_KEY is set; the key is compared in constant time.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path as UrlPath, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::Semaphore;

const MAX_SEGMENT: usize = 64 * 1024 * 1024;
const SPEED: u32 = 10;

struct Cfg {
    dir: PathBuf,
    key: String,
}

static CFG: OnceLock<Option<Cfg>> = OnceLock::new();
static JOBS: Semaphore = Semaphore::const_new(1);

fn cfg() -> Option<&'static Cfg> {
    CFG.get_or_init(|| {
        let key = std::env::var("GRINO_REC_KEY").ok().filter(|k| k.len() >= 12)?;
        let dir = PathBuf::from(std::env::var("GRINO_REC_DIR").unwrap_or_else(|_| "/srv/grino-rec".into()));
        Some(Cfg { dir, key })
    })
    .as_ref()
}

#[derive(Deserialize)]
struct KeyQ {
    k: Option<String>,
    ext: Option<String>,
}

fn ok_key(q: &KeyQ) -> bool {
    let (Some(c), Some(k)) = (cfg(), q.k.as_deref()) else { return false };
    let (a, b) = (c.key.as_bytes(), k.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn valid_session(s: &str) -> bool {
    (8..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn deny() -> Response {
    (StatusCode::FORBIDDEN, "forbidden\n").into_response()
}

fn session_dir(session: &str) -> PathBuf {
    cfg().map(|c| c.dir.join(session)).unwrap_or_default()
}

async fn upload(UrlPath((session, seq)): UrlPath<(String, u32)>, Query(q): Query<KeyQ>, body: Bytes) -> Response {
    if !ok_key(&q) || !valid_session(&session) {
        return deny();
    }
    let ext = match q.ext.as_deref() {
        Some("webm") => "webm",
        _ => "mp4",
    };
    if body.is_empty() {
        return (StatusCode::BAD_REQUEST, "empty\n").into_response();
    }
    let dir = session_dir(&session);
    if let Err(e) = tokio::fs::create_dir_all(&dir).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("mkdir: {e}\n")).into_response();
    }
    let raw = dir.join(format!("seg_{seq:05}.{ext}"));
    let tmp = dir.join(format!(".seg_{seq:05}.{ext}.part"));
    if let Err(e) = tokio::fs::write(&tmp, &body).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("write: {e}\n")).into_response();
    }
    if let Err(e) = tokio::fs::rename(&tmp, &raw).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("rename: {e}\n")).into_response();
    }
    let fast = dir.join(format!("fast_{seq:05}.mp4"));
    tokio::spawn(make_fast(raw, fast));
    Json(serde_json::json!({"ok": true, "seq": seq, "bytes": body.len()})).into_response()
}

/// Sped-up copy of one segment: every SPEED-th moment, 30 fps, <= 1280 px wide, no audio.
async fn make_fast(raw: PathBuf, fast: PathBuf) {
    let _permit = JOBS.acquire().await;
    let tmp = fast.with_extension("tmp.mp4");
    let vf = format!("setpts=PTS/{SPEED},fps=30,scale='min(1280,iw)':-2,format=yuv420p");
    let status = Command::new("nice")
        .args(["-n", "15", "ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i"])
        .arg(&raw)
        .args(["-an", "-vf", &vf, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-movflags", "+faststart"])
        .arg(&tmp)
        .status()
        .await;
    if matches!(status, Ok(s) if s.success()) {
        let _ = tokio::fs::rename(&tmp, &fast).await;
    } else {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
}

#[derive(Serialize, Default)]
struct Listing {
    session: String,
    segments: Vec<String>,
    fast: Vec<String>,
    full: Option<String>,
    fast_full: Option<String>,
    updated: u64,
}

async fn listing(session: &str) -> Option<Listing> {
    let dir = session_dir(session);
    let mut rd = tokio::fs::read_dir(&dir).await.ok()?;
    let mut l = Listing { session: session.to_string(), ..Default::default() };
    while let Ok(Some(e)) = rd.next_entry().await {
        let name = e.file_name().to_string_lossy().to_string();
        if let Ok(m) = e.metadata().await {
            if let Ok(t) = m.modified() {
                let secs = t.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                l.updated = l.updated.max(secs);
            }
        }
        let url = format!("/grino/rec/files/{session}/{name}");
        if name.starts_with("seg_") {
            l.segments.push(url);
        } else if name.starts_with("fast_") {
            l.fast.push(url);
        } else if name == "full.mp4" {
            l.full = Some(url);
        } else if name == "fast.mp4" {
            l.fast_full = Some(url);
        }
    }
    l.segments.sort();
    l.fast.sort();
    Some(l)
}

async fn list(UrlPath(session): UrlPath<String>, Query(q): Query<KeyQ>) -> Response {
    if !ok_key(&q) || !valid_session(&session) {
        return deny();
    }
    match listing(&session).await {
        Some(l) => Json(l).into_response(),
        None => (StatusCode::NOT_FOUND, "no such session\n").into_response(),
    }
}

async fn latest(Query(q): Query<KeyQ>) -> Response {
    if !ok_key(&q) {
        return deny();
    }
    let Some(c) = cfg() else { return deny() };
    let Ok(mut rd) = tokio::fs::read_dir(&c.dir).await else {
        return (StatusCode::NOT_FOUND, "no sessions\n").into_response();
    };
    let mut best: Option<Listing> = None;
    while let Ok(Some(e)) = rd.next_entry().await {
        let name = e.file_name().to_string_lossy().to_string();
        if !valid_session(&name) {
            continue;
        }
        if let Some(l) = listing(&name).await {
            if best.as_ref().map(|b| l.updated > b.updated).unwrap_or(true) {
                best = Some(l);
            }
        }
    }
    match best {
        Some(l) => Json(l).into_response(),
        None => (StatusCode::NOT_FOUND, "no sessions\n").into_response(),
    }
}

async fn concat(dir: &Path, inputs: &[PathBuf], out: &str) -> bool {
    if inputs.is_empty() {
        return false;
    }
    let list_path = dir.join(format!(".{out}.txt"));
    let body: String = inputs
        .iter()
        .map(|p| format!("file '{}'\n", p.file_name().unwrap_or_default().to_string_lossy()))
        .collect();
    if tokio::fs::write(&list_path, body).await.is_err() {
        return false;
    }
    let tmp = dir.join(format!(".{out}.tmp.mp4"));
    let ok = Command::new("ffmpeg")
        .current_dir(dir)
        .args(["-nostdin", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list_path)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&tmp)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        tokio::fs::rename(&tmp, dir.join(out)).await.is_ok()
    } else {
        let _ = tokio::fs::remove_file(&tmp).await;
        false
    }
}

async fn build(UrlPath(session): UrlPath<String>, Query(q): Query<KeyQ>) -> Response {
    if !ok_key(&q) || !valid_session(&session) {
        return deny();
    }
    let dir = session_dir(&session);
    // Let pending fast copies finish (one job at a time; wait up to 20 s).
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        let raw = count(&dir, "seg_").await;
        let fast = count(&dir, "fast_").await;
        if fast >= raw || tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let raws = files(&dir, "seg_").await;
    let fasts = files(&dir, "fast_").await;
    let full_ok = concat(&dir, &raws, "full.mp4").await;
    let fast_ok = concat(&dir, &fasts, "fast.mp4").await;
    let l = listing(&session).await.unwrap_or_default();
    Json(serde_json::json!({
        "ok": full_ok || fast_ok, "full": l.full, "fast": l.fast_full,
        "segments": raws.len(), "fast_segments": fasts.len(), "speed": SPEED
    }))
    .into_response()
}

async fn files(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with(prefix) && !name.ends_with(".part") && !name.contains(".tmp.") {
                v.push(e.path());
            }
        }
    }
    v.sort();
    v
}

async fn count(dir: &Path, prefix: &str) -> usize {
    files(dir, prefix).await.len()
}

pub fn routes<S: Clone + Send + Sync + 'static>() -> Router<S> {
    if cfg().is_none() {
        return Router::new();
    }
    Router::new()
        .route("/grino/rec/latest", get(latest))
        .route("/grino/rec/{session}/list", get(list))
        .route("/grino/rec/{session}/build", post(build))
        .route("/grino/rec/{session}/{seq}", post(upload))
        .layer(DefaultBodyLimit::max(MAX_SEGMENT))
}
