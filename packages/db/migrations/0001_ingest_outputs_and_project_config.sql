-- Two columns the pipeline needs once ingest and compose are stages rather
-- than a script working inside one hardcoded directory.

-- Where ingest wrote its output.
--
-- storage_key is the customer's original and is never overwritten: raw
-- recordings may be irreplaceable, and a normalisation recipe that turns out
-- to be wrong must be re-runnable against the source. So the derived file
-- gets its own key, and re-ingesting replaces only that.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "normalised_key" text;

-- Project settings that are not subject data.
--
-- subject_data is the template's own input — the names and dates that get
-- interpolated into cards. Which questions earn a prompt card, and which music
-- bed to build, are decisions about this project's edit. Putting them in
-- subject_data would mean the template's schema had to know about the
-- pipeline, which is exactly the coupling the template boundary exists to
-- prevent.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "config" jsonb NOT NULL DEFAULT '{}'::jsonb;
