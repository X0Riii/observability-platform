import { CDPSession, Page } from 'playwright';
import { EventEmitter } from 'events';
import crypto from 'crypto';

const EVAL_DETECT_SCRIPT = `
(function() {
  if (window.__evalDetectorInstalled) return;
  window.__evalDetectorInstalled = true;

  let _depth = 0;
  function safeEmit(payload) {
    if (_depth > 10) return;
    _depth++;
    try { window.__obsEmit(payload); } catch(e) {}
    _depth--;
  }

  const _eval = window.eval;
  window.eval = function(code) {
    safeEmit({
      type: 'js:eval',
      data: {
        code: code.substring(0, 500),
        length: code.length,
        timestamp: Date.now(),
      },
      ts: performance.now(),
    });
    return _eval.call(window, code);
  };

  const _Function = window.Function;
  window.Function = new Proxy(_Function, {
    apply(target, thisArg, args) {
      const code = args.map(a => String(a)).join(', ').substring(0, 500);
      safeEmit({
        type: 'js:newFunction',
        data: { code, length: args.reduce((a, b) => a + String(b).length, 0) },
        ts: performance.now(),
      });
      return Reflect.apply(target, thisArg, args);
    },
    construct(target, args) {
      const code = args.map(a => String(a)).join(', ').substring(0, 500);
      safeEmit({
        type: 'js:newFunction',
        data: { code, length: args.reduce((a, b) => a + String(b).length, 0) },
        ts: performance.now(),
      });
      return Reflect.construct(target, args);
    },
  });
})();
`;

export class JsRuntimeObserver {
  private cdp!: CDPSession;
  private eventBus: EventEmitter;
  private sessionId: string;
  private scriptCache = new Set<string>();
  private clockOffset = 0;

  constructor(eventBus: EventEmitter, sessionId: string, cdp?: CDPSession) {
    this.eventBus = eventBus;
    this.sessionId = sessionId;
    if (cdp) this.cdp = cdp;
  }

  async attach(page: Page): Promise<void> {
    if (!this.cdp) this.cdp = await page.context().newCDPSession(page);

    await this.cdp.send('Debugger.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('Runtime.setAsyncCallStackDepth', { maxDepth: 32 });

    await this.syncClock();

    this.cdp.on('Debugger.scriptParsed', (params) => {
      if (this.scriptCache.has(params.scriptId)) return;
      this.scriptCache.add(params.scriptId);

      this.eventBus.emit('js:script', {
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        ts: Date.now(),
        type: 'js:script',
        payload: {
          scriptId: params.scriptId,
          url: params.url,
          sourceMapURL: params.sourceMapURL,
          hash: params.hash,
          isModule: params.isModule ?? false,
          length: params.length,
          startLine: params.startLine,
          startColumn: params.startColumn,
          executionContextId: params.executionContextId,
          hasSourceURL: params.hasSourceURL ?? false,
          isLiveEdit: params.isLiveEdit ?? false,
        },
      });
    });

    this.cdp.on('Runtime.exceptionThrown', (params) => {
      const exc = params.exceptionDetails;
      this.eventBus.emit('js:exception', {
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        ts: this.cdpToUnix(params.timestamp),
        type: 'js:exception',
        payload: {
          message: exc.text,
          stack: exc.stackTrace,
          scriptId: exc.scriptId,
          lineNumber: exc.lineNumber,
          columnNumber: exc.columnNumber,
          url: exc.url,
          exception: exc.exception?.description,
        },
      });
    });

    this.cdp.on('Runtime.consoleAPICalled', (params) => {
      const args = params.args.map((a: any) => {
        if (a.type === 'object' && a.preview) {
          return { type: a.type, subtype: a.subtype, preview: a.preview.description ?? a.preview.value };
        }
        return { type: a.type, value: a.value, subtype: a.subtype };
      });

      this.eventBus.emit('js:console', {
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        ts: this.cdpToUnix(params.timestamp),
        type: 'js:console',
        payload: {
          type: params.type,
          args,
          stackTrace: params.stackTrace,
          executionContextId: params.executionContextId,
          timestamp: params.timestamp,
        },
      });
    });

    await page.addInitScript(EVAL_DETECT_SCRIPT);
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
}
