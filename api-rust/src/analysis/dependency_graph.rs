use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::algo;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyGraphResult {
    pub nodes: usize,
    pub edges: usize,
    pub density: f64,
    pub roots: Vec<String>,
    pub leaves: Vec<String>,
    pub third_parties: Vec<String>,
    pub components: usize,
}

fn is_third_party(url: &str) -> bool {
    let known_domains = [
        "google-analytics.com", "gtag", "segment.io", "mixpanel.com",
        "doubleclick.net", "googlesyndication.com", "amazon-adsystem.com",
        "cloudflare.com", "fastly.net", "akamaihd.net", "facebook.net",
        "hotjar.com", "intercom.io", "drift.com", "crisp.chat",
    ];
    known_domains.iter().any(|d| url.contains(d))
}

pub fn build_and_analyze(
    requests: &[serde_json::Value],
    storage_events: Option<&[serde_json::Value]>,
) -> DependencyGraphResult {
    let mut graph = DiGraph::<String, String>::new();
    let mut node_indices: HashMap<String, NodeIndex> = HashMap::new();

    for req in requests {
        let url = req.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if url.is_empty() {
            continue;
        }

        let idx = *node_indices.entry(url.clone()).or_insert_with(|| graph.add_node(url.clone()));

        let resource_type = req.get("resourceType").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(node) = graph.node_weight_mut(idx) {
            if !node.contains(resource_type) {
                node.push_str(&format!(" [{}]", resource_type));
            }
        }

        // Edge: initiator_url -> url
        if let Some(initiator) = req
            .get("initiator")
            .or_else(|| req.pointer("/payload/initiator"))
            .and_then(|i| i.get("url"))
            .and_then(|v| v.as_str())
        {
            if !initiator.is_empty() {
                let init_idx = *node_indices
                    .entry(initiator.to_string())
                    .or_insert_with(|| graph.add_node(initiator.to_string()));
                if !graph.contains_edge(init_idx, idx) {
                    graph.add_edge(init_idx, idx, "initiates".to_string());
                }
            }
        }
    }

    // Storage edges
    if let Some(storage) = storage_events {
        for ev in storage {
            let script_url = ev
                .get("payload")
                .and_then(|p| p.get("scriptUrl"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let storage_type = ev
                .get("payload")
                .and_then(|p| p.get("storageType"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            let key = ev
                .get("payload")
                .and_then(|p| p.get("key"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            if !script_url.is_empty() {
                let storage_node_id = format!("storage:{}:{}", storage_type, key);
                let src_idx = *node_indices
                    .entry(script_url.to_string())
                    .or_insert_with(|| graph.add_node(script_url.to_string()));
                let dst_idx = *node_indices
                    .entry(storage_node_id.clone())
                    .or_insert_with(|| graph.add_node(storage_node_id));
                if !graph.contains_edge(src_idx, dst_idx) {
                    graph.add_edge(src_idx, dst_idx, "writes".to_string());
                }
            }
        }
    }

    let nodes = graph.node_count();
    let edges = graph.edge_count();

    if nodes == 0 {
        return DependencyGraphResult {
            nodes: 0, edges: 0, density: 0.0,
            roots: vec![], leaves: vec![], third_parties: vec![], components: 0,
        };
    }

    let density = if nodes > 1 {
        let max_edges = nodes * (nodes - 1);
        edges as f64 / max_edges as f64
    } else {
        0.0
    };

    let roots: Vec<String> = graph
        .node_indices()
        .filter(|&n| graph.neighbors_directed(n, petgraph::Direction::Incoming).count() == 0)
        .filter_map(|n| graph.node_weight(n).cloned())
        .collect();

    let leaves: Vec<String> = graph
        .node_indices()
        .filter(|&n| graph.neighbors_directed(n, petgraph::Direction::Outgoing).count() == 0)
        .filter_map(|n| graph.node_weight(n).cloned())
        .collect();

    let third_parties: Vec<String> = graph
        .node_indices()
        .filter_map(|n| graph.node_weight(n))
        .filter(|n| is_third_party(n))
        .cloned()
        .collect();

    let components = petgraph::algo::connected_components(&graph);

    DependencyGraphResult {
        nodes,
        edges,
        density: (density * 1000.0).round() / 1000.0,
        roots,
        leaves,
        third_parties,
        components,
    }
}
