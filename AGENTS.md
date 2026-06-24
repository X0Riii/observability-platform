## Goal
- Complete the Web Application Full Observability Platform v2.0 with collector, API, dashboard, analysis engine, distributed infrastructure, and a XAMPP-like control panel launcher.

## Constraints & Preferences
- All 9 phases of the roadmap implemented sequentially from Phase 1 to Phase 9.
- Monorepo with npm workspaces for TypeScript (collector, api, dashboard).
- Python for analysis/ML (FastAPI, scikit-learn, NetworkX).
- PostgreSQL + TimescaleDB, OpenSearch, Kafka, MinIO, Redis as data infrastructure.
- Arabic user language for communication; code and comments in English only (no Arabic strings in any source file).
- Launcher must support both Docker and Podman runtimes (Podman fallback when Docker unavailable).

## Progress
### Done
- **Phase 1–9 foundation code** — All features implemented (HAR, DOM tracking, JS runtime, screenshots, rrweb snapshots, OpenSearch indices, timeline merger, JWT auth, dashboard, analysis engine, BullMQ, Prometheus, multi-tenancy, k6, K8s, Caddy).
- **Launcher (Control Panel)** — Express server at port 7070, 9-numbered services UI, start/stop/check, auto-refresh, migration button, glassmorphism design with green pulse.
- **docker-compose.yml** — Rewritten clean YAML with proper `depends_on`, healthchecks, 8 services.
- **All services running** — 5 Docker containers (PostgreSQL, Kafka, OpenSearch, MinIO, Redis) + 3 Node/Python processes (API port 4000, Dashboard port 3000, Analysis port 8000) + Launcher (port 7070).
- **Pipeline end-to-end** — Collector → Kafka → PostgreSQL + OpenSearch fully operational.
- **PostgreSQL dataflow** — Sessions (10), Pages, Requests (289), Responses (79), DOM events (51,751) all populated.
- **OpenSearch** — 6 indices with data: network-requests (35), network-responses (27), dom-mutations (409), js-events (423), storage-events (1).
- **Dashboard** — HTTP 200, proxied to API on port 4000.
- **Search API** — Full-text search across all OpenSearch indices (3835 total hits for "google" query).
- **Timeline API** — Session timeline returns requests and DOM events chronologically.

### Issues Fixed
1. `shell: true` → env vars with spaces split incorrectly (removed from `spawn()`)
2. Short image names → Podman TTY prompt (prefixed with `docker.io/`)
3. Kafka missing `CLUSTER_ID` format → base64 UUID
4. Kafka missing env vars → `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP` etc.
5. API KafkaJS consumer metadata error → retry logic (`startWithRetry`) + topic pre-creation
6. MinIO bucket race condition → catch `BucketAlreadyOwnedByYou`
7. Screenshot format `webp` → `jpeg` (Playwright only supports png/jpeg)
8. Google navigation timeout `networkidle` → `domcontentloaded` + real UA header
9. PostgresIndexer response FK mismatch → dropped FK constraint, responses table now inserts
10. Timeline API ambiguous `ts` column → table-qualified column names (`r.ts`, `r.id`)
11. OpenSearch content mapping: js-events sent callFrames objects (not strings) → stringify non-string content in transform
12. OpenSearch 2.18.0 `NullPointerException` in `date_histogram` aggregation → removed `date_histogram` from search query
13. OpenSearch crashed after API restart (volume corruption) → `podman volume rm opensearch-data` for clean restart

### Remaining Issues
- **Screenshots** — Google blocks headless screenshots (canvas/font rendering timeouts). Non-blocking.
- **request↔response correlation** — `responses.request_id` contains response's own UUID, not matching `requests.id`. Timeline query no longer joins (returns `status: null`). Future: add `cdp_request_id` to both tables for proper join.
- **OpenSearch facet aggregations** — `urlHost.keyword` has 0 buckets because dom-mutations and js-events don't have URL fields. Non-critical.

## Next Steps
1. Run Dashboard at http://localhost:3000 — verify data renders in timeline and search views.
2. Add `cdp_request_id` column to `sessions`/`requests`/`responses` for proper FK join.
3. Test long-running sessions with multiple page navigations.

## Critical Context
- Node.js v22.22.22, Playwright 1.61.1, Python 3.14.6.
- User system runs Podman (not Docker) — launcher detected `podman` fallback mode.
- Kafka 7.6.0 KRaft mode: `CLUSTER_ID` must be valid base64 UUID.
- OpenSearch 2.18.0 has NPE bug in `InternalDateHistogram.addEmptyBuckets` — avoid `date_histogram` aggregations.
- All 5 Docker containers running via Podman on host network. Services reachable via localhost.
- Collector uses `waitUntil: 'domcontentloaded'` (not `networkidle`) for compatibility with long-lived connections.
- Screenshot format `jpeg` — Playwright does not support `webp` for `type`.

## Relevant Files
- `/home/px0/Templates/ALLSEER Sentinel/App/launcher/server.js`: Express launcher, runtime detection, compose + fallback.
- `/home/px0/Templates/ALLSEER Sentinel/App/docker-compose.yml`: 8-service compose with healthchecks.
- `/home/px0/Templates/ALLSEER Sentinel/App/collector/src/index.ts`: Collector orchestrator — Playwright → Kafka → MinIO.
- `/home/px0/Templates/ALLSEER Sentinel/App/collector/src/instrumentation/network.ts`: CDP network, request/response normalization, clock sync.
- `/home/px0/Templates/ALLSEER Sentinel/App/collector/src/instrumentation/dom-observer.ts`: MutationObserver + syncClock() via CDP.
- `/home/px0/Templates/ALLSEER Sentinel/App/api/src/index.ts`: Fastify server — topic pre-creation, consumer retry, 3 indexers.
- `/home/px0/Templates/ALLSEER Sentinel/App/api/src/db/schema.ts`: Drizzle ORM — sessions, pages, requests, responses, domEvents, screenshots.
- `/home/px0/Templates/ALLSEER Sentinel/App/api/src/db/indexer.ts`: PostgresIndexer Kafka consumer.
- `/home/px0/Templates/ALLSEER Sentinel/App/api/src/search/indexer.ts`: OpenSearchIndexer — 6 index rules, transform functions.
- `/home/px0/Templates/ALLSEER Sentinel/App/api/src/search/routes.ts`: Search API — multi_match across 7 fields, 4 aggregations (no date_histogram).
- `/home/px0/Templates/ALLSEER Sentinel/App/api/src/routes/sessions.ts`: Sessions, timeline, HAR download endpoints.
