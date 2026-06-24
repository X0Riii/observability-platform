use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use futures::stream::StreamExt;
use futures::SinkExt;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::message::Message as KafkaMessage;
use std::sync::Arc;

use crate::AppState;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, session_id, state))
}

async fn handle_socket(socket: WebSocket, session_id: String, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    let consumer: StreamConsumer = rdkafka::config::ClientConfig::new()
        .set("group.id", format!("ws-stream-{}", uuid::Uuid::new_v4()))
        .set("bootstrap.servers", &state.config.kafka_brokers)
        .set("auto.offset.reset", "latest")
        .set("broker.address.family", "v4")
        .create()
        .expect("Failed to create Kafka consumer");
    let consumer = Arc::new(consumer);

    consumer.subscribe(&["obs.timeline.merged"]).unwrap();

    let sid = session_id.clone();
    let send_task = tokio::spawn(async move {
        loop {
            match consumer.recv().await {
                Ok(msg) => {
                    if let Some(payload) = KafkaMessage::payload(&msg) {
                        if let Ok(event) = serde_json::from_slice::<serde_json::Value>(payload) {
                            let event_sid = event
                                .get("sessionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if event_sid == sid {
                                if sender
                                    .send(Message::Text(String::from_utf8_lossy(payload).to_string()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }
}
