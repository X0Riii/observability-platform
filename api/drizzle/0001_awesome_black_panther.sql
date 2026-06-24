ALTER TABLE "requests" ADD COLUMN "url_host" text;--> statement-breakpoint
CREATE INDEX "idx_requests_url_host" ON "requests" USING btree ("url_host" DESC, "ts" DESC);--> statement-breakpoint
CREATE INDEX "idx_requests_page" ON "requests" USING btree ("page_id" DESC, "ts" DESC);--> statement-breakpoint
CREATE INDEX "idx_responses_mime" ON "responses" USING btree ("mime_type" DESC, "ts" DESC);
