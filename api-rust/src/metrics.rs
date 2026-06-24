use lazy_static::lazy_static;
use prometheus::{opts, register_counter_vec, register_histogram_vec, CounterVec, HistogramVec};

lazy_static! {
    pub static ref HTTP_REQUESTS_TOTAL: CounterVec = register_counter_vec!(
        opts!("obs_http_requests_total", "Total HTTP requests"),
        &["method", "route", "status"]
    )
    .unwrap();
    pub static ref HTTP_REQUEST_DURATION_MS: HistogramVec = register_histogram_vec!(
        "obs_http_request_duration_ms",
        "HTTP request duration in ms",
        &["method", "route"],
        vec![5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0]
    )
    .unwrap();
    pub static ref ACTIVE_SESSIONS: prometheus::Gauge = prometheus::register_gauge!(
        "obs_active_sessions",
        "Number of active monitoring sessions"
    )
    .unwrap();
    pub static ref KAFKA_MESSAGES_TOTAL: CounterVec = register_counter_vec!(
        opts!("obs_kafka_messages_total", "Total Kafka messages processed"),
        &["topic", "direction"]
    )
    .unwrap();
    pub static ref OPENSEARCH_INDEXED_TOTAL: CounterVec = register_counter_vec!(
        opts!("obs_opensearch_indexed_total", "Total OpenSearch documents indexed"),
        &["index"]
    )
    .unwrap();
}

#[derive(Clone)]
pub struct Metrics;

impl Metrics {
    pub fn new() -> Self {
        Metrics
    }
}

