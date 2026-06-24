use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThirdPartyResult {
    pub total_requests: usize,
    pub third_party_requests: usize,
    pub percentage: f64,
    pub categories: HashMap<String, ThirdPartyCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThirdPartyCategory {
    pub count: usize,
    pub urls: Vec<String>,
}

const KNOWN_THIRD_PARTIES: &[(&str, &[&str])] = &[
    ("analytics", &["google-analytics.com", "gtag", "segment.io", "mixpanel.com", "amplitude.com", "heap.io"]),
    ("ads", &["doubleclick.net", "googlesyndication.com", "amazon-adsystem.com", "adservice.google.com"]),
    ("cdn", &["cloudflare.com", "fastly.net", "akamaihd.net", "jsdelivr.net", "unpkg.com", "cdn.jsdelivr.net"]),
    ("tracking", &["facebook.net", "twitter.com/i/adsct", "hotjar.com", "fullstory.com", "mouseflow.com"]),
    ("chat", &["intercom.io", "drift.com", "crisp.chat", "zendesk.com", "livechat.com"]),
    ("social", &["facebook.com/plugins", "platform.twitter.com", "linkedin.com/embed"]),
    ("utility", &["recaptcha.net", "hcaptcha.com", "stripe.com", "paypal.com"]),
];

pub fn classify_request(url: &str) -> Option<&'static str> {
    for &(category, domains) in KNOWN_THIRD_PARTIES {
        if domains.iter().any(|d| url.contains(d)) {
            return Some(category);
        }
    }
    None
}

pub fn analyze_third_parties(requests: &[serde_json::Value]) -> ThirdPartyResult {
    let total = requests.len();
    let mut categories: HashMap<String, ThirdPartyCategory> = HashMap::new();
    let mut third_party_count = 0;

    for req in requests {
        let url = req.get("url").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(category) = classify_request(url) {
            third_party_count += 1;
            let entry = categories
                .entry(category.to_string())
                .or_insert_with(|| ThirdPartyCategory {
                    count: 0,
                    urls: vec![],
                });
            entry.count += 1;
            if entry.urls.len() < 5 && !entry.urls.contains(&url.to_string()) {
                entry.urls.push(url.to_string());
            }
        }
    }

    let percentage = if total > 0 {
        ((third_party_count as f64 / total as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    ThirdPartyResult {
        total_requests: total,
        third_party_requests: third_party_count,
        percentage,
        categories,
    }
}
