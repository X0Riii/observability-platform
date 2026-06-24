import { FastifyInstance } from 'fastify';
import pool from '../db/pool.js';
import minio from '../minio.js';

export function registerSessionRoutes(app: FastifyInstance): void {
  app.get('/api/sessions', async (request, reply) => {
    const queryOpts = request.query as Record<string, string>;
    const url = queryOpts.url;
    const limitNum = Math.min(1000, Math.max(1, parseInt(queryOpts.limit, 10) || 50));
    const offsetNum = Math.max(0, parseInt(queryOpts.offset, 10) || 0);
    let query = 'SELECT * FROM sessions';
    const params: any[] = [];
    if (url) {
      query += ' WHERE url_seed ILIKE $1';
      params.push(`%${url}%`);
    }
    query += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limitNum, offsetNum);

    const result = await pool.query(query, params);
    const countResult = await pool.query('SELECT COUNT(*) FROM sessions' + (url ? ' WHERE url_seed ILIKE $1' : ''), url ? [`%${url}%`] : []);
    return { sessions: result.rows, total: parseInt(countResult.rows[0].count) };
  });

  app.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as any;
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'Session not found' });

    const pages = await pool.query('SELECT * FROM pages WHERE session_id = $1 ORDER BY navigated_at', [id]);
    return { session: result.rows[0], pages: pages.rows };
  });

  app.get('/api/sessions/:id/timeline', async (request, reply) => {
    const { id } = request.params as any;
    const tlQuery = request.query as Record<string, string>;
    const fromNum = Math.max(0, parseInt(tlQuery.from, 10) || 0);
    const limitNum = Math.min(10000, Math.max(1, parseInt(tlQuery.limit, 10) || 1000));

    const requests = await pool.query('SELECT id, ts, method, url, resource_type FROM requests WHERE page_id IN (SELECT id FROM pages WHERE session_id = $1) ORDER BY ts DESC LIMIT $2 OFFSET $3', [id, limitNum, fromNum]);
    const domEvents = await pool.query('SELECT * FROM dom_events WHERE page_id IN (SELECT id FROM pages WHERE session_id = $1) ORDER BY ts DESC LIMIT $2 OFFSET $3', [id, limitNum, fromNum]);

    return {
      sessionId: id,
      requests: requests.rows,
      domEvents: domEvents.rows,
    };
  });

  app.get('/api/sessions/:id/har', async (request, reply) => {
    const { id } = request.params as any;
    try {
      const stream = await minio.getObject('obs-raw', `sessions/${id}/session.har.zst`);
      reply.header('Content-Type', 'application/har+json');
      reply.header('Content-Disposition', `attachment; filename="session-${id}.har.zst"`);
      return stream;
    } catch {
      return reply.status(404).send({ error: 'HAR file not found' });
    }
  });
}
