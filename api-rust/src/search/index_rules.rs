use serde_json::Value;

#[derive(Clone)]
pub struct IndexRule {
    pub topic: &'static str,
    pub index: &'static str,
    pub transform: fn(Value) -> Option<Value>,
}

fn extract_search_body(event: &Value) -> Value {
    let content = event.get("body")
        .or_else(|| event.pointer("/payload/body"))
        .or_else(|| event.pointer("/payload/code"))
        .or_else(|| event.pointer("/payload/message"))
        .and_then(|v| v.as_str())
        .map(|s| Value::String(s.to_string()))
        .unwrap_or(Value::Null);

    serde_json::json!({
        "sessionId": event.get("sessionId"),
        "pageId": event.get("pageId"),
        "ts": event.get("ts"),
        "url": event.get("url"),
        "urlHost": event.get("urlHost"),
        "method": event.get("method"),
        "status": event.get("status"),
        "mimeType": event.get("mimeType"),
        "resourceType": event.get("resourceType"),
        "initiatorType": event.get("initiatorType"),
        "content": content,
        "headers": event.get("headers"),
    })
}

fn transform_request(event: Value) -> Option<Value> {
    Some(extract_search_body(&event))
}

fn transform_response(event: Value) -> Option<Value> {
    let mut base = extract_search_body(&event);
    if let Some(obj) = base.as_object_mut() {
        obj.insert("transferSize".into(), event.get("transferSize").cloned().unwrap_or(Value::Null));
        obj.insert("bodyRef".into(), event.get("bodyRef").cloned().unwrap_or(Value::Null));
    }
    Some(base)
}

fn transform_dom(event: Value) -> Option<Value> {
    let payload_json = event.get("payload").map(|p| p.to_string()).unwrap_or_default();
    Some(serde_json::json!({
        "sessionId": event.get("sessionId"),
        "pageId": event.get("pageId"),
        "ts": event.get("ts"),
        "type": event.get("type"),
        "mutationType": event.get("mutationType"),
        "targetPath": event.get("targetPath"),
        "domText": payload_json,
        "content": payload_json,
    }))
}

fn transform_js(event: Value) -> Option<Value> {
    let payload = event.get("payload");
    let console_msg = payload
        .and_then(|p| p.get("args"))
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|arg| arg.get("value").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();

    let content = payload
        .and_then(|p| {
            p.get("code")
                .or_else(|| p.get("message"))
                .or_else(|| p.get("stack"))
                .or_else(|| p.get("callFrames"))
        })
        .map(|v| {
            if v.is_string() {
                v.as_str().unwrap().to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_default();

    Some(serde_json::json!({
        "sessionId": event.get("sessionId"),
        "ts": event.get("ts"),
        "type": event.get("type"),
        "url": event.get("url"),
        "errorMessage": payload.and_then(|p| p.get("message")),
        "consoleMsg": console_msg,
        "content": content,
    }))
}

fn transform_storage(event: Value) -> Option<Value> {
    let payload_str = event.get("payload").map(|p| p.to_string()).unwrap_or_default();
    Some(serde_json::json!({
        "sessionId": event.get("sessionId"),
        "ts": event.get("ts"),
        "type": event.get("type"),
        "storageType": event.get("storageType"),
        "cookieName": event.get("cookieName"),
        "content": payload_str,
    }))
}

pub fn get_rules() -> Vec<IndexRule> {
    vec![
        IndexRule { topic: "obs.network.requests", index: "obs-network-requests", transform: transform_request },
        IndexRule { topic: "obs.network.responses", index: "obs-network-responses", transform: transform_response },
        IndexRule { topic: "obs.dom.mutations", index: "obs-dom-mutations", transform: transform_dom },
        IndexRule { topic: "obs.js.events", index: "obs-js-events", transform: transform_js },
        IndexRule { topic: "obs.storage.events", index: "obs-storage-events", transform: transform_storage },
    ]
}
