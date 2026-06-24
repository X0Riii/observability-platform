import { FastifyInstance } from 'fastify';
import pool from '../db/pool.js';
import minio from '../minio.js';

export function registerPageRoutes(app: FastifyInstance): void {
  app.get('/api/pages/:id/screenshots', async (request, reply) => {
    const { id } = request.params as any;
    const result = await pool.query(
      'SELECT id, ts, trigger, format, width, height, file_size, object_key FROM screenshots WHERE page_id = $1 ORDER BY ts',
      [id],
    );
    return { pageId: id, screenshots: result.rows };
  });

  app.get('/api/pages/:id/snapshot', async (request, reply) => {
    const { id } = request.params as any;

    const page = await pool.query('SELECT session_id FROM pages WHERE id = $1', [id]);
    if (page.rows.length === 0) return reply.status(404).send({ error: 'Page not found' });

    try {
      const stream = await minio.getObject('obs-raw', `sessions/${page.rows[0].session_id}/rendered.rrweb.zst`);
      reply.header('Content-Type', 'application/json');
      return stream;
    } catch {
      return reply.status(404).send({ error: 'Snapshot not found' });
    }
  });

  app.get('/api/pages/:id/screenshot/:screenshotId', async (request, reply) => {
    const { id: pageId, screenshotId } = request.params as any;
    const result = await pool.query('SELECT object_key, format FROM screenshots WHERE id = $1 AND page_id = $2', [screenshotId, pageId]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'Screenshot not found' });

    try {
      const stream = await minio.getObject('obs-raw', result.rows[0].object_key);
      reply.header('Content-Type', `image/${result.rows[0].format}`);
      return stream;
    } catch {
      return reply.status(404).send({ error: 'Screenshot file not found in storage' });
    }
  });
}
