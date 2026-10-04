//! grino-relay — pub/sub relay for the pitch-deck remote: POST /grino/{topic},
//! GET /grino/{topic}/json|sse|ws.
//! Bind: env GRINO_BIND (default 127.0.0.1:8790). nginx terminates TLS in front.
mod rec;
mod relay;

use axum::{routing::get, Router};
use tower_http::cors::CorsLayer;

async fn health() -> &'static str {
    "ok"
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let cfg = relay::GrinoRelayConfig::default();
    let app: Router = Router::new()
        .route("/grino/__health", get(health))
        .merge(relay::routes(&cfg))
        .merge(rec::routes())
        .layer(CorsLayer::permissive());
    let bind = std::env::var("GRINO_BIND").unwrap_or_else(|_| "127.0.0.1:8790".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    eprintln!("grino-relay listening on {bind}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
}
