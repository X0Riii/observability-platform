mod analysis;
mod auth;
mod config;
mod db;
mod metrics;
mod minio;
mod routes;
mod search;
mod timeline;

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::State,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use config::Config;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message as KafkaMessage;
use rdkafka::producer::FutureProducer;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db_pool: sqlx::PgPool,
    pub search_client: Arc<search::client::SearchClient>,
    pub kafka_producer: FutureProducer,
    pub kafka_consumer: Arc<StreamConsumer>,
    pub config: Config,
    pub metrics: metrics::Metrics,
    pub timeline_tx: broadcast::Sender<serde_json::Value>,
    pub minio: minio::MinioClient,
    pub auth: auth::AuthService,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,observability_api=debug")),
        )
        .init();

    let config = Config::from_env();
    let db_pool = db::pool::create_pool(&config.database_url).await?;
    let _ = sqlx::migrate!("./migrations").run(&db_pool).await;

    let search_client = Arc::new(search::client::SearchClient::new(&config.opensearch_url));
    search_client.ensure_indices().await?;

    let kafka_producer: FutureProducer = rdkafka::config::ClientConfig::new()
        .set("bootstrap.servers", &config.kafka_brokers)
        .set("message.timeout.ms", "5000")
        .set("broker.address.family", "v4")
        .create()?;

    macro_rules! mkc {
        ($suffix:expr) => {
            Arc::new(rdkafka::config::ClientConfig::new()
                .set("bootstrap.servers", &config.kafka_brokers)
                .set("group.id", format!("observability-api-rust-{}", $suffix))
                .set("auto.offset.reset", "earliest")
                .set("enable.auto.commit", "true")
                .set("session.timeout.ms", "6000")
                .set("max.poll.interval.ms", "300000")
                .set("broker.address.family", "v4")
                .create().unwrap())
        };
    }

    let kafka_consumer: Arc<StreamConsumer> = mkc!("base");
    let pg_consumer: Arc<StreamConsumer> = mkc!("pg");
    let os_consumer: Arc<StreamConsumer> = mkc!("os");
    let merger_consumer: Arc<StreamConsumer> = mkc!("timeline");

    let metrics = metrics::Metrics::new();
    let (timeline_tx, _) = broadcast::channel::<serde_json::Value>(1024);
    let minio = minio::MinioClient::new(&config);
    let auth = auth::AuthService::new(&config);

    let state = Arc::new(AppState {
        db_pool,
        search_client,
        kafka_producer: kafka_producer.clone(),
        kafka_consumer: Arc::clone(&kafka_consumer),
        config,
        metrics,
        timeline_tx: timeline_tx.clone(),
        minio,
        auth,
    });

    // Postgres indexer
    let pg_idx = db::indexer::PostgresIndexer::new(state.db_pool.clone());
    tokio::spawn(async move {
        run_indexer(pg_consumer, move |msg| {
            let idx = pg_idx.clone();
            async move { idx.handle_message(&msg).await }
        })
        .await;
    });

    // OpenSearch indexer
    let os_idx = search::indexer::OpenSearchIndexer::new(state.search_client.clone());
    tokio::spawn(async move {
        run_indexer(os_consumer, move |msg| {
            let idx = os_idx.clone();
            async move { idx.handle_message(&msg).await }
        })
        .await;
    });

    // Timeline merger
    let merger = timeline::merger::TimelineMerger::new(state.kafka_producer.clone());
    let merger_tx = state.timeline_tx.clone();
    tokio::spawn(async move {
        run_indexer(merger_consumer, move |msg| {
            let m = merger.clone();
            let tx = merger_tx.clone();
            async move {
                if let Ok(()) = m.handle_message(&msg).await {
                    if let Some(payload) = KafkaMessage::payload(&msg) {
                        if let Ok(event) = serde_json::from_slice::<serde_json::Value>(payload) {
                            let _ = tx.send(event);
                        }
                    }
                }
                Ok(())
            }
        })
        .await;
    });

    let app = Router::new()
        .route("/health", get(routes::health::health))
        .route("/api/search", post(routes::search::search))
        .route("/api/search/facets", get(routes::search::facets))
        .route("/api/sessions", get(routes::sessions::list_sessions))
        .route("/api/sessions/:id", get(routes::sessions::get_session))
        .route("/api/sessions/:id/timeline", get(routes::sessions::get_timeline))
        .route("/api/sessions/:id/har", get(routes::sessions::get_har))
        .route(
            "/api/sessions/:id/analysis",
            get(routes::sessions::get_analysis_report),
        )
        .route(
            "/api/pages/:id/screenshots",
            get(routes::pages::list_screenshots),
        )
        .route(
            "/api/pages/:page_id/screenshots/:screenshot_id",
            get(routes::pages::get_screenshot),
        )
        .route(
            "/api/requests/:id/body",
            get(routes::requests::get_request_body),
        )
        .route("/api/auth/login", post(routes::auth::login))
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/ws/timeline", get(ws_handler))
        .route("/metrics", get(metrics_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config::Config::from_env().port);
    tracing::info!("Starting Rust API server on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn run_indexer<F, Fut>(
    consumer: Arc<StreamConsumer>,
    handler: F,
) where
    F: Fn(rdkafka::message::OwnedMessage) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = anyhow::Result<()>> + Send,
{
    let topics = &[
        "obs.network.requests",
        "obs.network.responses",
        "obs.dom.mutations",
        "obs.js.events",
        "obs.storage.events",
        "obs.screenshots",
        "obs.performance",
    ];

    let _ = consumer
        .fetch_metadata(None::<&str>, std::time::Duration::from_secs(10));

    consumer
        .subscribe(topics)
        .expect("Failed to subscribe to topics");

    loop {
        match consumer.recv().await {
            Ok(msg) => {
                let owned = msg.detach();
                if let Err(e) = handler(owned).await {
                    tracing::error!("Handler error: {}", e);
                }
            }
            Err(e) => {
                tracing::error!("Kafka recv error: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.timeline_tx.subscribe();
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(event) => {
                        let text = serde_json::to_string(&event).unwrap_or_default();
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
}

async fn metrics_handler() -> impl IntoResponse {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buffer = Vec::new();
    encoder
        .encode(&prometheus::gather(), &mut buffer)
        .unwrap();
    axum::response::Response::builder()
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(axum::body::Body::from(buffer))
        .unwrap()
}
