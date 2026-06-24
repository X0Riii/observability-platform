import { pgTable, uuid, timestamp, text, integer, smallint, boolean, jsonb, real, varchar, bigint, index } from 'drizzle-orm/pg-core';

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  urlSeed: text('url_seed'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata'),
});

export const pages = pgTable('pages', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => sessions.id),
  url: text('url').notNull(),
  title: text('title'),
  navigatedAt: timestamp('navigated_at', { withTimezone: true }).notNull(),
  loadTimeMs: integer('load_time_ms'),
  statusCode: smallint('status_code'),
});

export const requests = pgTable('requests', {
  id: uuid('id').primaryKey(),
  pageId: uuid('page_id').references(() => pages.id),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  method: varchar('method', { length: 10 }),
  url: text('url').notNull(),
  urlHost: text('url_host'),
  resourceType: varchar('resource_type', { length: 32 }),
  initiatorType: varchar('initiator_type', { length: 32 }),
  headers: jsonb('headers'),
  postDataRef: text('post_data_ref'),
}, (table) => ({
  urlHostIdx: index('idx_requests_url_host').on(table.urlHost, table.ts),
  pageIdx: index('idx_requests_page').on(table.pageId, table.ts),
}));

export const responses = pgTable('responses', {
  requestId: uuid('request_id').references(() => requests.id),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  status: smallint('status'),
  statusText: varchar('status_text', { length: 64 }),
  headers: jsonb('headers'),
  bodyRef: text('body_ref'),
  bodySize: integer('body_size'),
  transferSize: integer('transfer_size'),
  mimeType: varchar('mime_type', { length: 128 }),
  timing: jsonb('timing'),
}, (table) => ({
  mimeIdx: index('idx_responses_mime').on(table.mimeType, table.ts),
}));

export const domEvents = pgTable('dom_events', {
  id: uuid('id').primaryKey(),
  pageId: uuid('page_id').references(() => pages.id),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  tsPageMs: real('ts_page_ms'),
  mutationType: varchar('mutation_type', { length: 32 }),
  targetPath: text('target_path'),
  payload: jsonb('payload'),
});

export const wsEvents = pgTable('ws_events', {
  id: uuid('id').primaryKey(),
  requestId: uuid('request_id').references(() => requests.id),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  direction: varchar('direction', { length: 8 }),
  opcode: smallint('opcode'),
  payloadRef: text('payload_ref'),
  masked: boolean('masked'),
});

export const screenshots = pgTable('screenshots', {
  id: uuid('id').primaryKey(),
  pageId: uuid('page_id').references(() => pages.id),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  trigger: varchar('trigger', { length: 32 }),
  format: varchar('format', { length: 8 }),
  width: smallint('width'),
  height: smallint('height'),
  fileSize: integer('file_size'),
  objectKey: text('object_key').notNull(),
  perceptualHash: bigint('perceptual_hash', { mode: 'number' }),
});
