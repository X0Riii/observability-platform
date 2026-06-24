import { CDPSession, Page } from 'playwright';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RRWEB_UMD_PATH = resolve(__dirname, '..', '..', '..', 'node_modules', 'rrweb', 'dist', 'rrweb.umd.min.cjs');
const RRWEB_UMD = readFileSync(RRWEB_UMD_PATH, 'utf-8');

const RRWEB_RECORD_SCRIPT = `
(function() {
  if (window.__rrwebInstalled) return;
  window.__rrwebInstalled = true;

  ${RRWEB_UMD}

  if (typeof window.rrwebRecord === 'undefined' && typeof window.rrweb !== 'undefined') {
    window.rrwebRecord = rrweb.record;
  }
  if (typeof window.rrwebRecord === 'function') {
    window.__rrwebStopFn = window.rrwebRecord({
      emit(event) {
        window.__obsEmit({
          type: 'rrweb:event',
          data: event,
          ts: performance.now(),
        });
      },
      recordCanvas: false,
      collectFonts: false,
      blockClass: 'rr-block',
      ignoreClass: 'rr-ignore',
    });
  }
})();
`;

export class SnapshotEngine {
  private cdp: CDPSession | null = null;
  private eventBus: EventEmitter;
  private sessionId: string;
  private rrwebEvents: any[] = [];

  constructor(eventBus: EventEmitter, sessionId: string, cdp?: CDPSession) {
    if (cdp) this.cdp = cdp;
    this.eventBus = eventBus;
    this.sessionId = sessionId;
  }

  async attach(page: Page): Promise<void> {
    this.eventBus.on('rrweb:event', (event) => {
      this.rrwebEvents.push(event.payload);
    });

    await page.addInitScript(RRWEB_RECORD_SCRIPT);
  }

  getRrwebSnapshot(): any {
    if (this.rrwebEvents.length === 0) return null;
    return {
      version: 2,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      events: this.rrwebEvents,
    };
  }

  async captureAccessibilityTree(page: Page): Promise<any> {
    try {
      if (!this.cdp) this.cdp = await page.context().newCDPSession(page);
      const result: any = await this.cdp.send('Accessibility.getFullAXTree');
      return result;
    } catch {
      return null;
    }
  }
}
