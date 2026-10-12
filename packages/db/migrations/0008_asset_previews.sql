-- A light copy of each take, clip and photograph for the preview to play.
--
-- The preview streamed the normalised files: 1080p at CRF 20, keyframes up to
-- ten seconds apart, every interview fetched twice. Each cut into a take
-- decoded seconds of video before its first frame, while the film was meant to
-- be playing — the stutter people saw. The render keeps using the normalised
-- file; this is for the browser only.
--
-- Null until the preview stage has made one; the preview falls back to the
-- normalised file until then, so a film is never unwatchable for want of it.
ALTER TABLE "assets" ADD COLUMN "preview_key" text;

-- Its own stage, for the reason the thumbnail stage is its own: ingest's hash
-- decides what is cached, and teaching it a new output would re-transcode
-- every take in every unfinished film. Not used in this transaction, so ADD
-- VALUE is allowed inside it.
ALTER TYPE "stage_name" ADD VALUE IF NOT EXISTS 'preview';
