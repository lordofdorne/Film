-- The hub stops downloading the film in order to draw its thumbnails.
--
-- Every card on the hub was drawn from the customer's ORIGINAL: a 7 MB
-- photograph rendered 56 pixels wide, and a whole interview take opened as a
-- <video> element to show one frame of it. Measured on one real film: 105 MB
-- across 18 assets, re-fetched on every visit.
--
-- So an asset gets somewhere to keep a small picture of itself. Null until
-- something has made one, which is what lets the hub tell "no thumbnail yet"
-- apart from "this asset has no picture in it", rather than guessing a key and
-- hoping the object is there.
ALTER TABLE "assets" ADD COLUMN "thumbnail_key" text;

-- And a stage to make one.
--
-- Deliberately its own stage rather than part of ingest. Ingest's input hash
-- decides what is cached, so teaching it a new output means bumping the recipe
-- — which re-transcodes every take in every unfinished film, invalidates
-- compose, and re-renders. Minutes of work per project to produce a 40 KB
-- JPEG, and it would still not touch a film that has already been delivered,
-- because the dispatcher only plans active projects.
--
-- A stage of its own has its own hash. It runs once per asset, for assets that
-- were ingested long before this column existed, and it costs nothing to skip.
--
-- ADD VALUE inside a transaction is allowed since PostgreSQL 12 as long as the
-- new value is not USED in the same transaction. Nothing here uses it.
ALTER TYPE "stage_name" ADD VALUE IF NOT EXISTS 'thumbnail';
