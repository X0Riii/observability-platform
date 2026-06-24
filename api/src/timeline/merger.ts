import { Kafka, Consumer, EachMessagePayload, Producer } from 'kafkajs';

interface TimelineEvent {
  id: string;
  sessionId: string;
  pageId?: string;
  ts: number;
  tsPage?: number;
  type: string;
  subtype?: string;
  payload: any;
  seq: number;
}

const SOURCE_TOPICS = [
  'obs.network.requests',
  'obs.network.responses',
  'obs.dom.mutations',
  'obs.js.events',
  'obs.storage.events',
  'obs.screenshots',
  'obs.performance',
];

const TYPE_MAP: Record<string, string> = {
  'obs.network.requests': 'network',
  'obs.network.responses': 'network',
  'obs.dom.mutations': 'dom',
  'obs.js.events': 'js',
  'obs.storage.events': 'storage',
  'obs.screenshots': 'screenshot',
  'obs.performance': 'performance',
};

export class TimelineMerger {
  private consumer: Consumer;
  private producer: Producer;
  private seqMap = new Map<string, { seq: number; lastAccess: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(kafka: Kafka, groupId: string) {
    this.consumer = kafka.consumer({ groupId });
    this.producer = kafka.producer();
    this.cleanupTimer = setInterval(() => this.evictStale(), 5 * 60 * 1000);
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.producer.connect();

    for (const topic of SOURCE_TOPICS) {
      await this.consumer.subscribe({ topic });
    }

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => this.process(payload),
    });

    console.log('[TimelineMerger] Started');
  }

  private async process({ topic, message }: EachMessagePayload): Promise<void> {
    try {
      const raw = JSON.parse(message.value!.toString());
      const sessionId = raw.sessionId ?? message.key?.toString();
      if (!sessionId) return;

      const entry = this.seqMap.get(sessionId) ?? { seq: 0, lastAccess: Date.now() };
      entry.seq += 1;
      entry.lastAccess = Date.now();
      const seq = entry.seq;

      const event: TimelineEvent = {
        id: raw.id,
        sessionId,
        pageId: raw.pageId,
        ts: raw.ts ?? raw.timestamp ?? Date.now(),
        tsPage: raw.tsPage,
        type: TYPE_MAP[topic] ?? topic.replace('obs.', '').split('.')[0],
        subtype: raw.type ?? topic.split('.').pop(),
        payload: raw.payload ?? raw,
        seq,
      };

      await this.producer.send({
        topic: 'obs.timeline.merged',
        messages: [{ key: sessionId, value: JSON.stringify(event) }],
      });
    } catch (err) {
      console.error('[TimelineMerger] Error:', err);
    }
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.seqMap) {
      if (now - entry.lastAccess > 30 * 60 * 1000) {
        this.seqMap.delete(key);
      }
    }
  }

  async disconnect(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.consumer.disconnect();
    await this.producer.disconnect();
  }
}
