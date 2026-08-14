-- Row level security on, and deliberately no policies.
--
-- Supabase publishes the `public` schema over HTTP through PostgREST, guarded
-- by nothing but RLS, using a key that ships in the browser bundle. A table in
-- that schema with RLS off is readable by anyone who views source — which for
-- this application means customers' recordings, their subject data, their
-- storage keys and the consent record.
--
-- The Data API should be switched off in the dashboard, and this exists so that
-- switching it back on is not enough to expose anything. One protection ought
-- not to be the only thing standing between a public key and the database.
--
-- NO POLICIES ARE ADDED, on purpose. RLS with no policy denies everything, and
-- there is nothing to allow: the browser never talks to Postgres. Every read
-- goes through server code over a direct connection, and authorisation is
-- `ownsProject`, tested against a real database. Writing policies here would be
-- a second copy of that rule in a second language, free to disagree with the
-- first.
--
-- The application keeps working because Postgres does not apply RLS to a
-- table's owner, and the app connects as the owner. The one thing this would
-- break is connecting as some other role later — at which point these tables
-- need policies, and the decision should be a deliberate one.

ALTER TABLE "users"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upload_sessions"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stage_executions"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stage_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "edl_versions"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approvals"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "renders"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_events"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deletion_requests" ENABLE ROW LEVEL SECURITY;

-- The migration ledger itself. Nothing reads it but the migration runner, which
-- also connects as the owner.
ALTER TABLE "schema_migrations" ENABLE ROW LEVEL SECURITY;

-- pg-boss keeps its tables in its own `pgboss` schema and is never managed
-- here. Supabase exposes only the schemas it is told to; `pgboss` must not be
-- one of them.
