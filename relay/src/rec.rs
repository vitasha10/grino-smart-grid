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
/// One build at a time (several decks may ask at once); a build that waited returns fresh files.
static BUILD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
    full: Option<String>,
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

/// Sped-up copies of one segment: every SPEED-th moment, 30 fps, <= 1280 px wide, no audio —
/// H.264 Constrained Baseline in MP4 (hardware decoders everywhere) and VP8 in WebM (decoded by the
/// browser itself, e.g. on Windows "N" editions without system H.264).
async fn make_fast(raw: PathBuf, fast: PathBuf) {
    let _permit = JOBS.acquire().await;
    let vf = format!("setpts=PTS/{SPEED},fps=30,scale='min(1280,iw)':-2,format=yuv420p");
    let tmp = fast.with_extension("tmp.mp4");
    let ok = Command::new("nice")
        .args(["-n", "15", "ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i"])
        .arg(&raw)
        .args(["-an", "-vf", &vf, "-c:v", "libx264", "-preset", "ultrafast", "-profile:v", "baseline", "-level", "3.1", "-crf", "26", "-movflags", "+faststart"])
        .arg(&tmp)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        let _ = tokio::fs::rename(&tmp, &fast).await;
    } else {
        let _ = tokio::fs::remove_file(&tmp).await;
    }
    let webm = fast.with_extension("webm");
    let tmpw = fast.with_extension("tmp.webm");
    let okw = Command::new("nice")
        .args(["-n", "15", "ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i"])
        .arg(&raw)
        .args(["-an", "-vf", &vf, "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2500k", "-auto-alt-ref", "0"])
        .arg(&tmpw)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if okw {
        let _ = tokio::fs::rename(&tmpw, &webm).await;
    } else {
        let _ = tokio::fs::remove_file(&tmpw).await;
    }
}

#[derive(Serialize, Default)]
struct Listing {
    session: String,
    segments: Vec<String>,
    fast: Vec<String>,
    full: Option<String>,
    fast_full: Option<String>,
    fast_webm: Option<String>,
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
        } else if name.starts_with("fast_") && name.ends_with(".mp4") {
            l.fast.push(url);
        } else if name == "full.mp4" {
            l.full = Some(url);
        } else if name == "fast.mp4" {
            l.fast_full = Some(url);
        } else if name == "fast.webm" {
            l.fast_webm = Some(url);
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
        if !valid_session(&name) || name == "public" {
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

async fn concat_any(dir: &Path, inputs: &[PathBuf], out: &str) -> bool {
    if inputs.is_empty() {
        return false;
    }
    let list_path = dir.join(format!(".{out}.txt"));
    let body: String = inputs
        .iter()
        .map(|p| format!("file '{}'
", p.file_name().unwrap_or_default().to_string_lossy()))
        .collect();
    if tokio::fs::write(&list_path, body).await.is_err() {
        return false;
    }
    let tmp = dir.join(format!(".{out}.tmp.webm"));
    let ok = Command::new("ffmpeg")
        .current_dir(dir)
        .args(["-nostdin", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list_path)
        .args(["-c", "copy"])
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
    let _guard = BUILD.lock().await;
    // In-progress recordings are fine: stitch what exists; give pending fast copies at most 3 s.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let raw = count(&dir, "seg_").await;
        let fast = files(&dir, "fast_").await.iter().filter(|p| p.extension().map(|e| e == "mp4").unwrap_or(false)).count();
        if fast >= raw || tokio::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let raws = files(&dir, "seg_").await;
    let all_fast = files(&dir, "fast_").await;
    let fasts: Vec<PathBuf> = all_fast.iter().filter(|p| p.extension().map(|e| e == "mp4").unwrap_or(false)).cloned().collect();
    let webms: Vec<PathBuf> = all_fast.iter().filter(|p| p.extension().map(|e| e == "webm").unwrap_or(false)).cloned().collect();
    // The deck needs only the fast copy; the full-length file is stitched on request (?full=1).
    let full_ok = if q.full.as_deref() == Some("1") { concat(&dir, &raws, "full.mp4").await } else { false };
    let fast_ok = concat(&dir, &fasts, "fast.mp4").await;
    let _webm_ok = concat_any(&dir, &webms, "fast.webm").await;
    let l = listing(&session).await.unwrap_or_default();
    Json(serde_json::json!({
        "ok": full_ok || fast_ok, "full": l.full, "fast": l.fast_full, "fast_webm": l.fast_webm,
        "segments": raws.len(), "fast_segments": fasts.len(), "speed": SPEED
    }))
    .into_response()
}

/// After the pitch: stitch the full-length video of a session and publish it for the research
/// site at /grino/rec/files/public/pitch.mp4 (+ poster.jpg). Replaces the previous one.
async fn publish(UrlPath(session): UrlPath<String>, Query(q): Query<KeyQ>) -> Response {
    if !ok_key(&q) || !valid_session(&session) {
        return deny();
    }
    let Some(c) = cfg() else { return deny() };
    let _guard = BUILD.lock().await;
    let dir = session_dir(&session);
    let raws = files(&dir, "seg_").await;
    if raws.is_empty() || !concat(&dir, &raws, "full.mp4").await {
        return (StatusCode::UNPROCESSABLE_ENTITY, "nothing to publish
").into_response();
    }
    let public = c.dir.join("public");
    if tokio::fs::create_dir_all(&public).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "mkdir
").into_response();
    }
    let tmp = public.join(".pitch.tmp.mp4");
    if tokio::fs::copy(dir.join("full.mp4"), &tmp).await.is_err() || tokio::fs::rename(&tmp, public.join("pitch.mp4")).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "copy
").into_response();
    }
    let poster_tmp = public.join(".poster.tmp.jpg");
    let ok = Command::new("ffmpeg")
        .args(["-nostdin", "-y", "-loglevel", "error", "-ss", "3", "-i"])
        .arg(public.join("pitch.mp4"))
        .args(["-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3"])
        .arg(&poster_tmp)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        let _ = tokio::fs::rename(&poster_tmp, public.join("poster.jpg")).await;
    }
    let meta = serde_json::json!({
        "session": session,
        "segments": raws.len(),
        "published": SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
    });
    let _ = tokio::fs::write(public.join("pitch.json"), meta.to_string()).await;
    Json(serde_json::json!({"ok": true, "video": "/grino/rec/files/public/pitch.mp4", "poster": "/grino/rec/files/public/poster.jpg"})).into_response()
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
        .route("/grino/rec/{session}/publish", post(publish))
        .route("/grino/rec/{session}/{seq}", post(upload))
        .layer(DefaultBodyLimit::max(MAX_SEGMENT))
}
