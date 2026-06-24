use axum::extract::{Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub index: Option<String>,
    pub host: Option<String>,
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub status: Option<i32>,
    pub mime_type: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub from: Option<i64>,
    pub size: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub took: i64,
    pub total: i64,
    pub from: i64,
    pub size: i64,
    pub hits: Vec<Hit>,
    pub aggregations: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub id: String,
    pub index: String,
    pub score: Option<f64>,
    pub source: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct FacetQuery {
    pub field: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FacetResponse {
    pub field: String,
    pub buckets: Vec<Bucket>,
}

#[derive(Debug, Serialize)]
pub struct Bucket {
    pub key: String,
    pub doc_count: i64,
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    Json(query): Json<SearchQuery>,
) -> Json<SearchResponse> {
    let target_index = query.index.clone().unwrap_or_else(|| "obs-*".into());
    let from = query.from.unwrap_or(0).min(10000);
    let size = query.size.unwrap_or(20).min(100);

    let mut must: Vec<serde_json::Value> = Vec::new();
    let mut filter: Vec<serde_json::Value> = Vec::new();

    if let Some(q) = &query.q {
        if !q.is_empty() {
            must.push(serde_json::json!({
                "multi_match": {
                    "query": q,
                    "fields": ["url^3", "content", "consoleMsg", "domText", "errorMessage", "cookieName", "targetPath"],
                    "type": "best_fields",
                    "fuzziness": "AUTO"
                }
            }));
        }
    }

    if let Some(host) = &query.host {
        filter.push(serde_json::json!({ "term": { "urlHost.keyword": host } }));
    }
    if let Some(et) = &query.event_type {
        filter.push(serde_json::json!({ "term": { "type": et } }));
    }
    if let Some(st) = query.status {
        filter.push(serde_json::json!({ "term": { "status": st } }));
    }
    if let Some(mt) = &query.mime_type {
        filter.push(serde_json::json!({ "term": { "mimeType": mt } }));
    }
    if let Some(sd) = &query.start_date {
        filter.push(serde_json::json!({ "range": { "ts": { "gte": sd } } }));
    }
    if let Some(ed) = &query.end_date {
        filter.push(serde_json::json!({ "range": { "ts": { "lte": ed } } }));
    }

    let query_body = serde_json::json!({
        "query": {
            "bool": {
                "must": must,
                "filter": filter
            }
        },
        "from": from,
        "size": size,
        "sort": [{ "ts": { "order": "desc" } }],
        "aggs": {
            "by_host": { "terms": { "field": "urlHost.keyword", "size": 20 } },
            "by_type": { "terms": { "field": "type", "size": 20 } },
            "by_status": { "terms": { "field": "status", "size": 20 } },
            "by_mime": { "terms": { "field": "mimeType", "size": 20 } }
        }
    });

    let response = state
        .search_client
        .client
        .search(opensearch::SearchParts::Index(&[&target_index]))
        .body(query_body)
        .send()
        .await;

    match response {
        Ok(res) => {
            let status = res.status_code();
            if status.is_client_error() {
                return Json(SearchResponse {
                    took: 0, total: 0, from, size,
                    hits: vec![], aggregations: serde_json::json!({}),
                });
            }
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            let took = body.get("took").and_then(|v| v.as_i64()).unwrap_or(0);
            let total = body
                .pointer("/hits/total/value")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let hits = body
                .pointer("/hits/hits")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|h| Hit {
                            id: h.get("_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            index: h.get("_index").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            score: h.get("_score").and_then(|v| v.as_f64()),
                            source: h.get("_source").cloned().unwrap_or_default(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let aggregations = body.get("aggregations").cloned().unwrap_or_default();

            Json(SearchResponse { took, total, from, size, hits, aggregations })
        }
        Err(e) => {
            tracing::error!("Search request failed: {}", e);
            Json(SearchResponse {
                took: 0, total: 0, from, size,
                hits: vec![], aggregations: serde_json::json!({}),
            })
        }
    }
}

pub async fn facets(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FacetQuery>,
) -> Json<FacetResponse> {
    let field = query.field.unwrap_or_else(|| "urlHost.keyword".into());

    let query_body = serde_json::json!({
        "size": 0,
        "aggs": {
            "facet": { "terms": { "field": field, "size": 50 } }
        }
    });

    let response = state
        .search_client
        .client
        .search(opensearch::SearchParts::Index(&["obs-*"]))
        .body(query_body)
        .send()
        .await;

    match response {
        Ok(res) => {
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            let buckets = body
                .pointer("/aggregations/facet/buckets")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|b| Bucket {
                            key: b.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            doc_count: b.get("doc_count").and_then(|v| v.as_i64()).unwrap_or(0),
                        })
                        .collect()
                })
                .unwrap_or_default();
            Json(FacetResponse { field, buckets })
        }
        Err(e) => {
            tracing::error!("Facets request failed: {}", e);
            Json(FacetResponse { field, buckets: vec![] })
        }
    }
}
