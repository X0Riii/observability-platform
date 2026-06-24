import { Queue, Worker, Job } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export interface CrawlJob {
  sessionId: string;
  url: string;
  tenantId?: string;
  priority?: number;
  maxDepth?: number;
  collectScreenshots?: boolean;
  collectRrweb?: boolean;
  durationMs?: number;
}

const connection = { url: REDIS_URL };

export const crawlQueue = new Queue<CrawlJob>('obs-crawl', { connection });

export async function enqueueCrawl(job: CrawlJob): Promise<Job<CrawlJob>> {
  return crawlQueue.add('crawl-url', job, {
    jobId: job.sessionId,
    priority: job.priority ?? 0,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 * 24 },
    removeOnFail: { age: 3600 * 24 * 7 },
  });
}

export function createCrawlWorker(handler: (job: CrawlJob) => Promise<void>) {
  const worker = new Worker<CrawlJob>(
    'obs-crawl',
    async (job) => {
      console.log(`[Queue] Processing crawl job: ${job.data.url} (session: ${job.data.sessionId})`);
      await handler(job.data);
    },
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job) => {
    console.log(`[Queue] Job ${job.id} completed: ${job.data.url}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
