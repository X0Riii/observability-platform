import { chromium } from 'playwright';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { NetworkInstrumentation } from './instrumentation/network.js';
import { DomObserver } from './instrumentation/dom-observer.js';
import { StorageTracker } from './instrumentation/storage.js';
import { JsRuntimeObserver } from './instrumentation/js-runtime.js';
import { KafkaProducer } from './kafka.js';
import { MinioClient } from './minio.js';
import { buildHar, HarEntry } from './har.js';
import { ScreenshotEngine, ScreenshotTrigger } from './instrumentation/screenshot.js';
import { SnapshotEngine } from './instrumentation/snapshot.js';
import { TOPICS } from './topics.js';

const KAFKA_BROKERS = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'];
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000');
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';

async function main() {
  const targetUrl = process.argv[2] || 'https://example.com';
  const sessionId = uuidv4();

  console.log(`[Collector] Starting session: ${sessionId} for URL: ${targetUrl}`);

  const eventBus = new EventEmitter();
  const kafkaProducer = new KafkaProducer('collector-1', KAFKA_BROKERS);
  await kafkaProducer.connect();

  const minioClient = new MinioClient(
    MINIO_ENDPOINT.split(':')[0],
    MINIO_PORT,
    MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY,
  );

  const harEntries: HarEntry[] = [];
  const requestHeadersMap = new Map<string, Record<string, string>>();

  eventBus.on('network:request', (event) => {
    requestHeadersMap.set(event.requestId, event.headers);
    kafkaProducer.sendEvent(TOPICS.NETWORK_REQUESTS, event);
  });

  eventBus.on('network:response', async (event) => {
    const { body, base64Encoded, url, method, ...metadata } = event;

    if (body) {
      const buffer = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf-8');
      const objectKey = `responses/${event.id}.bin`;
      const finalKey = await minioClient.uploadBuffer('obs-raw', objectKey, buffer, event.mimeType, true);
      metadata.body_ref = finalKey;
    }

    harEntries.push({
      requestId: event.requestId,
      url,
      method,
      timestamp: event.timestamp,
      status: event.status,
      statusText: event.statusText,
      mimeType: event.mimeType,
      requestHeaders: requestHeadersMap.get(event.requestId) ?? {},
      responseHeaders: event.headers,
      postData: event.postData,
      body,
      base64Encoded,
      timing: event.timing,
      transferSize: event.transferSize,
    });

    kafkaProducer.sendEvent(TOPICS.NETWORK_RESPONSES, metadata);
  });

  eventBus.on('network:loadingFinished', (event) => {
    const entry = harEntries.find(e => e.requestId === event.requestId);
    if (entry) {
      entry.encodedBodySize = event.encodedBodySize;
    }
  });

  eventBus.on('network:loadingFailed', (event) => {
    kafkaProducer.sendEvent(TOPICS.NETWORK_ERRORS, event);
  });

  eventBus.on('dom:mutation', (event) => {
    kafkaProducer.sendEvent(TOPICS.DOM_MUTATIONS, event);
  });

  eventBus.on('dom:shadowRoot', (event) => {
    kafkaProducer.sendEvent(TOPICS.DOM_MUTATIONS, event);
  });

  eventBus.on('storage:set', (event) => {
    kafkaProducer.sendEvent(TOPICS.STORAGE_EVENTS, event);
  });

  eventBus.on('storage:remove', (event) => {
    kafkaProducer.sendEvent(TOPICS.STORAGE_EVENTS, event);
  });

  eventBus.on('storage:clear', (event) => {
    kafkaProducer.sendEvent(TOPICS.STORAGE_EVENTS, event);
  });

  eventBus.on('storage:cookies', (event) => {
    kafkaProducer.sendEvent(TOPICS.STORAGE_EVENTS, event);
  });

  eventBus.on('storage:indexeddb', (event) => {
    kafkaProducer.sendEvent(TOPICS.STORAGE_EVENTS, event);
  });

  eventBus.on('js:script', (event) => {
    kafkaProducer.sendEvent(TOPICS.JS_EVENTS, event);
  });

  eventBus.on('js:exception', (event) => {
    kafkaProducer.sendEvent(TOPICS.JS_EVENTS, event);
  });

  eventBus.on('js:console', (event) => {
    kafkaProducer.sendEvent(TOPICS.JS_EVENTS, event);
  });

  eventBus.on('js:eval', (event) => {
    kafkaProducer.sendEvent(TOPICS.JS_EVENTS, event);
  });

  eventBus.on('js:newFunction', (event) => {
    kafkaProducer.sendEvent(TOPICS.JS_EVENTS, event);
  });

  eventBus.on('screenshot:captured', async (event) => {
    const { buffer, hash, trigger, format, ...meta } = event.payload;
    const objectKey = `screenshots/${event.sessionId}/${Date.now()}_${trigger}.${format}`;
    const finalKey = await minioClient.uploadBuffer('obs-raw', objectKey, buffer, `image/${format}`, false);
    kafkaProducer.sendEvent(TOPICS.SCREENSHOTS, { ...event, payload: { ...meta, objectKey: finalKey, hash } });
  });

  eventBus.on('rrweb:event', (event) => {
    kafkaProducer.sendEvent(TOPICS.DOM_MUTATIONS, event);
  });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const cdpSession = await page.context().newCDPSession(page);

  const networkInstrumentation = new NetworkInstrumentation(eventBus, sessionId, cdpSession);
  await networkInstrumentation.attach(page);

  const domObserver = new DomObserver(eventBus, sessionId, cdpSession);
  await domObserver.attach(page);

  const storageTracker = new StorageTracker(eventBus, sessionId, cdpSession);
  await storageTracker.attach(page);

  const jsRuntimeObserver = new JsRuntimeObserver(eventBus, sessionId, cdpSession);
  await jsRuntimeObserver.attach(page);

  const screenshotEngine = new ScreenshotEngine(eventBus, {
    sessionId,
    format: 'jpeg',
    quality: 80,
    fullPage: false,
    maxWidth: 1920,
  });
  const screenshotTriggers: ScreenshotTrigger[] = [
    { type: 'navigation' },
    { type: 'interval', intervalMs: 3000 },
    { type: 'networkIdle' },
    { type: 'domMutation', debounceMs: 1000, threshold: 5 },
  ];
  await screenshotEngine.attach(page, screenshotTriggers);

  const snapshotEngine = new SnapshotEngine(eventBus, sessionId, cdpSession);
  await snapshotEngine.attach(page);

  console.log('[Collector] Navigating...');
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const html = await page.content();
  await minioClient.uploadBuffer('obs-raw', `sessions/${sessionId}/source.html`, Buffer.from(html, 'utf-8'), 'text/html', true);

  const harJson = buildHar(sessionId, targetUrl, harEntries);
  await minioClient.uploadBuffer('obs-raw', `sessions/${sessionId}/session.har`, Buffer.from(harJson, 'utf-8'), 'application/har+json', true);

  console.log(`[Collector] HAR generated: ${harEntries.length} entries`);
  console.log('[Collector] Initial navigation complete. Waiting for 5 seconds before closing...');
  await page.waitForTimeout(5000);

  const rrwebSnapshot = snapshotEngine.getRrwebSnapshot();
  if (rrwebSnapshot) {
    const rrwebJson = JSON.stringify(rrwebSnapshot);
    await minioClient.uploadBuffer('obs-raw', `sessions/${sessionId}/rendered.rrweb`, Buffer.from(rrwebJson, 'utf-8'), 'application/json', true);
    console.log(`[Collector] rrweb snapshot uploaded: ${rrwebSnapshot.events.length} events`);
  }

  const axTree = await snapshotEngine.captureAccessibilityTree(page);
  if (axTree) {
    await minioClient.uploadBuffer('obs-raw', `sessions/${sessionId}/accessibility.json`, Buffer.from(JSON.stringify(axTree), 'utf-8'), 'application/json', true);
  }

  storageTracker.detach();
  screenshotEngine.detach();
  await browser.close();
  await kafkaProducer.disconnect();
  console.log('[Collector] Session complete.');
}

main().catch(err => {
  console.error('[Collector] Fatal error:', err);
  process.exit(1);
});
