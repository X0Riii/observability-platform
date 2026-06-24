import { CDPSession, Page } from 'playwright';
import { EventEmitter } from 'events';
import crypto from 'crypto';

export class StorageTracker {
  private cdp!: CDPSession;
  private eventBus: EventEmitter;
  private sessionId: string;
  private previousCookieHash = '';
  private cookiePollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(eventBus: EventEmitter, sessionId: string, cdp?: CDPSession) {
    this.eventBus = eventBus;
    this.sessionId = sessionId;
    if (cdp) this.cdp = cdp;
  }

  async attach(page: Page): Promise<void> {
    if (!this.cdp) this.cdp = await page.context().newCDPSession(page);

    await this.trackIndexedDB(page);
    this.startCookiePolling();
  }

  private async trackIndexedDB(page: Page): Promise<void> {
    try {
      const origin = page.url();
      const originUrl = new URL(origin);
      const originStr = `${originUrl.protocol}//${originUrl.host}`;

      await this.cdp.send('Storage.trackIndexedDBForOrigin', { origin: originStr });

      this.cdp.on('Storage.indexedDBContentUpdated', (params) => {
        this.eventBus.emit('storage:indexeddb', {
          id: crypto.randomUUID(),
          sessionId: this.sessionId,
          ts: Date.now(),
          type: 'storage:indexeddb',
          payload: {
            origin: params.origin,
            databaseName: params.databaseName,
            objectStoreName: params.objectStoreName,
          },
        });
      });
    } catch {
      console.log('[StorageTracker] IndexedDB tracking not available for this origin');
    }
  }

  private startCookiePolling(): void {
    this.cookiePollInterval = setInterval(async () => {
      try {
        const { cookies } = await this.cdp.send('Network.getAllCookies');
        const hash = this.hashCookies(cookies);

        if (this.previousCookieHash && hash !== this.previousCookieHash) {
          const delta = this.computeDelta(this.previousCookieHash, hash, cookies);
          this.eventBus.emit('storage:cookies', {
            id: crypto.randomUUID(),
            sessionId: this.sessionId,
            ts: Date.now(),
            type: 'storage:cookies',
            payload: {
              cookies,
              delta,
              count: cookies.length,
            },
          });
        }

        this.previousCookieHash = hash;
      } catch {
        // CDP session might be closed
      }
    }, 500);
  }

  private hashCookies(cookies: any[]): string {
    const sorted = cookies
      .map(c => `${c.name}=${c.value};${c.domain};${c.path}`)
      .sort()
      .join('|');
    return crypto.createHash('md5').update(sorted).digest('hex');
  }

  private computeDelta(prevHash: string, currentHash: string, currentCookies: any[]): any[] {
    return currentCookies.map(c => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      value: c.value,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
  }

  detach(): void {
    if (this.cookiePollInterval) {
      clearInterval(this.cookiePollInterval);
      this.cookiePollInterval = null;
    }
  }
}
