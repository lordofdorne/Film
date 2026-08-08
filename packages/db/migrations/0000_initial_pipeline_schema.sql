CREATE TYPE "public"."asset_kind" AS ENUM('interview', 'photo', 'video', 'audio');--> statement-breakpoint
CREATE TYPE "public"."capture_method" AS ENUM('browser', 'native_upload');--> statement-breakpoint
CREATE TYPE "public"."failure_class" AS ENUM('permanent', 'transient', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'capturing', 'processing', 'awaiting_approval', 'approved', 'rendering', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."stage_name" AS ENUM('ingest', 'qc', 'transcribe', 'select', 'compose', 'render', 'deliver');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('claimed', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('in_progress', 'completed', 'aborted');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"edl_version_id" uuid NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"question_id" text,
	"slot_id" text,
	"kind" "asset_kind" NOT NULL,
	"sha256" text,
	"storage_key" text NOT NULL,
	"content_type" text,
	"byte_size" bigint,
	"etag" text,
	"capture_method" "capture_method",
	"qc_metrics" jsonb,
	"warnings" jsonb,
	"transcript_key" text,
	"selection" jsonb,
	"ai_provenance" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subject_name" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"terms_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "edl_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edl_versions_project_version" UNIQUE("project_id","version")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"subject_data" jsonb NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"stripe_payment_id" text,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edl_version_id" uuid NOT NULL,
	"format_id" text NOT NULL,
	"quality" text NOT NULL,
	"output_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_execution_id" uuid NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "stage_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid,
	"stage" "stage_name" NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"status" "stage_status" DEFAULT 'claimed' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"failure_class" "failure_class",
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_executions_identity" UNIQUE NULLS NOT DISTINCT ("project_id","asset_id","stage","input_hash")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"stripe_event_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid,
	"upload_id" text NOT NULL,
	"status" "upload_status" DEFAULT 'in_progress' NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_edl_version_id_edl_versions_id_fk" FOREIGN KEY ("edl_version_id") REFERENCES "public"."edl_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edl_versions" ADD CONSTRAINT "edl_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_edl_version_id_edl_versions_id_fk" FOREIGN KEY ("edl_version_id") REFERENCES "public"."edl_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_events" ADD CONSTRAINT "stage_events_stage_execution_id_stage_executions_id_fk" FOREIGN KEY ("stage_execution_id") REFERENCES "public"."stage_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_executions" ADD CONSTRAINT "stage_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_executions" ADD CONSTRAINT "stage_executions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_project_idx" ON "assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assets_project_question_idx" ON "assets" USING btree ("project_id","question_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "projects_status_updated_idx" ON "projects" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "renders_edl_version_idx" ON "renders" USING btree ("edl_version_id");--> statement-breakpoint
CREATE INDEX "stage_events_execution_idx" ON "stage_events" USING btree ("stage_execution_id","ts");--> statement-breakpoint
CREATE INDEX "stage_executions_project_idx" ON "stage_executions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "stage_executions_status_updated_idx" ON "stage_executions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_project_idx" ON "upload_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_created_idx" ON "upload_sessions" USING btree ("status","created_at");