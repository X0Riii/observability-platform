-- Populate url_host from url
UPDATE requests SET url_host = split_part(url, '/', 3);

ALTER TABLE requests
  ALTER COLUMN url_host SET NOT NULL;

-- Drop FK on responses (responses use their own UUID, not requests.id)
ALTER TABLE responses DROP CONSTRAINT IF EXISTS responses_request_id_requests_id_fk;

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_requests_url_host ON requests (url_host, ts DESC);
CREATE INDEX IF NOT EXISTS idx_requests_page     ON requests (page_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_dom_target        ON dom_events USING gin (payload jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_responses_mime    ON responses (mime_type, ts DESC);
CREATE INDEX IF NOT EXISTS idx_responses_reqid   ON responses (request_id);
