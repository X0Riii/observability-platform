use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyResult {
    pub total_requests: usize,
    pub anomalies_found: usize,
    pub contamination: f64,
    pub normal_count: usize,
    pub anomalies: Vec<AnomalyItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyItem {
    pub index: usize,
    pub url: String,
    pub score: f64,
    pub features: Vec<f64>,
}

fn extract_features(requests: &[serde_json::Value]) -> Vec<Vec<f64>> {
    requests
        .iter()
        .map(|req| {
            let timing = req
                .get("payload")
                .and_then(|p| p.get("timing"))
                .or_else(|| req.get("timing"));

            let response_time = timing
                .and_then(|t| {
                    let rh = t.get("receiveHeadersEnd").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let se = t.get("sendEnd").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let ce = t.get("connectEnd").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let rt = t.get("requestTime").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    Some((rh + se + ce + rt) / 1000.0)
                })
                .unwrap_or(0.0);

            let body_size = req
                .get("transferSize")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                / 1024.0;

            let status = req
                .get("status")
                .and_then(|v| v.as_f64())
                .unwrap_or(200.0);

            let url = req.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let is_third_party = if crate::analysis::third_party::classify_request(url).is_some() {
                1.0
            } else {
                0.0
            };

            vec![response_time, body_size, status, is_third_party, 0.0]
        })
        .collect()
}

/// Simple Isolation Forest implementation
fn isolation_forest_anomaly_scores(features: &[Vec<f64>], n_trees: usize, contamination: f64) -> Vec<f64> {
    let n = features.len();
    if n < 4 {
        return vec![0.0; n];
    }

    let mut rng = rand::thread_rng();
    let mut scores = vec![0.0; n];

    for _ in 0..n_trees {
        let sample_size = n.min(256);
        let mut indices: Vec<usize> = (0..n).collect();
        // Simple random sample
        let sample: Vec<usize> = if sample_size < n {
            let mut shuffled = indices.clone();
            for i in (1..n).rev() {
                let j = rng.gen_range(0..=i);
                shuffled.swap(i, j);
            }
            shuffled[..sample_size].to_vec()
        } else {
            indices
        };

        // Compute path length for each point
        for (i, point) in features.iter().enumerate() {
            let mut depth = 0;
            let mut current_sample = sample.clone();
            loop {
                if current_sample.len() <= 1 || depth > 20 {
                    break;
                }
                // Pick random feature and split point
                let feat_idx = rng.gen_range(0..point.len());
                let feat_vals: Vec<f64> = current_sample
                    .iter()
                    .map(|&idx| features[idx][feat_idx])
                    .collect();
                let min_val = feat_vals.iter().cloned().fold(f64::INFINITY, f64::min);
                let max_val = feat_vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                if max_val - min_val < 1e-10 {
                    break;
                }
                let split = rng.gen_range(min_val..=max_val);
                if point[feat_idx] < split {
                    current_sample = current_sample
                        .into_iter()
                        .filter(|&idx| features[idx][feat_idx] < split)
                        .collect();
                } else {
                    current_sample = current_sample
                        .into_iter()
                        .filter(|&idx| features[idx][feat_idx] >= split)
                        .collect();
                }
                depth += 1;
            }
            scores[i] += depth as f64;
        }
    }

    // Average across trees and normalize
    let c = if n > 1 {
        2.0 * (n as f64 - 1.0).ln() + 0.5772156649 - (2.0 * (n as f64 - 1.0)) / n as f64
    } else {
        1.0
    };

    for score in scores.iter_mut() {
        *score = *score / (n_trees as f64) / c;
    }

    scores
}

pub fn detect_anomalies(requests: &[serde_json::Value]) -> AnomalyResult {
    let total = requests.len();
    if total < 10 {
        return AnomalyResult {
            total_requests: total,
            anomalies_found: 0,
            contamination: 0.05,
            normal_count: total,
            anomalies: vec![],
        };
    }

    let features = extract_features(requests);
    let scores = isolation_forest_anomaly_scores(&features, 100, 0.05);

    let threshold_idx = (scores.len() as f64 * 0.95) as usize;
    let mut sorted_scores: Vec<(usize, f64)> = scores.iter().copied().enumerate().collect();
    sorted_scores.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    let threshold = sorted_scores.get(threshold_idx).map(|&(_, s)| s).unwrap_or(0.5);

    let anomalies: Vec<AnomalyItem> = scores
        .iter()
        .enumerate()
        .filter(|&(_, &score)| score > threshold)
        .map(|(i, &score)| {
            let url = requests[i]
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            AnomalyItem {
                index: i,
                url,
                score,
                features: features[i].clone(),
            }
        })
        .collect();

    let anomalies_found = anomalies.len();

    AnomalyResult {
        total_requests: total,
        anomalies_found,
        contamination: 0.05,
        normal_count: total - anomalies_found,
        anomalies,
    }
}
