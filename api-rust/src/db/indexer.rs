use chrono::{DateTime, Utc};
use rdkafka::message::{Message, OwnedMessage};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::metrics::KAFKA_MESSAGES_TOTAL;

#[derive(Clone)]
pub struct PostgresIndexer {
    pool: PgPool,
    session_cache: Arc<Mutex<HashMap<String, Uuid>>>,
    page_cache: Arc<Mutex<HashMap<String, Uuid>>>,
}

impl PostgresIndexer {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            session_cache: Arc::new(Mutex::new(HashMap::new())),
            page_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn handle_message(&self, msg: &OwnedMessage) -> anyhow::Result<()> {
        let topic = msg.topic();
        let payload = msg.payload().unwrap_or_default();
        let event: serde_json::Value = serde_json::from_slice(payload)?;

        KAFKA_MESSAGES_TOTAL
            .with_label_values(&[topic, "consumed"])
            .inc();

        match topic {
            "obs.network.requests" => self.index_request(&event).await?,
            "obs.network.responses" => self.index_response(&event).await?,
            "obs.dom.mutations" => self.index_dom_event(&event).await?,
            "obs.screenshots" => self.index_screenshot(&event).await?,
            _ => {}
        }

        Ok(())
    }

    async fn ensure_session(&self, event: &serde_json::Value) -> anyhow::Result<Uuid> {
        let session_id = event
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        {
            let cache = self.session_cache.lock().await;
            if let Some(id) = cache.get(&session_id) {
                return Ok(*id);
            }
        }

        let id = Uuid::parse_str(&session_id).unwrap_or_else(|_| Uuid::new_v4());
        let started_at: DateTime<Utc> = event
            .get("ts")
            .and_then(|v| v.as_f64())
            .map(|ts| {
                DateTime::from_timestamp_millis(ts as i64).unwrap_or(Utc::now())
            })
            .unwrap_or(Utc::now());

        sqlx::query(
            "INSERT INTO sessions (id, started_at, url_seed) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING"
        )
        .bind(id)
        .bind(started_at)
        .bind(event.get("url").and_then(|v| v.as_str()))
        .execute(&self.pool)
        .await?;

        let mut cache = self.session_cache.lock().await;
        cache.insert(session_id, id);
        Ok(id)
    }

    async fn ensure_page(&self, event: &serde_json::Value, session_id: Uuid) -> anyhow::Result<Uuid> {
        let cache_key = format!("{}:{}", session_id, event.get("pageId").and_then(|v| v.as_str()).unwrap_or(""));

        {
            let cache = self.page_cache.lock().await;
            if let Some(id) = cache.get(&cache_key) {
                return Ok(*id);
            }
        }

        let page_id = event
            .get("pageId")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .unwrap_or_else(Uuid::new_v4);

        let url = event.get("url").and_then(|v| v.as_str()).unwrap_or("unknown");
        let navigated_at: DateTime<Utc> = event
            .get("ts")
            .and_then(|v| v.as_f64())
            .map(|ts| DateTime::from_timestamp_millis(ts as i64).unwrap_or(Utc::now()))
            .unwrap_or(Utc::now());

        let result = sqlx::query(
            "INSERT INTO pages (id, session_id, url, navigated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id"
        )
        .bind(page_id)
        .bind(session_id)
        .bind(url)
        .bind(navigated_at)
        .execute(&self.pool)
        .await?;

        let final_id = if result.rows_affected() > 0 {
            page_id
        } else {
            sqlx::query_scalar::<_, Uuid>("SELECT id FROM pages WHERE id = $1")
                .bind(page_id)
                .fetch_optional(&self.pool)
                .await?
                .unwrap_or(page_id)
        };

        let mut cache = self.page_cache.lock().await;
        cache.insert(cache_key, final_id);
        Ok(final_id)
    }

