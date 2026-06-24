export const TOPICS = {
  NETWORK_REQUESTS:  'obs.network.requests',
  NETWORK_RESPONSES: 'obs.network.responses',
  NETWORK_ERRORS:    'obs.network.errors',
  DOM_MUTATIONS:     'obs.dom.mutations',
  JS_EVENTS:         'obs.js.events',
  STORAGE_EVENTS:    'obs.storage.events',
  SCREENSHOTS:       'obs.screenshots',
  PERFORMANCE:       'obs.performance',
  TIMELINE_MERGED:   'obs.timeline.merged',
} as const;

export const TOPIC_CONFIG = [
  { topic: 'obs.network.requests',  partitions: 16, retention: '7d',  compression: 'lz4' },
  { topic: 'obs.network.responses', partitions: 16, retention: '7d',  compression: 'zstd' },
  { topic: 'obs.dom.mutations',    partitions: 8,  retention: '7d',  compression: 'lz4' },
  { topic: 'obs.js.events',        partitions: 8,  retention: '7d',  compression: 'lz4' },
  { topic: 'obs.storage.events',   partitions: 4,  retention: '30d', compression: 'zstd' },
  { topic: 'obs.screenshots',      partitions: 4,  retention: '3d',  compression: 'none' },
  { topic: 'obs.performance',      partitions: 4,  retention: '30d', compression: 'zstd' },
  { topic: 'obs.timeline.merged',  partitions: 32, retention: '30d', compression: 'zstd' },
];
