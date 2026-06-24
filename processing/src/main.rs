mod compressor;
mod parser;
mod processor;
mod storage;

use anyhow::Result;
use std::sync::Arc;
use tracing::info;

struct AppConfig {
    minio_endpoint: String,
    minio_region: String,
    minio_access_key: String,
    minio_secret_key: String,
    listen_addr: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            minio_endpoint: std::env::var("MINIO_ENDPOINT").unwrap_or_else(|_| "http://localhost:9000".into()),
            minio_region: std::env::var("MINIO_REGION").unwrap_or_else(|_| "us-east-1".into()),
            minio_access_key: std::env::var("MINIO_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into()),
            minio_secret_key: std::env::var("MINIO_SECRET_KEY").unwrap_or_else(|_| "minioadmin".into()),
            listen_addr: std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:9100".into()),
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,observability_processor=debug".into()),
        )
        .init();

    let config = AppConfig::default();
    let addr: std::net::SocketAddr = config.listen_addr.parse()?;
    let config = Arc::new(config);
    let minio = Arc::new(storage::MinioClient::new(&config).await?);

    let app = axum::Router::new()
        .route("/health", axum::routing::get(health))
        .route("/api/process", axum::routing::post(process_handler))
        .route("/api/compress", axum::routing::post(compress_handler))
        .route("/api/parse-url", axum::routing::post(parse_url_handler))
        .with_state(Arc::new((config, minio)));
    info!("Rust Processor listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

type AppState = Arc<(Arc<AppConfig>, Arc<storage::MinioClient>)>;

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "status": "ok",
        "service": "observability-processor",
        "version": "0.1.0"
    }))
}

#[derive(serde::Deserialize)]
struct ProcessRequest {
    topic: String,
    event: serde_json::Value,
}

async fn process_handler(
    state: axum::extract::State<AppState>,
    axum::Json(req): axum::Json<ProcessRequest>,
) -> axum::Json<serde_json::Value> {
    let (config, minio) = &**state;
    match processor::process_event(&req.topic, &req.event, minio, config).await {
        Ok(Some(result)) => {
            axum::Json(serde_json::json!({"processed": true, "result": result}))
        }
        Ok(None) => {
            axum::Json(serde_json::json!({"processed": false, "reason": "not_actionable"}))
        }
        Err(e) => {
            axum::Json(serde_json::json!({"processed": false, "error": e.to_string()}))
        }
    }
}

#[derive(serde::Deserialize)]
struct CompressRequest {
    data: String,
    encoding: Option<String>,
}

async fn compress_handler(
    axum::Json(req): axum::Json<CompressRequest>,
) -> axum::Json<serde_json::Value> {
    let compressed = match compressor::zstd_compress(req.data.as_bytes()) {
        Ok(c) => c,
        Err(e) => return axum::Json(serde_json::json!({"error": e.to_string()})),
    };

    let b64 = compressor::base64_encode(&compressed);

    axum::Json(serde_json::json!({
        "compressed": b64,
        "original_size": req.data.len(),
        "compressed_size": compressed.len(),
        "ratio": format!("{:.2}%", (compressed.len() as f64 / req.data.len().max(1) as f64) * 100.0),
    }))
}

#[derive(serde::Deserialize)]
struct ParseUrlRequest {
    url: String,
}

async fn parse_url_handler(
    axum::Json(req): axum::Json<ParseUrlRequest>,
) -> axum::Json<serde_json::Value> {
    let parsed = parser::ParsedUrl::from_str(&req.url);
    axum::Json(serde_json::json!({
        "scheme": parsed.scheme,
        "host": parsed.host,
        "port": parsed.port,
        "path": parsed.path,
        "query": parsed.query,
        "fragment": parsed.fragment,
        "query_count": parsed.query_count,
    }))
}
