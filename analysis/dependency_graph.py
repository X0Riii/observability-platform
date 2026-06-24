import networkx as nx
from typing import Any
from datetime import datetime


def build_dependency_graph(requests: list[dict], storage_events: list[dict] | None = None) -> nx.DiGraph:
    G = nx.DiGraph()

    for req in requests:
        url = req.get("url") or req.get("payload", {}).get("url", "")
        if not url:
            continue
        resource_type = req.get("resourceType") or req.get("payload", {}).get("resourceType", "unknown")
        G.add_node(url, type=resource_type, ts=req.get("ts"))

        initiator_url = req.get("initiator", {}).get("url") if isinstance(req.get("initiator"), dict) else None
        if initiator_url:
            G.add_edge(initiator_url, url, type="initiates", ts=req.get("ts"))

    if storage_events:
        for ev in storage_events:
            payload = ev.get("payload", {})
            key = payload.get("key", "unknown")
            storage_type = payload.get("storage", "localStorage")
            script_url = ev.get("url")
            if script_url:
                G.add_edge(script_url, f"storage:{storage_type}:{key}", type="writes")

    return G


def analyze_dependency_graph(G: nx.DiGraph) -> dict[str, Any]:
    if G.number_of_nodes() == 0:
        return {"nodes": 0, "edges": 0}

    return {
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "density": nx.density(G),
        "roots": [n for n in G.nodes if G.in_degree(n) == 0],
        "leaves": [n for n in G.nodes if G.out_degree(n) == 0],
        "third_parties": [n for n in G.nodes if is_third_party(n)],
        "components": nx.number_weakly_connected_components(G),
    }


def is_third_party(url: str) -> bool:
    import re
    third_party_domains = [
        "google-analytics.com", "gtag", "segment.io", "mixpanel.com",
        "doubleclick.net", "googlesyndication.com", "amazon-adsystem.com",
        "cloudflare.com", "fastly.net", "akamaihd.net",
        "facebook.net", "hotjar.com",
        "intercom.io", "drift.com", "crisp.chat",
    ]
    return any(d in url for d in third_party_domains)
