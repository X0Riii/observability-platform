use axum::extract::{Path, State};
use axum::Json;
use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::db::schema::Screenshot;
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct ScreenshotListResponse {
    pub page_id: String,
    pub screenshots: Vec<Screenshot>,
}

pub async fn list_screenshots(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Json<ScreenshotListResponse> {
    let pool = &state.db_pool;
    let screenshots: Vec<Screenshot> = sqlx::query_as(
        "SELECT * FROM screenshots WHERE page_id = $1 ORDER BY ts DESC"
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(ScreenshotListResponse {
        page_id: id.to_string(),
        screenshots,
    })
}

pub async fn get_snapshot(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<(axum::http::StatusCode, [(axum::http::HeaderName, &'static str); 1], axum::body::Body), axum::http::StatusCode> {
    let key = format!("sessions/{}/rendered.rrweb.zst", id);
    match state.minio.get_object("obs-raw", &key).await {
        Ok(data) => Ok((
            axum::http::StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            axum::body::Body::from(data),
        )),
        Err(_) => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

pub async fn get_screenshot(
    State(state): State<Arc<AppState>>,
    Path((page_id, screenshot_id)): Path<(Uuid, Uuid)>,
) -> Result<(axum::http::StatusCode, [(&'static str, &'static str); 0], axum::body::Body), axum::http::StatusCode> {
    let pool = &state.db_pool;
    let screenshot: Option<Screenshot> = sqlx::query_as(
        "SELECT * FROM screenshots WHERE id = $1 AND page_id = $2"
    )
    .bind(screenshot_id)
    .bind(page_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    match screenshot {
        Some(s) => {
            match state.minio.get_object("obs-raw", &s.object_key).await {
                Ok(data) => {
                    Ok((axum::http::StatusCode::OK, [], axum::body::Body::from(data)))
                }
                Err(_) => Err(axum::http::StatusCode::NOT_FOUND),
            }
        }
        None => Err(axum::http::StatusCode::NOT_FOUND),
    }
}