    async fn index_request(&self, event: &serde_json::Value) -> anyhow::Result<()> {
        let session_id = self.ensure_session(event).await?;
        let page_id = self.ensure_page(event, session_id).await?;

        let id = event
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .unwrap_or_else(Uuid::new_v4);

        let ts = event
            .get("ts")
            .and_then(|v| v.as_f64())
            .map(|ts| DateTime::from_timestamp_millis(ts as i64).unwrap_or(Utc::now()))
            .unwrap_or(Utc::now());

        sqlx::query(
            "INSERT INTO requests (id, page_id, ts, method, url, url_host, resource_type, initiator_type, headers, post_data_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (id) DO NOTHING"
        )
        .bind(id)
        .bind(page_id)
        .bind(ts)
        .bind(event.get("method").and_then(|v| v.as_str()))
        .bind(event.get("url").and_then(|v| v.as_str()).unwrap_or(""))
        .bind(event.get("urlHost").and_then(|v| v.as_str()))
        .bind(event.get("resourceType").and_then(|v| v.as_str()))
        .bind(event.get("initiatorType").and_then(|v| v.as_str()))
        .bind(event.get("headers"))
        .bind(event.get("postData").and_then(|v| v.as_str()))
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn index_response(&self, event: &serde_json::Value) -> anyhow::Result<()> {
        let id = event
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .unwrap_or_else(Uuid::new_v4);

        let ts = event
            .get("ts")
            .and_then(|v| v.as_f64())
            .map(|ts| DateTime::from_timestamp_millis(ts as i64).unwrap_or(Utc::now()))
            .unwrap_or(Utc::now());

        let result = sqlx::query(
            "INSERT INTO responses (request_id, ts, status, status_text, headers, body_ref, body_size, transfer_size, mime_type, timing)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
        )
        .bind(id)
        .bind(ts)
        .bind(event.get("status").and_then(|v| v.as_i64()).map(|s| s as i16))
        .bind(event.get("statusText").and_then(|v| v.as_str()))
        .bind(event.get("headers"))
        .bind(event.get("bodyRef").and_then(|v| v.as_str()))
        .bind(event.get("bodySize").and_then(|v| v.as_i64()).map(|s| s as i32))
        .bind(event.get("transferSize").and_then(|v| v.as_i64()).map(|s| s as i32))
        .bind(event.get("mimeType").and_then(|v| v.as_str()))
        .bind(event.get("timing"))
        .execute(&self.pool)
        .await;

        if let Err(e) = result {
            if let sqlx::Error::Database(ref db) = e {
                if db.code().as_deref() == Some("23505") {
                    return Ok(());
                }
            }
        }

        Ok(())
    }

    async fn index_dom_event(&self, event: &serde_json::Value) -> anyhow::Result<()> {
        let session_id = self.ensure_session(event).await?;
        let page_id = self.ensure_page(event, session_id).await?;

        let id = event
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .unwrap_or_else(Uuid::new_v4);

        let ts = event
            .get("ts")
            .and_then(|v| v.as_f64())
            .map(|ts| DateTime::from_timestamp_millis(ts as i64).unwrap_or(Utc::now()))
            .unwrap_or(Utc::now());

        let ev_type = event.get("type").and_then(|v| v.as_str());

        sqlx::query(
            "INSERT INTO dom_events (id, page_id, ts, ts_page_ms, mutation_type, payload)
             VALUES ($1, $2, $3, $4, $5, $6)"
        )
        .bind(id)
        .bind(page_id)
        .bind(ts)
        .bind(event.get("tsPage").and_then(|v| v.as_f64()))
        .bind(ev_type)
        .bind(event.get("payload"))
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn index_screenshot(&self, event: &serde_json::Value) -> anyhow::Result<()> {
        let session_id_str = event
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let page_id = {
            let cache = self.page_cache.lock().await;
            cache.get(session_id_str).copied()
        };

        let page_id = match page_id {
            Some(id) => id,
            None => {
                let session_id = self.ensure_session(event).await?;
                self.ensure_page(event, session_id).await?
            }
        };

        let id = event
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .unwrap_or_else(Uuid::new_v4);

        let ts = event
            .get("ts")
            .and_then(|v| v.as_f64())
            .map(|ts| DateTime::from_timestamp_millis(ts as i64).unwrap_or(Utc::now()))
            .unwrap_or(Utc::now());

        let payload = event.get("payload");
        let object_key = payload
            .and_then(|p| p.get("objectKey"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let hash_str = payload.and_then(|p| p.get("hash")).and_then(|v| v.as_str());
        let p_hash = hash_str.and_then(|h| i64::from_str_radix(h, 16).ok());

        sqlx::query(
            "INSERT INTO screenshots (id, page_id, ts, trigger, format, width, height, file_size, object_key, perceptual_hash)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
        )
        .bind(id)
        .bind(page_id)
        .bind(ts)
        .bind(payload.and_then(|p| p.get("trigger")).and_then(|v| v.as_str()))
        .bind(payload.and_then(|p| p.get("format")).and_then(|v| v.as_str()))
        .bind(payload.and_then(|p| p.get("width")).and_then(|v| v.as_i64()).map(|w| w as i16))
        .bind(payload.and_then(|p| p.get("height")).and_then(|v| v.as_i64()).map(|h| h as i16))
        .bind(payload.and_then(|p| p.get("fileSize")).and_then(|v| v.as_i64()).map(|s| s as i32))
        .bind(object_key)
        .bind(p_hash)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
