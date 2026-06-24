import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { Client } from '@opensearch-project/opensearch';
import { Kafka } from 'kafkajs';
import { ensureIndices } from './search/index-mapper.js';
import { OpenSearchIndexer } from './search/indexer.js';
import { registerSearchRoutes } from './search/routes.js';
import { TimelineMerger } from './timeline/merger.js';
import { registerAuth } from './auth.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerRequestRoutes } from './routes/requests.js';
import { registerWebSocketRoutes } from './routes/ws.js';
import { registerTenantMiddleware } from './middleware/tenant.js';
import { registerMetricsRoute, httpRequestCounter, httpRequestDuration } from './middleware/metrics.js';
import { PostgresIndexer } from './db/indexer.js';

const PORT = parseInt(process.env.PORT || '4000');
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const OPENSEARCH_URL = process.env.OPENSEARCH_URL || 'http://localhost:9200';

const REQUIRED_TOPICS = [
  'obs.network.requests', 'obs.network.responses', 'obs.network.errors',
  'obs.dom.mutations', 'obs.js.events', 'obs.storage.events',
  'obs.screenshots', 'obs.performance', 'obs.timeline.merged',
];

async function ensureKafkaTopics(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    const toCreate = REQUIRED_TOPICS.filter(t => !existing.includes(t));
    for (const topic of toCreate) {
      await admin.createTopics({ topics: [{ topic, numPartitions: 4 }] });
      console.log(`[Kafka] Created topic: ${topic}`);
    }
    if (toCreate.length === 0) console.log('[Kafka] All topics exist');
  } finally {
    await admin.disconnect();
  }
}

async function main() {
  const opensearchClient = new Client({ node: OPENSEARCH_URL });
  const kafka = new Kafka({ clientId: 'obs-api', brokers: KAFKA_BROKERS });

  await ensureIndices(opensearchClient);
  await ensureKafkaTopics(kafka);

  // Start consumers with retries (KafkaJS + KRaft may need multiple attempts)
  async function startWithRetry(name: string, fn: () => Promise<void>, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await fn();
        console.log(`[API] ${name} started`);
        return;
      } catch (err: any) {
        console.warn(`[API] ${name} attempt ${i + 1}/${retries} failed: ${err.message}`);
        if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
      }
    }
    console.error(`[API] ${name} failed after ${retries} attempts, continuing...`);
  }

  const indexer = new OpenSearchIndexer(kafka, opensearchClient, 'consumer-group-opensearch');
  await startWithRetry('OpenSearchIndexer', () => indexer.start());

  const timelineMerger = new TimelineMerger(kafka, 'consumer-group-timeline');
  await startWithRetry('TimelineMerger', () => timelineMerger.start());

  const pgIndexer = new PostgresIndexer(kafka, 'consumer-group-postgres');
  await startWithRetry('PostgresIndexer', () => pgIndexer.start());

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  await registerAuth(app);
  await registerTenantMiddleware(app);

  registerSessionRoutes(app);
  registerPageRoutes(app);
  registerRequestRoutes(app);
  registerSearchRoutes(app, opensearchClient);
  registerWebSocketRoutes(app, kafka);
  registerMetricsRoute(app);

  app.addHook('onResponse', async (request, reply) => {
    httpRequestCounter.inc({ method: request.method, route: request.routeOptions.url ?? 'unknown', status: reply.statusCode });
    httpRequestDuration.observe({ method: request.method, route: request.routeOptions.url ?? 'unknown' }, reply.elapsedTime);
  });

  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[API] Server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[API] Fatal error:', err);
  process.exit(1);
});
