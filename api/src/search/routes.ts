import { FastifyInstance } from 'fastify';
import { Client } from '@opensearch-project/opensearch';

interface SearchQuery {
  q?: string;
  index?: string;
  host?: string;
  type?: string;
  status?: number;
  mimeType?: string;
  startDate?: string;
  endDate?: string;
  from?: number;
  size?: number;
}

const MAX_SIZE = 100;

export function registerSearchRoutes(app: FastifyInstance, client: Client): void {
  app.post<{ Body: SearchQuery }>('/api/search', async (req, reply) => {
    const { q, index, host, type, status, mimeType, startDate, endDate, from = 0, size = 20 } = req.body;

    const must: any[] = [];
    const filter: any[] = [];

    if (q) {
      must.push({
        multi_match: {
          query: q,
          fields: ['url^3', 'content', 'consoleMsg', 'domText', 'errorMessage', 'cookieName', 'targetPath'],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });
    }

    if (host) filter.push({ term: { 'urlHost.keyword': host } });
    if (type) filter.push({ term: { type } });
    if (status) filter.push({ term: { status } });
    if (mimeType) filter.push({ term: { mimeType } });
    if (startDate || endDate) {
      const range: any = {};
      if (startDate) range.gte = startDate;
      if (endDate) range.lte = endDate;
      filter.push({ range: { ts: range } });
    }

    const indices = index ? [index] : ['obs-*'];

    try {
      const result = await client.search({
        index: indices,
        from: Math.min(from, 10000),
        size: Math.min(size, MAX_SIZE),
        body: {
          query: { bool: { must: must.length > 0 ? must : [{ match_all: {} }], filter } },
          sort: [{ ts: { order: 'desc' } }],
          aggs: {
            by_host: { terms: { field: 'urlHost.keyword', size: 20 } },
            by_type: { terms: { field: 'type', size: 20 } },
            by_status: { terms: { field: 'status', size: 20 } },
            by_mime: { terms: { field: 'mimeType', size: 20 } },
          },
        },
      });

      return {
        took: result.body.took,
        total: result.body.hits.total.value,
        from,
        size,
        hits: result.body.hits.hits.map((h: any) => ({
          id: h._id,
          index: h._index,
          score: h._score,
          source: h._source,
        })),
        aggregations: result.body.aggregations,
      };
    } catch (err: any) {
      if (err.meta?.statusCode === 404) {
        return reply.status(200).send({ total: 0, hits: [], aggregations: {} });
      }
      console.error('[Search] Error:', err);
      return reply.status(500).send({ error: 'Search failed' });
    }
  });

  app.get<{ Querystring: { field?: string } }>('/api/search/facets', async (req, reply) => {
    const field = req.query.field || 'urlHost.keyword';

    try {
      const result = await client.search({
        index: 'obs-*',
        body: {
          size: 0,
          aggs: {
            facets: { terms: { field, size: 50 } },
          },
        },
      });

      return {
        field,
        buckets: result.body.aggregations?.facets?.buckets ?? [],
      };
    } catch (err: any) {
      if (err.meta?.statusCode === 404) {
        return reply.status(200).send({ buckets: [] });
      }
      console.error('[Search] Facets error:', err);
      return reply.status(500).send({ error: 'Facet query failed' });
    }
  });
}
