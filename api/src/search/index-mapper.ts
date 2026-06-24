import { Client } from '@opensearch-project/opensearch';

const INDEX_SETTINGS = {
  number_of_shards: 4,
  number_of_replicas: 1,
  'index.codec': 'best_compression',
};

const SEARCH_INDEX_MAPPING = {
  settings: INDEX_SETTINGS,
  mappings: {
    properties: {
      sessionId: { type: 'keyword' },
      pageId: { type: 'keyword' },
      ts: { type: 'date', format: 'epoch_millis' },
      type: { type: 'keyword' },
      url: {
        type: 'text',
        fields: { keyword: { type: 'keyword' } },
      },
      method: { type: 'keyword' },
      status: { type: 'integer' },
      mimeType: { type: 'keyword' },
      urlHost: { type: 'keyword' },
      resourceType: { type: 'keyword' },
      headers: { type: 'object', enabled: false },
      content: { type: 'text', analyzer: 'standard' },
      consoleMsg: { type: 'text' },
      domText: { type: 'text' },
      errorMessage: { type: 'text' },
      mutationType: { type: 'keyword' },
      targetPath: { type: 'text' },
      initiatorType: { type: 'keyword' },
      storageType: { type: 'keyword' },
      cookieName: { type: 'keyword' },
    },
  },
};

const INDICES = [
  { name: 'obs-network-requests', mapping: SEARCH_INDEX_MAPPING },
  { name: 'obs-network-responses', mapping: SEARCH_INDEX_MAPPING },
  { name: 'obs-dom-mutations', mapping: SEARCH_INDEX_MAPPING },
  { name: 'obs-js-events', mapping: SEARCH_INDEX_MAPPING },
  { name: 'obs-storage-events', mapping: SEARCH_INDEX_MAPPING },
  { name: 'obs-screenshots', mapping: { settings: INDEX_SETTINGS, mappings: { properties: { sessionId: { type: 'keyword' }, ts: { type: 'date', format: 'epoch_millis' }, trigger: { type: 'keyword' }, format: { type: 'keyword' } } } } },
];

export async function ensureIndices(client: Client): Promise<void> {
  for (const idx of INDICES) {
    const exists = await client.indices.exists({ index: idx.name });
    if (!exists.body) {
      await client.indices.create({ index: idx.name, body: idx.mapping });
      console.log(`[OpenSearch] Index created: ${idx.name}`);
    }
  }
}
