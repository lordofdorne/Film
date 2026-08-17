-- Where the finished film should go, typed mid-walk-through.
--
-- Details are steps now, so "Where should we send it?" is answered somewhere
-- in the middle of capture by somebody who may never click the link in their
-- inbox. That address is delivery metadata, NOT identity: writing it into
-- users.email — which is unique and decides who owns which films — would let
-- anyone park an unverified address on the identity column and block the real
-- owner from ever signing in with it. It lands here instead, and users.email
-- keeps meaning "an address an identity provider verified".
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deliver_to" text;
