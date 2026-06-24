use chrono::{DateTime, Utc};
use rdkafka::message::{Message, OwnedMessage};
use rdkafka::producer::{FutureProducer, FutureRecord};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::metrics::KAFKA_MESSAGES_TOTAL;

#[derive(Clone)]
pub struct TimelineMerger {
    producer: FutureProducer,
    seq_counters: Arc<Mutex<HashMap<String, u64>>>,
}

impl TimelineMerger {
    pub fn new(producer: FutureProducer) -> Self {
        Self {
            producer,
            seq_counters: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn handle_message(&self, msg: &OwnedMessage) -> anyhow::Result<()> {
        let topic = msg.topic();
        let payload = msg.payload().unwrap_or_default();

        KAFKA_MESSAGES_TOTAL
            .with_label_values(&[topic, "timeline"])
            .inc();

        let mut raw: serde_json::Value = serde_json::from_slice(payload)?;

        let session_id = raw
            .get("sessionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                msg.key()
                    .map(|k| String::from_utf8_lossy(k).to_string())
                    .unwrap_or_default()
            });

        if session_id.is_empty() {
            return Ok(());
        }

        let type_map = serde_json::json!({
            "obs.network.requests": "network",
            "obs.network.responses": "network",
            "obs.dom.mutations": "dom",
            "obs.js.events": "js",
            "obs.storage.events": "storage",
            "obs.screenshots": "screenshot",
            "obs.performance": "performance"
        });

        let ev_type = type_map
            .get(topic)
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let mut seq = self.seq_counters.lock().await;
        let counter = seq.entry(session_id.clone()).or_insert(0);
        *counter += 1;

        let timeline_event = serde_json::json!({
            "id": raw.get("id"),
            "sessionId": session_id,
            "pageId": raw.get("pageId"),
            "ts": raw.get("ts"),
            "tsPage": raw.get("tsPage"),
            "type": ev_type,
            "subtype": raw.get("type"),
            "payload": raw.get("payload"),
            "seq": *counter,
        });

        let payload_bytes = serde_json::to_vec(&timeline_event)?;
        let record = FutureRecord::to("obs.timeline.merged")
            .key(&session_id)
            .payload(&payload_bytes);

        self.producer.send(record, std::time::Duration::from_secs(5))
            .await
            .map_err(|(e, _)| anyhow::anyhow!("Kafka send error: {}", e))?;

        Ok(())
    }

    pub async fn cleanup_stale_sessions(&self) {
        // Sessions expire after 30 min of inactivity
        // For simplicity, clear the map periodically
        let mut seq = self.seq_counters.lock().await;
        seq.clear();
    }
}
