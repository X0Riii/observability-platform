use crate::compressor;
use crate::parser;
use crate::storage::MinioClient;
use anyhow::Result;
use serde_json::Value;
use tracing::{debug, info};

pub async fn process_event(
    topic: &str,
    event: &Value,
    minio: &MinioClient,
    _config: &crate::AppConfig,
) -> Result<Option<String>> {
    match topic {
        "obs.network.requests" => process_network_request(event, minio).await,
        "obs.network.responses" => process_network_response(event, minio).await,
        "obs.dom.mutations" => process_dom_mutation(event).await,
        "obs.screenshots" => process_screenshot(event, minio).await,
        _ => Ok(None),
    }
}

async fn process_network_request(
    event: &Value,
    minio: &MinioClient,
) -> Result<Option<String>> {
    let url = event
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let parsed = parser::ParsedUrl::from_str(url);
    debug!(
        "URL parsed: host={:?} path={:?} query_keys={}",
        parsed.host,
        parsed.path,
        parsed.query_count
    );

    let body = event
        .get("body")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("payload").and_then(|p| p.get("body")).and_then(|v| v.as_str()));

    if let Some(body_str) = body {
        if body_str.len() > 1024 {
            let event_id = event.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            let compressed = compressor::zstd_compress(body_str.as_bytes())?;
            let key = format!("processed/requests/{}.zst", event_id);

            minio.put(&key, &compressed).await?;
            info!("Compressed request body {} -> {} ({} -> {} bytes)", event_id, key, body_str.len(), compressed.len());
            return Ok(Some(format!("body stored ({}b)", compressed.len())));
        }
    }

    Ok(None)
}

async fn process_network_response(
    event: &Value,
    minio: &MinioClient,
) -> Result<Option<String>> {
    let body = event
        .get("body")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("payload").and_then(|p| p.get("body")).and_then(|v| v.as_str()))
        .or_else(|| event.get("body_ref").and_then(|v| v.as_str()));

    if let Some(body_str) = body {
        if body_str.len() > 1024 {
            let event_id = event.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            let compressed = compressor::zstd_compress(body_str.as_bytes())?;
            let key = format!("processed/responses/{}.zst", event_id);

            minio.put(&key, &compressed).await?;
            info!("Compressed response body {} -> {} ({} -> {} bytes)", event_id, key, body_str.len(), compressed.len());
            return Ok(Some(format!("body stored ({}b)", compressed.len())));
        }
    }

    Ok(None)
}

async fn process_dom_mutation(_event: &Value) -> Result<Option<String>> {
    Ok(None)
}

async fn process_screenshot(
    event: &Value,
    minio: &MinioClient,
) -> Result<Option<String>> {
    let body = event
        .get("body")
        .and_then(|v| v.as_str())
        .or_else(|| event.get("payload").and_then(|p| p.get("screenshot")).and_then(|v| v.as_str()));

    if let Some(img_b64) = body {
        let event_id = event.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
        let img_bytes = compressor::base64_decode(img_b64)?;
        let compressed = compressor::zstd_compress(&img_bytes)?;
        let key = format!("processed/screenshots/{}.jpeg.zst", event_id);

        minio.put(&key, &compressed).await?;
        info!("Stored screenshot {} -> {} ({} -> {} bytes)", event_id, key, img_bytes.len(), compressed.len());
        return Ok(Some(format!("screenshot stored ({}b)", compressed.len())));
    }

    Ok(None)
}
