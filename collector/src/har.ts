export interface HarEntry {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status: number;
  statusText: string;
  mimeType: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  postData?: string;
  body?: string | null;
  base64Encoded: boolean;
  timing: any;
  transferSize: number;
  encodedBodySize?: number;
}

export function buildHar(sessionId: string, pageUrl: string, entries: HarEntry[]): string {
  const har: any = {
    log: {
      version: '1.3',
      creator: { name: 'WebObservabilityCollector', version: '2.0.0' },
      pages: [{
        id: `page_0`,
        title: pageUrl,
        startedDateTime: entries.length > 0
          ? new Date(entries[0].timestamp).toISOString()
          : new Date().toISOString(),
        pageTimings: {},
      }],
      entries: entries.map(e => ({
        pageref: 'page_0',
        startedDateTime: new Date(e.timestamp).toISOString(),
        request: {
          method: e.method,
          url: e.url,
          httpVersion: 'HTTP/2.0',
          headers: Object.entries(e.requestHeaders || {}).map(([name, value]) => ({ name, value })),
          postData: e.postData ? { mimeType: 'application/octet-stream', text: e.postData } : undefined,
          headersSize: -1,
          bodySize: e.postData ? Buffer.byteLength(e.postData, 'utf-8') : -1,
        },
        response: {
          status: e.status,
          statusText: e.statusText,
          httpVersion: 'HTTP/2.0',
          headers: Object.entries(e.responseHeaders || {}).map(([name, value]) => ({ name, value })),
          content: {
            size: e.body ? Buffer.byteLength(e.body, 'utf-8') : 0,
            compression: 0,
            mimeType: e.mimeType,
            text: e.body ?? undefined,
            encoding: e.base64Encoded ? 'base64' : undefined,
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: e.transferSize,
          _transferSize: e.transferSize,
        },
        cache: {},
        timings: e.timing ?? {},
        time: 0,
        _requestId: e.requestId,
      })),
    },
  };
  return JSON.stringify(har);
}
