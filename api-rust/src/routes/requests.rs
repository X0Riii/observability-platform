use axum::extract::{Path, State};
use std::sync::Arc;
use uuid::Uuid;

use crate::AppState;

pub async fn get_request_body(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<(axum::http::StatusCode, [(axum::http::HeaderName, &'static str); 1], axum::body::Body), axum::http::StatusCode> {
    let key = format!("responses/{}.bin.zst", id);
    match state.minio.get_object("obs-raw", &key).await {
        Ok(data) => Ok((
            axum::http::StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
            axum::body::Body::from(data),
        )),
        Err(_) => Err(axum::http::StatusCode::NOT_FOUND),
    }
}
