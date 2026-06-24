import { Client } from '@opensearch-project/opensearch';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

interface IndexRule {
  topic: string;
  index: string;
  transform: (msg: any) => Record<string, any>;
}

function extractSearchBody(event: any): Record<string, any> {
  return {
    sessionId: event.sessionId,
    pageId: event.pageId,
    ts: event.ts ?? event.timestamp ?? Date.now(),
    url: event.url ?? event.payload?.url,
    urlHost: event.urlHost,
    method: event.method,
    status: event.status,
    mimeType: event.mimeType,
    resourceType: event.resourceType,
    initiatorType: event.initiatorType,
    content: event.body ?? event.payload?.body ?? event.payload?.code ?? event.payload?.message,
    headers: event.headers,
  };
}

const INDEX_RULES: IndexRule[] = [
  {
    topic: 'obs.network.requests',
    index: 'obs-network-requests',
    transform: (e) => extractSearchBody(e),
  },
  {
    topic: 'obs.network.responses',
    index: 'obs-network-responses',
    transform: (e) => ({
      ...extractSearchBody(e),
      status: e.status,
      mimeType: e.mimeType,
      transferSize: e.transferSize,
      bodyRef: e.payload?.body_ref ?? e.body_ref,
    }),
  },
  {
    topic: 'obs.dom.mutations',
    index: 'obs-dom-mutations',
    transform: (e) => ({
      sessionId: e.sessionId,
      pageId: e.pageId,
      ts: e.ts,
      type: e.type,
      mutationType: e.payload?.type ?? e.payload?.mutationType,
      targetPath: e.payload?.target ?? e.payload?.targetPath,
      domText: JSON.stringify(e.payload),
      content: JSON.stringify(e.payload),
    }),
  },
  {
    topic: 'obs.js.events',
    index: 'obs-js-events',
    transform: (e) => ({
      sessionId: e.sessionId,
      ts: e.ts,
      type: e.type ?? e.payload?.type,
      url: e.payload?.url,
      errorMessage: e.payload?.message,
      consoleMsg: e.payload?.args?.map((a: any) => a.value ?? a.preview).join(' '),
      content: typeof e.payload?.code === 'string' ? e.payload.code : typeof e.payload?.stack === 'string' ? e.payload.stack : e.payload?.message || JSON.stringify(e.payload?.callFrames || e.payload),
    }),
  },
  {
    topic: 'obs.storage.events',
    index: 'obs-storage-events',
    transform: (e) => ({
      sessionId: e.sessionId,
      ts: e.ts,
      type: e.type,
      storageType: e.payload?.storage,
      cookieName: e.payload?.name,
      content: JSON.stringify(e.payload),
    }),
  },
];

export class OpenSearchIndexer {
  private consumer: Consumer;
  private client: Client;

  constructor(kafka: Kafka, client: Client, groupId: string) {
    this.consumer = kafka.consumer({ groupId });
    this.client = client;
  }

  async start(): Promise<void> {
    await this.consumer.connect();

    for (const rule of INDEX_RULES) {
      await this.consumer.subscribe({ topic: rule.topic });
    }

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.indexMessage(payload);
      },
    });

    console.log('[OpenSearchIndexer] Consumer started');
  }

  private async indexMessage({ topic, message }: EachMessagePayload): Promise<void> {
    try {
      const rule = INDEX_RULES.find(r => r.topic === topic);
      if (!rule) return;

      const event = JSON.parse(message.value!.toString());
      const doc = rule.transform(event);

      await this.client.index({
        index: rule.index,
        id: event.id ?? event.payload?.id,
        body: doc,
        refresh: false,
      });
    } catch (err) {
      console.error(`[OpenSearchIndexer] Error indexing message from ${topic}:`, err);
    }
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }
}
