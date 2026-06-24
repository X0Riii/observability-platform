use crate::analysis::anomaly::AnomalyResult;
use crate::analysis::dependency_graph::DependencyGraphResult;
use crate::analysis::third_party::ThirdPartyResult;
use crate::analysis::web_vitals::VitalStats;
use std::collections::HashMap;

pub fn generate_html_report(
    session_id: &str,
    dependency: &DependencyGraphResult,
    third_party: &ThirdPartyResult,
    vitals: &HashMap<String, VitalStats>,
    anomalies: &AnomalyResult,
) -> String {
    let mut html = String::new();

    html.push_str(r#"<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>"#);
    html.push_str(&format!("Analysis Report - {}", session_id));
    html.push_str(r#"</title><style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:-apple-system,sans-serif; background:#0f172a; color:#e2e8f0; padding:2rem; }
        h1 { color:#38bdf8; margin-bottom:1rem; }
        h2 { color:#818cf8; margin:1.5rem 0 0.5rem; border-bottom:1px solid #1e293b; padding-bottom:0.5rem; }
        table { width:100%; border-collapse:collapse; margin:1rem 0; }
        th,td { padding:0.5rem 1rem; text-align:left; border-bottom:1px solid #1e293b; }
        th { color:#94a3b8; font-weight:600; }
        .pass { color:#22c55e; }
        .fail { color:#ef4444; }
        .badge { display:inline-block; padding:0.25rem 0.75rem; border-radius:9999px; font-size:0.875rem; }
        .badge-analytics { background:#1e3a5f; color:#60a5fa; }
        .badge-ads { background:#5f1e1e; color:#f87171; }
        .badge-cdn { background:#1e5f1e; color:#4ade80; }
        .badge-tracking { background:#5f5f1e; color:#facc15; }
        .badge-chat { background:#3b1e5f; color:#c084fc; }
        .badge-social { background:#1e3b5f; color:#38bdf8; }
        .badge-utility { background:#3b3b3b; color:#d1d5db; }
        .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:1rem; margin:1rem 0; }
        .card { background:#1e293b; padding:1rem; border-radius:0.5rem; }
        .card h3 { color:#94a3b8; font-size:0.875rem; text-transform:uppercase; }
        .card .value { font-size:2rem; font-weight:700; color:#38bdf8; }
        .footer { margin-top:2rem; padding-top:1rem; border-top:1px solid #1e293b; color:#64748b; font-size:0.875rem; }
    </style></head><body>");

    html.push_str(&format!("<h1>Observability Analysis Report</h1>"));
    html.push_str(&format!("<p>Session: <code>{}</code></p>", session_id));

    // Summary cards
    html.push_str(r#"<div class="summary">"#);
    html.push_str(&format!(
        r#"<div class="card"><h3>Requests</h3><div class="value">{}</div></div>"#,
        dependency.nodes
    ));
    html.push_str(&format!(
        r#"<div class="card"><h3>Third-Party</h3><div class="value">{:.1}%</div></div>"#,
        third_party.percentage
    ));
    html.push_str(&format!(
        r#"<div class="card"><h3>Anomalies</h3><div class="value">{}</div></div>"#,
        anomalies.anomalies_found
    ));
    html.push_str(&format!(
        r#"<div class="card"><h3>Graph Density</h3><div class="value">{:.3}</div></div>"#,
        dependency.density
    ));
    html.push_str("</div>");

    // Third-party classification
    html.push_str("<h2>Third-Party Classification</h2>");
    if third_party.categories.is_empty() {
        html.push_str("<p>No third-party requests detected.</p>");
    } else {
        html.push_str("<table><thead><tr><th>Category</th><th>Count</th><th>Examples</th></tr></thead><tbody>");
        let mut cats: Vec<_> = third_party.categories.iter().collect();
        cats.sort_by(|a, b| b.1.count.cmp(&a.1.count));
        for (cat, info) in &cats {
            html.push_str(&format!(
                r#"<tr><td><span class="badge badge-{}">{}</span></td><td>{}</td><td>{}</td></tr>"#,
                cat,
                cat,
                info.count,
                info.urls.join(", ")
            ));
        }
        html.push_str("</tbody></table>");
    }

    // Web Vitals
    html.push_str("<h2>Core Web Vitals</h2>");
    if vitals.is_empty() {
        html.push_str("<p>No web vital data collected.</p>");
    } else {
        html.push_str(r#"<table><thead><tr><th>Metric</th><th>Average</th><th>P95</th><th>Range</th><th>Status</th></tr></thead><tbody>"#);
        for (metric, stats) in vitals {
            let status = match stats.pass {
                Some(true) => r#"<span class="pass">PASS</span>"#,
                Some(false) => r#"<span class="fail">FAIL</span>"#,
                None => "N/A",
            };
            html.push_str(&format!(
                r#"<tr><td>{}</td><td>{:.2}</td><td>{:.2}</td><td>{:.2} – {:.2}</td><td>{}</td></tr>"#,
                metric, stats.avg, stats.p95, stats.min, stats.max, status
            ));
        }
        html.push_str("</tbody></table>");
    }

    // Dependency Graph
    html.push_str("<h2>Dependency Graph</h2>");
    html.push_str(&format!(
        r#"<div class="summary">
            <div class="card"><h3>Nodes</h3><div class="value">{}</div></div>
            <div class="card"><h3>Edges</h3><div class="value">{}</div></div>
            <div class="card"><h3>Components</h3><div class="value">{}</div></div>
            <div class="card"><h3>Roots</h3><div class="value">{}</div></div>
            <div class="card"><h3>Leaves</h3><div class="value">{}</div></div>
            <div class="card"><h3>3rd Party</h3><div class="value">{}</div></div>
        </div>"#,
        dependency.nodes,
        dependency.edges,
        dependency.components,
        dependency.roots.len(),
        dependency.leaves.len(),
        dependency.third_parties.len()
    ));

    // Anomalies
    html.push_str("<h2>Anomaly Detection</h2>");
    if anomalies.anomalies.is_empty() {
        html.push_str("<p>No anomalies detected.</p>");
    } else {
        html.push_str(&format!("<p>Found <strong>{}</strong> anomalies out of <strong>{}</strong> requests (contamination: {:.0}%).</p>",
            anomalies.anomalies_found, anomalies.total_requests, anomalies.contamination * 100.0));
        html.push_str(r#"<table><thead><tr><th>#</th><th>URL</th><th>Score</th><th>Response Time</th><th>Size</th><th>Status</th></tr></thead><tbody>"#);
        for (i, anom) in anomalies.anomalies.iter().enumerate().take(20) {
            html.push_str(&format!(
                r#"<tr><td>{}</td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">{}</td><td>{:.4}</td><td>{:.0}ms</td><td>{:.0}KB</td><td>{:.0}</td></tr>"#,
                i + 1,
                anom.url,
                anom.score,
                anom.features.get(0).unwrap_or(&0.0) * 1000.0,
                anom.features.get(1).unwrap_or(&0.0),
                anom.features.get(2).unwrap_or(&0.0)
            ));
        }
        html.push_str("</tbody></table>");
    }

    html.push_str(&format!(
        r#"<div class="footer">Generated by Observability Platform v2.0 Rust Engine | {} | Session: {}</div>"#,
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC"),
        session_id
    ));
    html.push_str("</body></html>");

    html
}
