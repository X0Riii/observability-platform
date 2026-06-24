import { FastifyInstance } from 'fastify';
import minio from '../minio.js';

export function registerRequestRoutes(app: FastifyInstance): void {
  app.get('/api/requests/:id/body', async (request, reply) => {
    const { id } = request.params as any;
    try {
      const stream = await minio.getObject('obs-raw', `responses/${id}.bin.zst`);
      reply.header('Content-Type', 'application/octet-stream');
      return stream;
    } catch {
      return reply.status(404).send({ error: 'Response body not found' });
    }
  });
}
