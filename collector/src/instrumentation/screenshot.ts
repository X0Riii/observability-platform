import { Page } from 'playwright';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import sharp from 'sharp';

export type ScreenshotTrigger =
  | { type: 'navigation' }
  | { type: 'interval'; intervalMs: number }
  | { type: 'domMutation'; debounceMs: number; threshold: number }
  | { type: 'networkIdle' }
  | { type: 'manual' };

export interface ScreenshotConfig {
  sessionId: string;
  format: 'png' | 'jpeg';
  quality: number;
  fullPage: boolean;
  maxWidth: number;
}

function averageHash(buffer: Buffer): Promise<bigint> {
  return sharp(buffer)
    .greyscale()
    .resize(16, 16, { fit: 'fill' })
    .raw()
    .toBuffer()
    .then((data) => {
      const pixels = Array.from(data);
      const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
      let hash = 0n;
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] >= avg) hash |= (1n << BigInt(i));
      }
      return hash;
    });
}

function hammingDistance(a: bigint, b: bigint): number {
  let xor = a ^ b;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

const SSIM_THRESHOLD = 10; // max hamming distance for "identical"

export class ScreenshotEngine {
  private eventBus: EventEmitter;
  private config: ScreenshotConfig;
  private lastHash: bigint | null = null;
  private domMutationTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(eventBus: EventEmitter, config: ScreenshotConfig) {
    this.eventBus = eventBus;
    this.config = config;
  }

  async attach(page: Page, triggers: ScreenshotTrigger[]): Promise<void> {
    for (const trigger of triggers) {
      switch (trigger.type) {
        case 'navigation':
          page.on('load', () => this.capture(page, 'navigation'));
          break;
        case 'interval':
          this.intervalTimer = setInterval(() => this.capture(page, 'interval'), trigger.intervalMs);
          break;
        case 'domMutation':
          this.eventBus.on('dom:mutation', () => {
            if (this.domMutationTimer) clearTimeout(this.domMutationTimer);
            this.domMutationTimer = setTimeout(() => this.capture(page, 'domMutation'), trigger.debounceMs);
          });
          break;
        case 'networkIdle':
          page.on('domcontentloaded', () => {
            page.waitForLoadState('networkidle').then(() => this.capture(page, 'networkIdle')).catch(() => {});
          });
          break;
        case 'manual':
          break;
      }
    }
  }

  async capture(page: Page, trigger: string): Promise<void> {
    try {
      const opts: any = { type: this.config.format, quality: this.config.quality };
      if (this.config.fullPage) opts.fullPage = true;

      const rawBuffer = await page.screenshot(opts);

      let buffer = rawBuffer;
      if (this.config.maxWidth > 0) {
        const meta = await sharp(rawBuffer).metadata();
        if (meta.width && meta.width > this.config.maxWidth) {
          buffer = await sharp(rawBuffer).resize(this.config.maxWidth).toBuffer();
        }
      }

      const hash = await averageHash(buffer);

      if (this.lastHash !== null && hammingDistance(hash, this.lastHash) < SSIM_THRESHOLD) {
        return; // Skip visually identical screenshots
      }
      this.lastHash = hash;

      this.eventBus.emit('screenshot:captured', {
        id: crypto.randomUUID(),
        sessionId: this.config.sessionId,
        ts: Date.now(),
        type: 'screenshot',
        payload: {
          trigger,
          format: this.config.format,
          quality: this.config.quality,
          buffer,
          hash: hash.toString(16),
          width: this.config.maxWidth || 0,
        },
      });
    } catch (err) {
      console.error('[ScreenshotEngine] Capture failed:', err);
    }
  }

  detach(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.domMutationTimer) clearTimeout(this.domMutationTimer);
  }
}
