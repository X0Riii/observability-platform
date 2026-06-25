import { CDPSession, Page } from 'playwright';
import { EventEmitter } from 'events';
import crypto from 'crypto';

const OBSERVER_SCRIPT = `
(function() {
  if (window.__domObserverInstalled) return;
  window.__domObserverInstalled = true;

  function getNodePath(node) {
    if (!node || node === document) return '';
    if (node === document.body) return 'body';
    if (node === document.head) return 'head';
    if (node === document.documentElement) return 'html';
    let path = '';
    while (node && node !== document) {
      let selector = node.nodeName.toLowerCase();
      if (node.id) {
        selector += '#' + node.id;
      } else if (node.className && typeof node.className === 'string') {
        selector += '.' + node.className.trim().split(/\\s+/).slice(0, 2).join('.');
      }
      path = selector + (path ? ' > ' + path : '');
      node = node.parentNode;
    }
    return path;
  }

  function serializeNode(node) {
    if (!node) return null;
    const attrs = {};
    if (node.attributes) {
      for (const attr of node.attributes) {
        attrs[attr.name] = attr.value;
      }
    }
    return {
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      nodeValue: node.nodeValue,
      attributes: attrs,
      path: getNodePath(node),
    };
  }

  const mo = new MutationObserver((mutations) => {
    const batch = mutations.map(m => ({
      type: m.type,
      target: getNodePath(m.target),
      addedNodes: [...m.addedNodes].map(serializeNode).filter(Boolean),
      removedNodes: [...m.removedNodes].map(serializeNode).filter(Boolean),
      attributeName: m.attributeName,
      attributeNamespace: m.attributeNamespace,
      oldValue: m.oldValue,
      nextSibling: m.nextSibling ? getNodePath(m.nextSibling) : null,
      previousSibling: m.previousSibling ? getNodePath(m.previousSibling) : null,
    }));
    window.__obsEmit({ type: 'dom:mutation', data: batch, ts: performance.now() });
  });

  try {
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    });
  } catch(e) {}

  const _attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = _attachShadow.call(this, init);
    if (root && root.nodeType === 11) {
      try { mo.observe(root, { childList: true, subtree: true, attributes: true }); } catch(e) {}
    }
    window.__obsEmit({ type: 'dom:shadowRoot', data: { host: getNodePath(this), mode: init.mode }, ts: performance.now() });
    return root;
  };
})();
`;

export class DomObserver {
  private cdp: CDPSession | null = null;
  private eventBus: EventEmitter;
  private sessionId: string;
  private clockOffset = 0;

  constructor(eventBus: EventEmitter, sessionId: string, cdp?: CDPSession) {
    this.eventBus = eventBus;
    this.sessionId = sessionId;
    if (cdp) this.cdp = cdp;
  }

  async attach(page: Page): Promise<void> {
    if (!this.cdp) this.cdp = await page.context().newCDPSession(page);

    await this.syncClock();

    await page.exposeFunction('__obsEmit', (payload: any) => {
      const event = {
        id: crypto.randomUUID(),
        sessionId: this.sessionId,
        ts: this.clockOffset + payload.ts,
        tsPage: payload.ts,
        type: payload.type,
        payload: payload.data,
      };
      this.eventBus.emit(payload.type, event);
    });

    await page.addInitScript(OBSERVER_SCRIPT);
  }

  private async syncClock(): Promise<void> {
    try {
      const browserNow = (await this.cdp!.send('Runtime.evaluate', {
        expression: 'Date.now()',
        returnByValue: true,
      })).result.value as number;

      const perfNow = (await this.cdp!.send('Runtime.evaluate', {
        expression: 'performance.now()',
        returnByValue: true,
      })).result.value as number;

      this.clockOffset = browserNow - perfNow;
    } catch {
      this.clockOffset = Date.now();
    }
  }
}
