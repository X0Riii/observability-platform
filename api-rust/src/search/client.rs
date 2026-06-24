use opensearch::{http::transport::Transport, OpenSearch};
use std::sync::Arc;

#[derive(Clone)]
pub struct SearchClient {
    pub client: OpenSearch,
}

impl SearchClient {
    pub fn new(url: &str) -> Self {
        let transport = Transport::single_node(url).expect("Failed to create OpenSearch transport");
        Self {
            client: OpenSearch::new(transport),
        }
    }

    pub async fn ensure_indices(&self) -> anyhow::Result<()> {
        let indices = [
            "obs-network-requests",
            "obs-network-responses",
            "obs-dom-mutations",
            "obs-js-events",
            "obs-storage-events",
            "obs-screenshots",
        ];
        for index in &indices {
            let exists = self.client.indices().exists(opensearch::indices::IndicesExistsParts::Index(&[index])).send().await?;
            if !exists.status_code().is_success() {
                let body = if *index == "obs-screenshots" {
                    serde_json::json!({
                        "settings": { "number_of_shards": 1, "number_of_replicas": 1 },
                        "mappings": {
                            "properties": {
                                "sessionId": { "type": "keyword" },
                                "ts": { "type": "date", "format": "epoch_millis" },
                                "trigger": { "type": "keyword" },
                                "format": { "type": "keyword" }
                            }
                        }
                    })
                } else {
                    serde_json::json!({
                        "settings": { "number_of_shards": 4, "number_of_replicas": 1, "codec": "best_compression" },
                        "mappings": {
                            "properties": {
                                "sessionId": { "type": "keyword" },
                                "pageId": { "type": "keyword" },
                                "ts": { "type": "date", "format": "epoch_millis" },
                                "type": { "type": "keyword" },
                                "url": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
                                "method": { "type": "keyword" },
                                "status": { "type": "integer" },
                                "mimeType": { "type": "keyword" },
                                "urlHost": { "type": "keyword" },
                                "resourceType": { "type": "keyword" },
                                "headers": { "type": "object", "enabled": false },
                                "content": { "type": "text", "analyzer": "standard" },
                                "consoleMsg": { "type": "text" },
                                "domText": { "type": "text" },
                                "errorMessage": { "type": "text" },
                                "mutationType": { "type": "keyword" },
                                "targetPath": { "type": "text" },
                                "initiatorType": { "type": "keyword" },
                                "storageType": { "type": "keyword" },
                                "cookieName": { "type": "keyword" }
                            }
                        }
                    })
                };
                self.client.indices().create(opensearch::indices::IndicesCreateParts::Index(index))
                    .body(body)
                    .send().await?;
                tracing::info!("Created OpenSearch index: {}", index);
            }
        }
        Ok(())
    }
}
