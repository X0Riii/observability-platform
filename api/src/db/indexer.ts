import crypto from 'crypto';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://obs:obspass@localhost:5432/observability',
  max: 10,
});

interface SessionRow {
  id: string;
  urlSeed: string;
  userAgent: string;
  startedAt: Date;
}

// Maps: sessionId -> { id, urlSeed, userAgent }
const sessionCache = new Map<string, SessionRow>();
const pageCache = new Map<string, string>(); // sessionId -> pageId

const TOPICS = [
  'obs.network.requests',
  'obs.network.responses',
  'obs.dom.mutations',
  'obs.screenshots',
];

export class PostgresIndexer {
  private consumer: Consumer;

  constructor(kafka: Kafka, groupId: string) {
    this.consumer = kafka.consumer({ groupId });
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    for (const t of TOPICS) {
      await this.consumer.subscribe({ topic: t });
    }
    await this.consumer.run({
      eachMessage: async (p: EachMessagePayload) => this.handle(p),
    });
    console.log('[PostgresIndexer] Consumer started');
  }

  private async handle({ topic, message }: EachMessagePayload): Promise<void> {
    try {
      const event = JSON.parse(message.value!.toString());
      switch (topic) {
        case 'obs.network.requests':
          await this.indexRequest(event);
          break;
        case 'obs.network.responses':
          await this.indexResponse(event);
          break;
        case 'obs.dom.mutations':
          await this.indexDomEvent(event);
          break;
        case 'obs.screenshots':
          await this.indexScreenshot(event);
          break;
      }
    } catch (err) {
      console.error('[PostgresIndexer] Error:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Session + page auto-creation
  // -----------------------------------------------------------------------
  private async ensureSession(event: any): Promise<string> {
    const sid = event.sessionId;
    if (!sid) return '';

    if (sessionCache.has(sid)) return sid;

    // Insert session
    const url = event.url ?? event.payload?.url ?? 'unknown';
    const now = new Date(event.ts ?? Date.now());
    try {
      await pool.query(
        `INSERT INTO sessions (id, started_at, url_seed, user_agent)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [sid, now, url, event.payload?.userAgent ?? ''],
      );
    } catch { /* ignore conflict */ }

    sessionCache.set(sid, { id: sid, urlSeed: url, userAgent: '', startedAt: now });
    return sid;
  }

  private async ensurePage(sessionId: string, event: any): Promise<string | null> {
    if (!sessionId) return null;
    if (pageCache.has(sessionId)) return pageCache.get(sessionId)!;

    const url = event.url ?? event.payload?.url ?? 'unknown';
    const now = new Date(event.ts ?? Date.now());

    try {
      const res = await pool.query(
        `INSERT INTO pages (session_id, url, navigated_at, title)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [sessionId, url, now, event.payload?.title ?? ''],
      );
      if (res.rows.length > 0) {
        const pid = res.rows[0].id;
        pageCache.set(sessionId, pid);
        return pid;
      }
    } catch { /* ignore */ }

    // Fetch existing
    try {
      const res = await pool.query('SELECT id FROM pages WHERE session_id = $1 LIMIT 1', [sessionId]);
      if (res.rows.length > 0) {
        pageCache.set(sessionId, res.rows[0].id);
        return res.rows[0].id;
      }
    } catch {}
    return null;
  }

  // -----------------------------------------------------------------------
  // Indexers
  // -----------------------------------------------------------------------
  private async indexRequest(event: any): Promise<void> {
    const sid = await this.ensureSession(event);
    const pid = await this.ensurePage(sid, event);

    const id = event.id;
    const ts = new Date(event.ts ?? Date.now());
    const method = event.method ?? 'GET';
    const url = event.url ?? '';
    const urlHost = event.urlHost ?? (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const resourceType = event.resourceType ?? 'other';
    const headers = event.headers ?? {};

    await pool.query(
      `INSERT INTO requests (id, page_id, ts, method, url, url_host, resource_type, headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [id, pid, ts, method, url, urlHost, resourceType, JSON.stringify(headers)],
    );
  }

  private async indexResponse(event: any): Promise<void> {
    // The response 'id' is the normalized UUID that matches the request
    const rid = event.id;
    if (!rid) return;

    const ts = new Date(event.ts ?? Date.now());
    const status = event.status ?? 0;
    const statusText = event.statusText ?? '';
    const headers = event.headers ?? {};
    const bodyRef = event.payload?.body_ref ?? event.body_ref ?? null;
    const bodySize = event.payload?.bodySize ?? null;
    const transferSize = event.transferSize ?? -1;
    const mimeType = event.mimeType ?? '';
    const timing = event.timing ?? null;

    try {
      await pool.query(
        `INSERT INTO responses (request_id, ts, status, status_text, headers, body_ref, body_size, transfer_size, mime_type, timing)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [rid, ts, status, statusText, JSON.stringify(headers), bodyRef, bodySize, transferSize, mimeType, timing ? JSON.stringify(timing) : null],
      );
    } catch (insertErr: any) {
      if (insertErr.code !== '23505') throw insertErr; // 23505 = unique_violation
    }
  }

  private async indexDomEvent(event: any): Promise<void> {
    const sid = await this.ensureSession(event);
    const pid = await this.ensurePage(sid, event);
    if (!pid) return;

    const id = event.id ?? crypto.randomUUID();
    const ts = new Date(event.ts ?? Date.now());
    const tsPageMs = event.tsPage ?? null;
    const mutationType = event.payload?.type ?? event.type ?? 'mutation';
    const targetPath = event.payload?.target ?? null;

    await pool.query(
      `INSERT INTO dom_events (id, page_id, ts, ts_page_ms, mutation_type, target_path, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [id, pid, ts, tsPageMs, mutationType, targetPath, JSON.stringify(event.payload ?? {})],
    );
  }

  private async indexScreenshot(event: any): Promise<void> {
    const sid = event.sessionId;
    if (!sid) return;
    const pid = pageCache.get(sid) ?? null;
    if (!pid) return;

    const id = event.id ?? crypto.randomUUID();
    const ts = new Date(event.ts ?? Date.now());
    const trigger = event.payload?.trigger ?? 'unknown';
    const format = event.payload?.format ?? 'webp';
    const objectKey = event.payload?.objectKey ?? '';
    const perceptualHash = event.payload?.hash ? parseInt(event.payload.hash, 16) : null;

    await pool.query(
      `INSERT INTO screenshots (id, page_id, ts, trigger, format, object_key, perceptual_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [id, pid, ts, trigger, format, objectKey, perceptualHash],
    );
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
    await pool.end();
  }
}


