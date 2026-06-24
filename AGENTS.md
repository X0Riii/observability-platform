## Goal
- Complete the Web Application Full Observability Platform v2.0 with collector, API, dashboard, analysis engine, distributed infrastructure, and a XAMPP-like control panel launcher.

## Constraints & Preferences
- All 9 roadmap phases implemented sequentially from Phase 1 to Phase 9.
- Monorepo with npm workspaces for TypeScript (collector, api, dashboard), Python for analysis (FastAPI), Rust for high-perf processing & API.
- PostgreSQL + TimescaleDB, OpenSearch, Kafka, MinIO, Redis as data infrastructure.
- Arabic user language for communication; code and comments in English only.
- Launcher supports both Docker and Podman runtimes (Podman fallback).

## Progress
### Done
- **Phase 1–9 foundation code** — All features implemented (HAR, DOM tracking, JS runtime, screenshots, rrweb snapshots, OpenSearch indices, timeline merger, JWT auth, dashboard, analysis engine, BullMQ, Prometheus, multi-tenancy, k6, K8s, Caddy).
- **Launcher (Control Panel)** — Express server at port 7070, 11-numbered services UI.
- **docker-compose.yml** — 8 services with healthchecks.
- **All services running** — 5 Podman containers (PostgreSQL, Kafka, OpenSearch, MinIO, Redis) + Node API (4000), Dashboard (3000), Rust API (4001).
- **Pipeline end-to-end** — Collector → Kafka → PostgreSQL + OpenSearch fully operational.
- **PostgreSQL dataflow** — Sessions, Pages, Requests (289), Responses (79), DOM events (51,751).
- **OpenSearch** — 6 indices populated.
- **Dashboard** — HTTP 200, proxied to API on port 4000.
- **Rust processor** — Binary at processing/observability-processor, port 9100.
- **Rust API server** — 25+ source files, compiled (0 errors), release binary at api-rust/target/release/observability-api, port 4001.
- **Rust API verification** — Health (200), Sessions list, Full-text search (POST), Facet aggregations, JWT auth login — all returning correct data.
- **GitHub repo created** — `github.com/X0Riii/observability-platform`, 84+ files, default branch `main`.

### Issues Fixed (14 items)
1. Saga distributed transactions: removed unnecessary saga markers, keep as scaffolding only.
2-13. Same as before.
14. **Rust API compilation** — 31 errors fixed: s3 crate API mismatch, rdkafka API changes (no Clone, fetch_metadata, Message trait), opensearch builder patterns, IntoResponse types, StreamConsumer creation via ClientConfig, BorrowedMessage lifetime via detach(), missing `mod db`, Extension replaced with HeaderMap.
15. **Rust API search route** — Changed from `get` to `post` (search uses JSON body, not query params).

### Known Notes
- **Screenshots** — Google blocks headless. Non-blocking.
- **request↔response correlation** — `cdp_request_id` column not yet added. FK dropped so inserts succeed.
- **OpenSearch facet aggregations** — 0 buckets for non-URL indices. Non-critical.
- **Rust API Kafka** — Port was `9093` in default config, corrected to `9092`. Consumer subscribes to topics.
- **Build workaround** — Source copied to `/tmp/opencode/api-rust/` (no spaces), `CARGO_TARGET_DIR=/tmp/opencode/rust-target`.

## Next Steps
1. Run collector against Google to test full pipeline through Rust API (vs Node API).
2. Verify Dashboard at http://localhost:3000 renders live data.
3. Add `cdp_request_id` column for proper FK join between requests and responses.
4. Push updated code to GitHub (api-rust/, launcher, AGENTS.md).

## Critical Context
- Node.js v22.22.22, Playwright 1.61.1, Python 3.14.6, Rust 1.96.0.
- Podman (not Docker) — launcher fallback mode, `--network host`.
- Kafka 7.6.0 KRaft: port 9092 (PLAINTEXT), CLUSTER_ID base64 UUID, topic pre-creation.
- OpenSearch 2.18.0 NPE bug — avoid `date_histogram` aggregations.
- Rust API build must use `/tmp/opencode/api-rust/` (no spaces in path) with `CARGO_TARGET_DIR=/tmp/opencode/rust-target`.
- `s3` crate v0.1 by lvillis (NOT `rust-s3`) — uses Client::builder() + ObjectsService/BucketsService.
- `rdkafka::message::Message` trait required for `payload()/topic()/key()`.
- `StreamConsumer` is not Clone — wrap in `Arc<StreamConsumer>`.
- `BorrowedMessage` lifetime fix: detach to `OwnedMessage` via `.detach()`.
- JWT auth in `me` handler uses `HeaderMap` (not `Extension<Claims>`) for axum compatibility.

## Relevant Files
- `/home/px0/Templates/ALLSEER Sentinel/App/launcher/server.js`: Launcher (services 1–11).
- `/home/px0/Templates/ALLSEER Sentinel/App/docker-compose.yml`: 8 services.
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/main.rs`: Rust API entry point, AppState, 14 routes.
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/minio.rs`: MinIO client (s3 crate 0.1).
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/routes/`: sessions, pages, requests, auth (HeaderMap), health, ws.
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/search/`: client, indexer, routes, index_rules.
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/db/`: schema, pool, indexer.
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/analysis/`: anomaly, web_vitals, dependency_graph, third_party, report.
- `/home/px0/Templates/ALLSEER Sentinel/App/api-rust/src/timeline/merger.rs`: Timeline merger.
- `/home/px0/Templates/ALLSEER Sentinel/App/processing/`: Rust processor binary.
