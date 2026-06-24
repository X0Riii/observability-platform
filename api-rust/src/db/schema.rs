use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub url_seed: Option<String>,
    pub user_agent: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Page {
    pub id: Uuid,
    pub session_id: Uuid,
    pub url: String,
    pub title: Option<String>,
    pub navigated_at: DateTime<Utc>,
    pub load_time_ms: Option<i32>,
    pub status_code: Option<i16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Request {
    pub id: Uuid,
    pub page_id: Uuid,
    pub ts: DateTime<Utc>,
    pub method: Option<String>,
    pub url: String,
    pub url_host: Option<String>,
    pub resource_type: Option<String>,
    pub initiator_type: Option<String>,
    pub headers: Option<serde_json::Value>,
    pub post_data_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Response {
    pub request_id: Uuid,
    pub ts: DateTime<Utc>,
    pub status: Option<i16>,
    pub status_text: Option<String>,
    pub headers: Option<serde_json::Value>,
    pub body_ref: Option<String>,
    pub body_size: Option<i32>,
    pub transfer_size: Option<i32>,
    pub mime_type: Option<String>,
    pub timing: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DomEvent {
    pub id: Uuid,
    pub page_id: Uuid,
    pub ts: DateTime<Utc>,
    pub ts_page_ms: Option<f32>,
    pub mutation_type: Option<String>,
    pub target_path: Option<String>,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WsEvent {
    pub id: Uuid,
    pub request_id: Uuid,
    pub ts: DateTime<Utc>,
    pub direction: Option<String>,
    pub opcode: Option<i16>,
    pub payload_ref: Option<String>,
    pub masked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Screenshot {
    pub id: Uuid,
    pub page_id: Uuid,
    pub ts: DateTime<Utc>,
    pub trigger: Option<String>,
    pub format: Option<String>,
    pub width: Option<i16>,
    pub height: Option<i16>,
    pub file_size: Option<i32>,
    pub object_key: String,
    pub perceptual_hash: Option<i64>,
}
