use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (axum::http::StatusCode, &'static str)> {
    match state.auth.authenticate(&req.username, &req.password) {
        Some(token) => Ok(Json(LoginResponse { token })),
        None => Err((axum::http::StatusCode::UNAUTHORIZED, "Invalid credentials")),
    }
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub user: String,
    pub roles: Vec<String>,
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<MeResponse>, (axum::http::StatusCode, &'static str)> {
    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = auth_header.strip_prefix("Bearer ").unwrap_or("");
    match state.auth.validate_token(token) {
        Some(claims) => Ok(Json(MeResponse {
            user: claims.sub,
            roles: claims.roles,
        })),
        None => Err((axum::http::StatusCode::UNAUTHORIZED, "Invalid token")),
    }
}
