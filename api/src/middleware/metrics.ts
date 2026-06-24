import { FastifyInstance } from 'fastify';
import { collectDefaultMetrics, Counter, Histogram, Gauge, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'obs_' });

export const httpRequestCounter = new Counter({
  name: 'obs_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestDuration = new Histogram({
  name: 'obs_http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const activeSessionsGauge = new Gauge({
  name: 'obs_active_sessions',
  help: 'Currently active recording sessions',
});

export const kafkaMessagesCounter = new Counter({
  name: 'obs_kafka_messages_total',
  help: 'Kafka messages produced/consumed',
  labelNames: ['topic', 'direction'],
});

export const indexedDocumentsCounter = new Counter({
  name: 'obs_opensearch_indexed_total',
  help: 'Documents indexed to OpenSearch',
  labelNames: ['index'],
});

export function registerMetricsRoute(app: FastifyInstance): void {
  app.get('/api/metrics', async (_, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
}
