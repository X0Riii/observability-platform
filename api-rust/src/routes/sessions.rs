use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use crate::db::schema::{DomEvent, Request, Session, Page};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ListSessionsQuery {
    pub url: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<Session>,
    pub total: i64,
}

pub async fn list_sessions(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListSessionsQuery>,
) -> Json<SessionListResponse> {
    let limit = query.limit.unwrap_or(50).min(1000);
    let offset = query.offset.unwrap_or(0);
    let pool = &state.db_pool;

    let (sessions, total) = if let Some(url) = &query.url {
        let sessions: Vec<Session> = sqlx::query_as(
            "SELECT * FROM sessions WHERE url_seed ILIKE $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(url)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let total: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) as count FROM sessions WHERE url_seed ILIKE $1"
        )
        .bind(url)
        .fetch_one(pool)
        .await
        .unwrap_or((0,));

        (sessions, total.0)
    } else {
        let sessions: Vec<Session> = sqlx::query_as(
            "SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1 OFFSET $2"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) as count FROM sessions")
            .fetch_one(pool)
            .await
            .unwrap_or((0,));

        (sessions, total.0)
    };

    Json(SessionListResponse { sessions, total })
}

#[derive(Debug, Serialize)]
pub struct SessionDetailResponse {
    pub session: Option<Session>,
    pub pages: Vec<Page>,
}

pub async fn get_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Json<SessionDetailResponse> {
    let pool = &state.db_pool;

    let session: Option<Session> = sqlx::query_as("SELECT * FROM sessions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

    let pages: Vec<Page> = sqlx::query_as("SELECT * FROM pages WHERE session_id = $1 ORDER BY navigated_at")
        .bind(id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    Json(SessionDetailResponse { session, pages })
}

#[derive(Debug, Deserialize)]
pub struct TimelineQuery {
    pub from: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct TimelineResponse {
    pub session_id: String,
    pub requests: Vec<Request>,
    pub dom_events: Vec<DomEvent>,
}

pub async fn get_timeline(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(query): Query<TimelineQuery>,
) -> Json<TimelineResponse> {
    let pool = &state.db_pool;
    let from = query.from.unwrap_or(0);
    let limit = query.limit.unwrap_or(1000).min(10000);

    let requests: Vec<Request> = sqlx::query_as(
        "SELECT r.id, r.ts, r.method, r.url, r.resource_type, r.page_id, r.url_host, r.initiator_type, r.headers, r.post_data_ref 
         FROM requests r 
         WHERE r.page_id IN (SELECT id FROM pages WHERE session_id = $1) 
         ORDER BY r.ts DESC 
         LIMIT $2 OFFSET $3"
    )
    .bind(id)
    .bind(limit)
    .bind(from)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let dom_events: Vec<DomEvent> = sqlx::query_as(
        "SELECT * FROM dom_events
         WHERE page_id IN (SELECT id FROM pages WHERE session_id = $1)
         ORDER BY ts DESC
         LIMIT $2 OFFSET $3"
    )
    .bind(id)
    .bind(limit)
    .bind(from)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Json(TimelineResponse {
        session_id: id.to_string(),
        requests,
        dom_events,
    })
}

pub async fn get_har(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<(axum::http::StatusCode, [(String, String); 2], axum::body::Body), axum::http::StatusCode> {
    let key = format!("sessions/{}/session.har.zst", id);
    match state.minio.get_object("obs-raw", &key).await {
        Ok(data) => {
            let headers = [
                ("Content-Type".into(), "application/har+json".into()),
                ("Content-Disposition".into(), format!("attachment; filename=\"session-{}.har.zst\"", id)),
            ];
            Ok((axum::http::StatusCode::OK, headers, axum::body::Body::from(data)))
        }
        Err(_) => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

pub async fn get_analysis_report(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<axum::Json<serde_json::Value>, axum::http::StatusCode> {
    let pool = &state.db_pool;

    let pages: Vec<Page> = sqlx::query_as("SELECT * FROM pages WHERE session_id = $1 ORDER BY navigated_at")
        .bind(id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

    if pages.is_empty() {
        return Err(axum::http::StatusCode::NOT_FOUND);
    }

    let page_ids: Vec<Uuid> = pages.iter().map(|p| p.id).collect();

    let requests: Vec<Request> = sqlx::query_as(
        "SELECT * FROM requests WHERE page_id = ANY($1) ORDER BY ts"
    )
    .bind(&page_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let dom_events: Vec<DomEvent> = sqlx::query_as(
        "SELECT * FROM dom_events WHERE page_id = ANY($1) ORDER BY ts"
    )
    .bind(&page_ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let req_values: Vec<serde_json::Value> = requests
        .iter()
        .map(|r| serde_json::to_value(r).unwrap_or_default())
        .collect();

    let dom_values: Vec<serde_json::Value> = dom_events
        .iter()
        .map(|d| serde_json::to_value(d).unwrap_or_default())
        .collect();

    let anomaly_result = crate::analysis::anomaly::detect_anomalies(&req_values);
    let vitals = crate::analysis::web_vitals::analyze_web_vitals(&dom_values);
    let dep_result = crate::analysis::dependency_graph::build_and_analyze(&req_values, None);
    let third_party = crate::analysis::third_party::analyze_third_parties(&req_values);

    let report = crate::analysis::report::generate_html_report(
        &id.to_string(),
        &dep_result,
        &third_party,
        &vitals,
        &anomaly_result,
    );

    let response = serde_json::json!({
        "session_id": id.to_string(),
        "html_report": report,
        "summary": {
            "requests": requests.len(),
            "dom_events": dom_events.len(),
            "pages": pages.len(),
            "anomalies": anomaly_result.anomalies_found,
            "third_party_pct": third_party.percentage,
            "graph_density": dep_result.density,
            "graph_components": dep_result.components,
        },
    });

    Ok(axum::Json(response))
}
