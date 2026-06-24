# Web Application Full Observability Platform
### Technical Roadmap — v2.0

> منصة مراقبة شاملة للمتصفح تجمع بين التسجيل والفهرسة والتحليل وإعادة التشغيل لكل ما يجري على جانب العميل.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Core Components — Deep Dive](#3-core-components--deep-dive)
4. [Data Pipeline & Event Bus](#4-data-pipeline--event-bus)
5. [Storage Architecture](#5-storage-architecture)
6. [API Layer](#6-api-layer)
7. [Frontend Dashboard](#7-frontend-dashboard)
8. [Advanced Analysis Engine](#8-advanced-analysis-engine)
9. [Security & Compliance](#9-security--compliance)
10. [Deployment & Infrastructure](#10-deployment--infrastructure)
11. [Development Phases](#11-development-phases)
12. [Performance Targets & SLAs](#12-performance-targets--slas)
13. [Open Source References](#13-open-source-references)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TARGET BROWSER / PAGE                        │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│   │ Network Layer│  │  DOM Engine  │  │   JS Runtime Observer    │ │
│   └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘ │
└──────────┼────────────────┼──────────────────────────┼─────────────┘
           │                │                          │
           ▼                ▼                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COLLECTOR AGENT (TypeScript)                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Event Normalizer & Timestamper                   │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EVENT BUS (Apache Kafka)                         │
│   Topics: network | dom | js-runtime | storage | screenshot | perf  │
└───────────┬─────────────────┬──────────────────────┬────────────────┘
            │                 │                      │
            ▼                 ▼                      ▼
   ┌─────────────┐   ┌─────────────────┐   ┌────────────────┐
   │  PostgreSQL  │   │  Object Storage │   │   OpenSearch   │
   │  (Metadata) │   │  MinIO / S3     │   │  (Full-text)   │
   └──────┬──────┘   └────────┬────────┘   └───────┬────────┘
          │                   │                     │
          └──────────┬────────┘                     │
                     ▼                              │
           ┌──────────────────┐                     │
           │  Analysis Engine │◄────────────────────┘
           │  (Python + Rust) │
           └────────┬─────────┘
                    │
                    ▼
          ┌──────────────────┐
          │  React Dashboard │
          │  Timeline/Replay │
          └──────────────────┘
```

---

## 2. Technology Stack

### 2.1 Languages & Runtimes

| Layer | Language | Version | Justification |
|---|---|---|---|
| Collector Agent | TypeScript | 5.x | Native browser + Playwright ecosystem |
| High-Perf Processing | Rust | 1.78+ | Zero-copy parsing, SIMD compression |
| Analysis & ML | Python | 3.12+ | pandas, scikit-learn, ONNX |
| Build Tooling | Node.js | 22 LTS | ESM native, fast startup |

### 2.2 Runtime Dependencies

```
Browser Automation:    Playwright 1.44+ (Chromium, CDP protocol)
Event Bus:             Apache Kafka 3.7 (or Redpanda for lower latency)
Primary DB:            PostgreSQL 16 + TimescaleDB extension
Object Storage:        MinIO (self-hosted) or AWS S3
Search:                OpenSearch 2.x
Compression:           Zstandard (ZSTD) level 3–6
Session Replay:        rrweb 2.x (integrated)
Container Runtime:     Docker + Kubernetes (K3s for edge)
Reverse Proxy:         Caddy v2 (auto-HTTPS)
```

### 2.3 Frontend

```
Framework:      React 19 + TypeScript
Build:          Vite 6
Styling:        Tailwind CSS v4
State:          Zustand + React Query (TanStack)
Visualization:  D3.js v7, Recharts, deck.gl (for large datasets)
Replay Engine:  rrweb-player
Timeline:       Custom canvas-based renderer
```

---

## 3. Core Components — Deep Dive

### 3.1 Browser Instrumentation Layer

**Responsibilities:** Full network interception via CDP, WebSocket framing, Service Worker activity.

```typescript
// collector/src/instrumentation/network.ts

import { CDPSession, Page } from 'playwright';

export interface NormalizedRequest {
  id:           string;       // UUID v7 (time-sortable)
  sessionId:    string;
  timestamp:    number;       // Unix ms
  method:       string;
  url:          string;
  headers:      Record<string, string>;
  postData?:    string;
  resourceType: ResourceType;
  initiator:    RequestInitiator;
}

export class NetworkInstrumentation {
  private cdp: CDPSession;
  private eventBus: EventEmitter;

  async attach(page: Page): Promise<void> {
    this.cdp = await page.context().newCDPSession(page);

    await this.cdp.send('Network.enable', {
      maxTotalBufferSize:    104857600, // 100MB
      maxResourceBufferSize: 10485760,  // 10MB
    });

    // Capture requests
    this.cdp.on('Network.requestWillBeSent', (params) => {
      this.eventBus.emit('network:request', this.normalizeRequest(params));
    });

    // Capture full response bodies
    this.cdp.on('Network.responseReceived', async (params) => {
      const body = await this.cdp.send('Network.getResponseBody', {
        requestId: params.requestId
      }).catch(() => null);

      this.eventBus.emit('network:response', {
        ...this.normalizeResponse(params),
        body: body?.body ?? null,
        base64Encoded: body?.base64Encoded ?? false,
      });
    });

    // WebSocket frames
    this.cdp.on('Network.webSocketFrameSent',     this.onWSFrame.bind(this, 'sent'));
    this.cdp.on('Network.webSocketFrameReceived', this.onWSFrame.bind(this, 'received'));
  }
}
```

**Events captured:**
- `requestWillBeSent` → headers, POST body, initiator stack
- `responseReceived` → status, headers, timing
- `loadingFinished` → total bytes, compressed bytes
- `loadingFailed` → net error, canceled state
- `webSocketCreated / FrameSent / FrameReceived / Closed`
- `signedExchangeReceived` (for SXG pages)

---

### 3.2 DOM Observation Engine

**Strategy:** Inject `MutationObserver` + intercept `innerHTML`, `insertAdjacentHTML`, `document.write` via Proxy.

```typescript
// collector/src/instrumentation/dom-observer.ts

const OBSERVER_SCRIPT = `
(function() {
  const _emit = (type, data) => window.__obsEmit({ type, data, ts: performance.now() });

  // MutationObserver for structural changes
  const mo = new MutationObserver((mutations) => {
    const batch = mutations.map(m => ({
      type:       m.type,
      target:     getNodePath(m.target),
      addedNodes: [...m.addedNodes].map(serializeNode),
      removedNodes: [...m.removedNodes].map(serializeNode),
      attributeName: m.attributeName,
      oldValue:   m.oldValue,
    }));
    _emit('dom:mutation', batch);
  });

  mo.observe(document.documentElement, {
    childList:             true,
    subtree:               true,
    attributes:            true,
    attributeOldValue:     true,
    characterData:         true,
    characterDataOldValue: true,
  });

  // Shadow DOM: intercept attachShadow
  const _attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = _attachShadow.call(this, init);
    mo.observe(root, { childList: true, subtree: true, attributes: true });
    _emit('dom:shadowRoot', { host: getNodePath(this) });
    return root;
  };
})();
`;
```

**Node serialization schema:**
```typescript
interface SerializedNode {
  nodeType:   number;
  nodeName:   string;
  nodeValue?: string;
  attributes?: Record<string, string>;
  path:       string;   // CSS selector path (unique)
  rrwebId?:   number;   // for rrweb cross-reference
}
```

---

### 3.3 JavaScript Runtime Observer

Uses **CDP Runtime** and **Debugger** domains to capture scripts without modifying source.

```typescript
// Attach CDP Debugger domain
await cdp.send('Debugger.enable');
await cdp.send('Runtime.enable');

// Catch eval / new Function
await cdp.send('Runtime.setAsyncCallStackDepth', { maxDepth: 32 });

cdp.on('Debugger.scriptParsed', (params) => {
  emit('js:script', {
    scriptId:    params.scriptId,
    url:         params.url,
    sourceMapURL: params.sourceMapURL,
    hash:        params.hash,
    isModule:    params.isModule,
    length:      params.length,
    startLine:   params.startLine,
  });
});

// Exceptions
cdp.on('Runtime.exceptionThrown', (params) => {
  emit('js:exception', {
    timestamp:   params.timestamp,
    message:     params.exceptionDetails.text,
    stack:       params.exceptionDetails.stackTrace,
    scriptId:    params.exceptionDetails.scriptId,
    lineNumber:  params.exceptionDetails.lineNumber,
  });
});

// Console intercept
cdp.on('Runtime.consoleAPICalled', (params) => {
  emit('js:console', {
    type:      params.type,           // log|warn|error|info|debug|table
    args:      params.args,
    stackTrace: params.stackTrace,
    timestamp:  params.timestamp,
  });
});
```

---

### 3.4 Storage Observer

```typescript
// Proxy LocalStorage / SessionStorage writes
const STORAGE_HOOK = `
['localStorage', 'sessionStorage'].forEach(storageName => {
  const storage = window[storageName];
  const _setItem = storage.__proto__.setItem;
  const _removeItem = storage.__proto__.removeItem;
  const _clear = storage.__proto__.clear;

  storage.__proto__.setItem = function(key, value) {
    window.__obsEmit({ type: 'storage:set', storage: storageName, key, value });
    return _setItem.call(this, key, value);
  };

  storage.__proto__.removeItem = function(key) {
    window.__obsEmit({ type: 'storage:remove', storage: storageName, key });
    return _removeItem.call(this, key);
  };

  storage.__proto__.clear = function() {
    window.__obsEmit({ type: 'storage:clear', storage: storageName });
    return _clear.call(this);
  };
});
`;
```

**Cookie tracking** via CDP:
```typescript
// Poll every 500ms for cookie changes (CDP doesn't have cookie events)
const pollCookies = async () => {
  const { cookies } = await cdp.send('Network.getAllCookies');
  const snapshot = hashCookies(cookies);
  if (snapshot !== previousSnapshot) {
    emit('storage:cookies', { cookies, delta: diff(previous, cookies) });
    previousSnapshot = snapshot;
  }
};

setInterval(pollCookies, 500);
```

**IndexedDB via CDP Storage domain:**
```typescript
await cdp.send('Storage.trackIndexedDBForOrigin', { origin });
cdp.on('Storage.indexedDBContentUpdated', (params) => {
  emit('storage:indexeddb', params);
});
```

---

### 3.5 Screenshot Engine

```typescript
interface ScreenshotConfig {
  triggers: ScreenshotTrigger[];
  format:   'webp' | 'png';
  quality:  number;        // 1–100, WebP only
  fullPage: boolean;
  maxWidth: number;        // resize to reduce storage
}

type ScreenshotTrigger =
  | { type: 'navigation' }
  | { type: 'interval';   intervalMs: number }
  | { type: 'domMutation'; debounceMs: number; threshold: number }
  | { type: 'networkIdle' }
  | { type: 'manual' };

// Adaptive screenshot: skip if visually identical (SSIM > 0.99)
async function captureAdaptive(page: Page, lastHash: string): Promise<Buffer | null> {
  const buf = await page.screenshot({ type: 'webp', quality: 80 });
  const hash = await perceptualHash(buf);
  if (hammingDistance(hash, lastHash) < SIMILARITY_THRESHOLD) return null;
  return buf;
}
```

---

### 3.6 Snapshot Engine

Stores two flavors of HTML snapshot:

| Type | Description | Storage |
|---|---|---|
| `source_html` | Raw `page.content()` before JS execution | MinIO (ZSTD compressed) |
| `rendered_dom` | rrweb full snapshot (serialized vDOM) | MinIO (ZSTD compressed) |
| `har_file` | HAR 1.3 with response bodies | MinIO (ZSTD compressed) |
| `accessibility_tree` | CDP `Accessibility.getFullAXTree` | PostgreSQL JSONB |

---

### 3.7 Timeline Engine

Central event collector that merges all streams with monotonic clock correction.

```typescript
interface TimelineEvent {
  id:        string;          // UUID v7
  sessionId: string;
  pageId:    string;
  ts:        number;          // Unix epoch ms (UTC)
  tsPage:    number;          // performance.now() relative to navigation
  type:      EventType;
  subtype:   string;
  payload:   unknown;
  seq:       number;          // monotonic sequence per session
}

type EventType =
  | 'navigation'
  | 'network'
  | 'dom'
  | 'js'
  | 'storage'
  | 'screenshot'
  | 'performance'
  | 'console'
  | 'websocket'
  | 'worker';
```

Clock synchronization:
```typescript
// Align CDP timestamps (monotonic since browser start) to Unix time
const offset = Date.now() - (await cdp.send('Runtime.evaluate', {
  expression: 'Date.now()'
})).result.value;
```

---

## 4. Data Pipeline & Event Bus

### 4.1 Kafka Topic Design

```
Topic                    Partitions   Retention    Compression
─────────────────────────────────────────────────────────────
obs.network.requests     16           7d           lz4
obs.network.responses    16           7d           zstd
obs.dom.mutations        8            7d           lz4
obs.js.events            8            7d           lz4
obs.storage.events       4            30d          zstd
obs.screenshots          4            3d           (binary, no compression)
obs.performance          4            30d          zstd
obs.timeline.merged      32           30d          zstd
```

### 4.2 Stream Processors (Kafka Streams / Faust)

```python
# processors/timeline_merger.py
import faust

app = faust.App('obs-merger', broker='kafka://kafka:9092')

network_topic   = app.topic('obs.network.requests',  value_type=NetworkEvent)
dom_topic       = app.topic('obs.dom.mutations',      value_type=DomEvent)
merged_topic    = app.topic('obs.timeline.merged',    value_type=TimelineEvent)

@app.agent(network_topic)
async def process_network(stream):
    async for event in stream:
        merged = TimelineEvent(
            id=uuid7(),
            type='network',
            ts=event.timestamp,
            payload=event,
        )
        await merged_topic.send(value=merged)
```

### 4.3 Consumer Groups

```
consumer-group-postgres   → writes metadata to PostgreSQL
consumer-group-opensearch → indexes searchable fields
consumer-group-minio      → uploads raw blobs
consumer-group-analysis   → feeds ML pipeline
consumer-group-realtime   → WebSocket push to dashboard
```

---

## 5. Storage Architecture

### 5.1 PostgreSQL Schema (Core Tables)

```sql
-- Sessions
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  url_seed    TEXT,
  user_agent  TEXT,
  metadata    JSONB
);

-- Pages visited within a session
CREATE TABLE pages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID REFERENCES sessions(id),
  url         TEXT NOT NULL,
  title       TEXT,
  navigated_at TIMESTAMPTZ NOT NULL,
  load_time_ms INTEGER,
  status_code  SMALLINT
);

-- Network requests
CREATE TABLE requests (
  id             UUID PRIMARY KEY,
  page_id        UUID REFERENCES pages(id),
  ts             TIMESTAMPTZ NOT NULL,
  method         VARCHAR(10),
  url            TEXT NOT NULL,
  url_host       TEXT GENERATED ALWAYS AS (split_part(url, '/', 3)) STORED,
  resource_type  VARCHAR(32),
  initiator_type VARCHAR(32),
  headers        JSONB,
  post_data_ref  TEXT    -- MinIO object key
) PARTITION BY RANGE (ts);

-- Responses
CREATE TABLE responses (
  request_id     UUID REFERENCES requests(id),
  ts             TIMESTAMPTZ NOT NULL,
  status         SMALLINT,
  status_text    VARCHAR(64),
  headers        JSONB,
  body_ref       TEXT,      -- MinIO object key for body blob
  body_size      INTEGER,
  transfer_size  INTEGER,
  mime_type      VARCHAR(128),
  timing         JSONB      -- CDP timing breakdown
) PARTITION BY RANGE (ts);

-- DOM events
CREATE TABLE dom_events (
  id         UUID PRIMARY KEY,
  page_id    UUID REFERENCES pages(id),
  ts         TIMESTAMPTZ NOT NULL,
  ts_page_ms REAL,          -- performance.now()
  mutation_type VARCHAR(32),
  target_path   TEXT,
  payload       JSONB
) PARTITION BY RANGE (ts);

-- WebSocket events
CREATE TABLE ws_events (
  id          UUID PRIMARY KEY,
  request_id  UUID REFERENCES requests(id),
  ts          TIMESTAMPTZ NOT NULL,
  direction   VARCHAR(8),  -- 'sent' | 'received'
  opcode      SMALLINT,
  payload_ref TEXT,
  masked      BOOLEAN
);

-- Screenshots
CREATE TABLE screenshots (
  id         UUID PRIMARY KEY,
  page_id    UUID REFERENCES pages(id),
  ts         TIMESTAMPTZ NOT NULL,
  trigger    VARCHAR(32),
  format     VARCHAR(8),
  width      SMALLINT,
  height     SMALLINT,
  file_size  INTEGER,
  object_key TEXT NOT NULL,  -- MinIO
  perceptual_hash BIGINT     -- for deduplication
);

-- TimescaleDB hypertable for time-series perf metrics
SELECT create_hypertable('dom_events', 'ts');
SELECT create_hypertable('requests',   'ts');
```

**Indexes:**
```sql
CREATE INDEX idx_requests_url_host  ON requests (url_host, ts DESC);
CREATE INDEX idx_requests_page      ON requests (page_id, ts DESC);
CREATE INDEX idx_dom_target         ON dom_events USING gin(payload jsonb_path_ops);
CREATE INDEX idx_responses_mime     ON responses (mime_type, ts DESC);
```

### 5.2 MinIO Bucket Layout

```
obs-raw/
├── sessions/{session_id}/
│   ├── source.html.zst          # initial HTML
│   ├── rendered.rrweb.json.zst  # rrweb snapshot
│   └── session.har.zst          # full HAR
├── responses/{request_id}.zst   # response bodies
├── screenshots/{page_id}/{ts}_{trigger}.webp
└── scripts/{hash}.js            # deduplicated JS files
```

### 5.3 OpenSearch Index Mapping

```json
{
  "mappings": {
    "properties": {
      "session_id":  { "type": "keyword" },
      "page_id":     { "type": "keyword" },
      "ts":          { "type": "date", "format": "epoch_millis" },
      "type":        { "type": "keyword" },
      "url":         { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "content":     { "type": "text", "analyzer": "standard" },
      "headers":     { "type": "object", "enabled": false },
      "console_msg": { "type": "text" },
      "dom_text":    { "type": "text" }
    }
  },
  "settings": {
    "number_of_shards":   4,
    "number_of_replicas": 1,
    "index.codec":        "best_compression"
  }
}
```

---

## 6. API Layer

### 6.1 REST API (Fastify + TypeScript)

```
GET    /api/sessions                     # list sessions
GET    /api/sessions/:id                 # session detail
GET    /api/sessions/:id/timeline        # full merged timeline
GET    /api/sessions/:id/har             # download HAR file
GET    /api/pages/:id/screenshots        # screenshots list
GET    /api/pages/:id/snapshot           # rrweb snapshot JSON
GET    /api/requests/:id/body            # response body (streamed)
POST   /api/search                       # OpenSearch full-text query
GET    /api/ws/stream/:sessionId         # WebSocket real-time feed
```

### 6.2 WebSocket Real-time Feed

```typescript
// Real-time dashboard push
wss.on('connection', (ws, req) => {
  const sessionId = getSessionId(req);
  const consumer = kafka.consumer({ groupId: `rt-${uuid()}` });

  consumer.subscribe({ topic: 'obs.timeline.merged' });
  consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value!.toString());
      if (event.sessionId === sessionId) {
        ws.send(JSON.stringify(event));
      }
    }
  });

  ws.on('close', () => consumer.disconnect());
});
```

---

## 7. Frontend Dashboard

### 7.1 Views

| View | Description |
|---|---|
| **Session List** | Searchable table of recorded sessions |
| **Timeline Viewer** | Zoomable swimlane (network / DOM / JS / storage) |
| **Network Explorer** | Waterfall chart with filters by type/host/status |
| **DOM Explorer** | Diffable DOM tree with mutation timeline |
| **Replay Player** | rrweb replay with timeline scrubber |
| **WebSocket Viewer** | Frame-by-frame WS conversation viewer |
| **Storage Explorer** | Cookie/localStorage/IndexedDB diff viewer |
| **JS Inventory** | Script catalog with hash deduplication |
| **Search** | Full-text across URLs, headers, console, DOM text |
| **Performance** | LCP / CLS / FCP / TTFB waterfall + Core Web Vitals |
| **Dependency Graph** | Interactive D3 graph: Page → Scripts → APIs → Storage |

### 7.2 Timeline Renderer (Canvas-based)

```typescript
// Custom canvas renderer for 100k+ events without DOM thrashing
class TimelineCanvas {
  private ctx: CanvasRenderingContext2D;
  private viewport: { start: number; end: number };
  private lanes: Lane[];

  render(events: TimelineEvent[]) {
    this.ctx.clearRect(0, 0, this.width, this.height);

    const visibleEvents = events.filter(e =>
      e.ts >= this.viewport.start && e.ts <= this.viewport.end
    );

    for (const lane of this.lanes) {
      lane.render(this.ctx, visibleEvents, this.viewport);
    }

    this.renderTimescale();
    this.renderCursor();
  }

  // Virtualized — only renders visible rows
  zoom(factor: number, anchor: number) {
    const range = this.viewport.end - this.viewport.start;
    const newRange = range / factor;
    this.viewport = {
      start: anchor - (anchor - this.viewport.start) / factor,
      end:   anchor + (this.viewport.end - anchor) / factor,
    };
    this.render(this.cachedEvents);
  }
}
```

---

## 8. Advanced Analysis Engine

### 8.1 Resource Dependency Graph

```python
# analysis/dependency_graph.py
import networkx as nx

def build_dependency_graph(session_id: str, db) -> nx.DiGraph:
    G = nx.DiGraph()

    requests = db.fetch_requests(session_id)
    for req in requests:
        G.add_node(req.url, type=req.resource_type)

        if req.initiator_url:
            G.add_edge(req.initiator_url, req.url, 
                       type='initiates',
                       ts=req.ts)

    # Add storage edges
    storage_events = db.fetch_storage_events(session_id)
    for ev in storage_events:
        if ev.script_url:
            G.add_edge(ev.script_url, f"storage:{ev.storage}:{ev.key}",
                       type='writes' if ev.operation == 'set' else 'reads')

    return G
```

### 8.2 Third-Party Detection

```python
KNOWN_THIRD_PARTIES = {
    'analytics': ['google-analytics.com', 'gtag', 'segment.io', 'mixpanel.com'],
    'ads':       ['doubleclick.net', 'googlesyndication.com', 'amazon-adsystem.com'],
    'cdn':       ['cloudflare.com', 'fastly.net', 'akamaihd.net'],
    'tracking':  ['facebook.net', 'twitter.com/i/adsct', 'hotjar.com'],
    'chat':      ['intercom.io', 'drift.com', 'crisp.chat'],
}

def classify_request(url: str) -> ThirdPartyCategory | None:
    for category, patterns in KNOWN_THIRD_PARTIES.items():
        if any(p in url for p in patterns):
            return ThirdPartyCategory(category)
    return None
```

### 8.3 Performance Analysis

```typescript
// Capture Core Web Vitals via CDP Performance domain
await cdp.send('Performance.enable');

const metrics = await cdp.send('Performance.getMetrics');
// → FirstContentfulPaint, LargestContentfulPaint, CumulativeLayoutShift, etc.

// Also inject web-vitals library for accurate CLS/FID/INP
await page.addInitScript({ path: 'node_modules/web-vitals/dist/web-vitals.iife.js' });
await page.evaluate(() => {
  webVitals.onCLS(m  => window.__obsEmit({ type: 'perf:cls',  value: m.value }));
  webVitals.onLCP(m  => window.__obsEmit({ type: 'perf:lcp',  value: m.value }));
  webVitals.onFCP(m  => window.__obsEmit({ type: 'perf:fcp',  value: m.value }));
  webVitals.onINP(m  => window.__obsEmit({ type: 'perf:inp',  value: m.value }));
  webVitals.onTTFB(m => window.__obsEmit({ type: 'perf:ttfb', value: m.value }));
});
```

### 8.4 Anomaly Detection (ML Pipeline)

```python
# Unsupervised anomaly detection on request patterns
from sklearn.ensemble import IsolationForest
import numpy as np

def detect_anomalous_requests(features: np.ndarray) -> np.ndarray:
    """
    Features per request:
    [response_time_ms, body_size, status_code, is_third_party, hour_of_day]
    """
    model = IsolationForest(contamination=0.05, random_state=42)
    labels = model.fit_predict(features)
    return labels  # -1 = anomaly, 1 = normal
```

---

## 9. Security & Compliance

### 9.1 Data Sensitivity Handling

```typescript
interface RedactionConfig {
  // Redact from request/response bodies before storage
  sensitiveHeaders: string[];   // ['Authorization', 'Cookie', 'X-API-Key']
  sensitiveBodyKeys: string[];  // ['password', 'token', 'ssn', 'credit_card']
  urlPatterns: RegExp[];        // regex patterns to redact from URLs
}

function redactSensitiveData(payload: unknown, config: RedactionConfig): unknown {
  // Deep redact before writing to Kafka / storage
}
```

### 9.2 Access Control

```
Roles:
  viewer      → read-only access to sessions
  analyst     → read + export
  operator    → manage collection sessions
  admin       → full access + deletion

Auth:
  OAuth2 / OIDC (Keycloak or Auth0)
  JWT with 1h expiry + refresh token rotation
  Row-level security in PostgreSQL per tenant
```

### 9.3 Data Retention

```sql
-- Auto-purge via TimescaleDB retention policy
SELECT add_retention_policy('requests',   INTERVAL '90 days');
SELECT add_retention_policy('dom_events', INTERVAL '30 days');
SELECT add_retention_policy('screenshots', INTERVAL '14 days');
```

---

## 10. Deployment & Infrastructure

### 10.1 Docker Compose (Development)

```yaml
# docker-compose.yml
services:
  collector:
    build: ./collector
    environment:
      - KAFKA_BROKERS=kafka:9092
      - MINIO_ENDPOINT=minio:9000
    volumes:
      - /dev/shm:/dev/shm  # Chromium needs shared memory

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    environment:
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'true'

  postgres:
    image: timescale/timescaledb:latest-pg16
    volumes:
      - pgdata:/var/lib/postgresql/data

  opensearch:
    image: opensearchproject/opensearch:2.13.0
    environment:
      - discovery.type=single-node
      - OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"

  api:
    build: ./api
    depends_on: [kafka, postgres, opensearch]

  dashboard:
    build: ./dashboard
    ports:
      - "3000:3000"
```

### 10.2 Production K8s Checklist

- [ ] Collector pods: `resources.requests.memory: 2Gi` (Chromium is hungry)
- [ ] Kafka: min 3 brokers, RF=3 for timeline topic
- [ ] PostgreSQL: streaming replication + pgBouncer connection pooling
- [ ] MinIO: distributed mode (4+ drives) or use S3
- [ ] OpenSearch: 3-node cluster, dedicated master nodes
- [ ] All inter-service traffic: mTLS via Istio or Linkerd
- [ ] Secrets: Vault or K8s Secrets (sealed)

---

## 11. Development Phases

### Phase 1 — Foundation (Weeks 1–3)
- [ ] Playwright collector skeleton (TypeScript)
- [ ] CDP network interception (`NetworkInstrumentation` class)
- [ ] HAR 1.3 generation with response bodies
- [ ] Kafka producer integration
- [ ] MinIO upload pipeline
- [ ] PostgreSQL schema + migrations (Flyway/Drizzle)

### Phase 2 — DOM & Storage (Weeks 4–5)
- [ ] `MutationObserver` injection + serialization
- [ ] Shadow DOM tracking
- [ ] LocalStorage / SessionStorage proxy hooks
- [ ] Cookie polling via CDP
- [ ] IndexedDB tracking via CDP Storage domain

### Phase 3 — JS Runtime & Console (Week 6)
- [ ] CDP Debugger domain: script tracking
- [ ] Exception capture + stack enrichment
- [ ] Console API interception
- [ ] Dynamic eval detection

### Phase 4 — Screenshot & Snapshot (Week 7)
- [ ] Screenshot engine (adaptive, perceptual deduplication)
- [ ] rrweb full snapshot integration
- [ ] HTML source capture + ZSTD compression

### Phase 5 — Search & Indexing (Week 8)
- [ ] OpenSearch consumer group
- [ ] Index mapping + ILM policy
- [ ] Full-text search API endpoint
- [ ] Faceted search (by host, type, date range)

### Phase 6 — Timeline & API (Weeks 9–10)
- [ ] Merged timeline Kafka Streams processor
- [ ] REST API (Fastify) — full CRUD + stream endpoints
- [ ] WebSocket real-time push
- [ ] Auth (JWT + RBAC)

### Phase 7 — Dashboard (Weeks 11–13)
- [ ] Canvas timeline renderer
- [ ] Network waterfall chart
- [ ] rrweb replay player integration
- [ ] DOM diff viewer
- [ ] Storage explorer
- [ ] Full-text search UI

### Phase 8 — Analysis (Weeks 14–16)
- [ ] Dependency graph builder (NetworkX)
- [ ] Third-party classifier
- [ ] Core Web Vitals pipeline
- [ ] Anomaly detection (IsolationForest)
- [ ] Automated report generation (PDF export)

### Phase 9 — Scale & Distributed (Weeks 17–20)
- [ ] Multi-collector orchestration (K8s Jobs)
- [ ] Distributed crawl queue (Redis + BullMQ)
- [ ] Multi-tenancy + row-level security
- [ ] Prometheus metrics + Grafana dashboards
- [ ] Load testing (k6)

---

## 12. Performance Targets & SLAs

| Metric | Target |
|---|---|
| Event ingestion latency (collector → Kafka) | < 50ms p99 |
| Timeline query (30-day session) | < 200ms p95 |
| Full-text search response | < 500ms p95 |
| Screenshot capture overhead | < 100ms per capture |
| Dashboard initial load | < 2s (FCP) |
| Concurrent recording sessions | ≥ 50 per collector node |
| Storage efficiency (ZSTD vs raw) | ≥ 60% reduction |

---

## 13. Open Source References

| Category | Project | URL |
|---|---|---|
| Browser Automation | Playwright | https://playwright.dev |
| Browser Automation | Puppeteer | https://pptr.dev |
| DevTools Protocol | CDP Spec | https://chromedevtools.github.io/devtools-protocol |
| Session Replay | rrweb | https://github.com/rrweb-io/rrweb |
| Proxy / MITM | mitmproxy | https://mitmproxy.org |
| Traffic Analysis | Wireshark | https://www.wireshark.org |
| HAR Analysis | browsertime | https://github.com/sitespeedio/browsertime |
| Performance | Lighthouse | https://github.com/GoogleChrome/lighthouse |
| Web Vitals | web-vitals | https://github.com/GoogleChrome/web-vitals |
| Database | PostgreSQL | https://www.postgresql.org |
| Time-series | TimescaleDB | https://www.timescale.com |
| Search | OpenSearch | https://opensearch.org |
| Event Bus | Apache Kafka | https://kafka.apache.org |
| Object Storage | MinIO | https://min.io |
| Compression | Zstandard | https://github.com/facebook/zstd |
| Graph Analysis | NetworkX | https://networkx.org |
| ML Anomaly | scikit-learn | https://scikit-learn.org |

---

*Last updated: 2025 — Web Application Full Observability Platform v2.0*
