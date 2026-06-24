import { CDPSession, Page } from 'playwright';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

export interface NormalizedRequest {
  id: string;
  sessionId: string;
  requestId: string;
  timestamp: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  initiator: any;
}

export class NetworkInstrumentation {
  private cdp!: CDPSession;
  private eventBus: EventEmitter;
  private sessionId: string;
  private clockOffset = 0;
  private requestMap = new Map<string, any>();

  constructor(eventBus: EventEmitter, sessionId: string, cdp?: CDPSession) {
    this.eventBus = eventBus;
    this.sessionId = sessionId;
    if (cdp) this.cdp = cdp;
  }

  async attach(page: Page): Promise<void> {
    if (!this.cdp) this.cdp = await page.context().newCDPSession(page);

    await this.cdp.send('Network.enable', {
      maxTotalBufferSize: 104857600,
      maxResourceBufferSize: 10485760,
    });

    await this.syncClock();

    this.cdp.on('Network.requestWillBeSent', (params) => {
      this.requestMap.set(params.requestId, params);
      this.eventBus.emit('network:request', this.normalizeRequest(params));
    });

    this.cdp.on('Network.responseReceived', async (params) => {
      const req = this.requestMap.get(params.requestId);
      let body = null;
      let base64Encoded = false;
      try {
        const result = await this.cdp.send('Network.getResponseBody', {
          requestId: params.requestId,
        });
        body = result.body;
        base64Encoded = result.base64Encoded;
      } catch {
      }

      this.eventBus.emit('network:response', {
        ...this.normalizeResponse(params),
        body,
        base64Encoded,
        url: req?.request?.url,
        method: req?.request?.method,
      });
    });

    this.cdp.on('Network.loadingFinished', (params) => {
      const req = this.requestMap.get(params.requestId);
      if (!req) return;
      this.eventBus.emit('network:loadingFinished', {
        requestId: params.requestId,
        timestamp: this.cdpToUnix(params.timestamp),
        encodedBodySize: params.encodedDataLength,
        url: req.request?.url,
      });
    });

    this.cdp.on('Network.loadingFailed', (params) => {
      this.eventBus.emit('network:loadingFailed', {
        requestId: params.requestId,
        timestamp: this.cdpToUnix(params.timestamp),
        errorText: params.errorText,
        canceled: params.canceled ?? false,
        blockedReason: params.blockedReason,
      });
    });

    this.cdp.on('Network.webSocketFrameSent', this.onWSFrame.bind(this, 'sent'));
    this.cdp.on('Network.webSocketFrameReceived', this.onWSFrame.bind(this, 'received'));
  }

  private async syncClock(): Promise<void> {
    const browserNow = (await this.cdp.send('Runtime.evaluate', {
      expression: 'Date.now()',
      returnByValue: true,
    })).result.value as number;

    const perfNow = (await this.cdp.send('Runtime.evaluate', {
      expression: 'performance.now()',
      returnByValue: true,
    })).result.value as number;

    this.clockOffset = browserNow - perfNow;
  }

  private cdpToUnix(cdpTimestamp: number): number {
    return Math.round(this.clockOffset + cdpTimestamp * 1000);
  }

  private normalizeRequest(params: any): NormalizedRequest {
    return {
      id: uuidv4(),
      sessionId: this.sessionId,
      requestId: params.requestId,
      timestamp: this.cdpToUnix(params.timestamp),
      method: params.request.method,
      url: params.request.url,
      headers: params.request.headers,
      postData: params.request.postData,
      resourceType: params.type,
      initiator: params.initiator,
    };
  }

  private normalizeResponse(params: any): any {
    return {
      id: uuidv4(),
      requestId: params.requestId,
      sessionId: this.sessionId,
      timestamp: this.cdpToUnix(params.timestamp),
      status: params.response.status,
      statusText: params.response.statusText,
      headers: params.response.headers,
      mimeType: params.response.mimeType,
      timing: params.response.timing,
      transferSize: params.response.transferSize ?? -1,
    };
  }

  private onWSFrame(direction: 'sent' | 'received', params: any) {
    this.eventBus.emit(`network:websocket:${direction}`, {
      id: uuidv4(),
      sessionId: this.sessionId,
      requestId: params.requestId,
      timestamp: this.cdpToUnix(params.timestamp),
      direction,
      payload: params.response?.payloadData ?? params.request?.payloadData,
    });
  }
}
