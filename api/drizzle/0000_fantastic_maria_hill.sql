CREATE TABLE "dom_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"ts_page_ms" real,
	"mutation_type" varchar(32),
	"target_path" text,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"url" text NOT NULL,
	"title" text,
	"navigated_at" timestamp with time zone NOT NULL,
	"load_time_ms" integer,
	"status_code" smallint
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"method" varchar(10),
	"url" text NOT NULL,
	"resource_type" varchar(32),
	"initiator_type" varchar(32),
	"headers" jsonb,
	"post_data_ref" text
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"request_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"status" smallint,
	"status_text" varchar(64),
	"headers" jsonb,
	"body_ref" text,
	"body_size" integer,
	"transfer_size" integer,
	"mime_type" varchar(128),
	"timing" jsonb
);
--> statement-breakpoint
CREATE TABLE "screenshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"trigger" varchar(32),
	"format" varchar(8),
	"width" smallint,
	"height" smallint,
	"file_size" integer,
	"object_key" text NOT NULL,
	"perceptual_hash" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"url_seed" text,
	"user_agent" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "ws_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"direction" varchar(8),
	"opcode" smallint,
	"payload_ref" text,
	"masked" boolean
);
--> statement-breakpoint
ALTER TABLE "dom_events" ADD CONSTRAINT "dom_events_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ws_events" ADD CONSTRAINT "ws_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;