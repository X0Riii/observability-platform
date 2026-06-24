use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VitalStats {
    pub values: Vec<f64>,
    pub min: f64,
    pub max: f64,
    pub avg: f64,
    pub p50: f64,
    pub p95: f64,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pass: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() - 1) as f64 * p / 100.0).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn get_threshold(metric: &str) -> Option<f64> {
    let lower = metric.to_lowercase();
    match lower.as_str() {
        "lcp" | "largest-contentful-paint" => Some(2500.0),
        "fcp" | "first-contentful-paint" => Some(1800.0),
        "cls" | "cumulative-layout-shift" => Some(0.1),
        "inp" | "interaction-to-next-paint" => Some(200.0),
        "ttfb" | "time-to-first-byte" => Some(800.0),
        "fid" | "first-input-delay" => Some(100.0),
        _ => None,
    }
}

pub fn analyze_web_vitals(events: &[serde_json::Value]) -> HashMap<String, VitalStats> {
    let mut metric_values: HashMap<String, Vec<f64>> = HashMap::new();

    for event in events {
        let ev_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if ev_type.starts_with("perf:") {
            let metric_name = ev_type.trim_start_matches("perf:").to_string();
            let value = event
                .get("value")
                .or_else(|| event.pointer("/data/value"))
                .and_then(|v| v.as_f64());
            if let Some(v) = value {
                metric_values.entry(metric_name).or_default().push(v);
            }
        } else if ev_type == "performance" {
            if let Some(metrics) = event.pointer("/payload/metrics").and_then(|m| m.as_object()) {
                for (key, val) in metrics {
                    if let Some(v) = val.as_f64() {
                        metric_values.entry(key.clone()).or_default().push(v);
                    }
                }
            }
        }
    }

    let mut result = HashMap::new();
    for (metric, mut values) in metric_values {
        values.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let count = values.len();
        let min = values.first().copied().unwrap_or(0.0);
        let max = values.last().copied().unwrap_or(0.0);
        let avg = values.iter().sum::<f64>() / count as f64;
        let p50 = percentile(&values, 50.0);
        let p95 = percentile(&values, 95.0);
        let threshold = get_threshold(&metric);
        let pass = threshold.map(|t| p95 <= t);

        result.insert(
            metric,
            VitalStats {
                values,
                min: (min * 100.0).round() / 100.0,
                max: (max * 100.0).round() / 100.0,
                avg: (avg * 100.0).round() / 100.0,
                p50: (p50 * 100.0).round() / 100.0,
                p95: (p95 * 100.0).round() / 100.0,
                count,
                pass,
                threshold,
            },
        );
    }

    result
}
