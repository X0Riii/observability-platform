use crate::metrics::OPENSEARCH_INDEXED_TOTAL;
use crate::search::client::SearchClient;
use crate::search::index_rules::{get_rules, IndexRule};
use rdkafka::message::{Message, OwnedMessage};
use std::sync::Arc;

#[derive(Clone)]
pub struct OpenSearchIndexer {
    client: Arc<SearchClient>,
    rules: Vec<IndexRule>,
}

impl OpenSearchIndexer {
    pub fn new(client: Arc<SearchClient>) -> Self {
        Self {
            client,
            rules: get_rules(),
        }
    }

    pub async fn handle_message(&self, msg: &OwnedMessage) -> anyhow::Result<()> {
        let topic = msg.topic();
        let payload = msg.payload().unwrap_or_default();
        let event: serde_json::Value = serde_json::from_slice(payload)?;

        let rule = match self.rules.iter().find(|r| r.topic == topic) {
            Some(r) => r,
            None => return Ok(()),
        };

        let doc = (rule.transform)(event.clone());
        let doc = match doc {
            Some(d) => d,
            None => return Ok(()),
        };

        let id = event
            .get("id")
            .or_else(|| event.pointer("/payload/id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let response = self
            .client
            .client
            .index(opensearch::IndexParts::IndexId(rule.index, id))
            .body(doc)
            .send()
            .await?;

        OPENSEARCH_INDEXED_TOTAL
            .with_label_values(&[rule.index])
            .inc();

        if !response.status_code().is_success() {
            tracing::warn!("OpenSearch index failed for {}: {:?}", rule.index, response);
        }

        Ok(())
    }
}
