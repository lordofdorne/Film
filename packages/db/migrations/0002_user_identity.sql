-- Somewhere to put the identity of a person who signs in.
--
-- Until now a user row was created from an email address by whoever ran
-- intake, and later by the capture walk-through. Nobody authenticated, and the
-- project URL was the only credential.

-- The Supabase Auth identity, once there is one.
--
-- Deliberately not the primary key, though the schema comment used to say the
-- two were the same thing. A user row exists before any sign-in — intake makes
-- one from an email address, capture makes one the moment somebody types
-- theirs — so identity has to be able to arrive later and attach to a row that
-- already owns films. Making it the primary key would mean rewriting a key
-- that projects already reference, on the one code path that runs while a
-- customer is standing there waiting.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_id" uuid;

-- One identity, one row, both ways round.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_auth_id_unique";
ALTER TABLE "users" ADD CONSTRAINT "users_auth_id_unique" UNIQUE ("auth_id");

-- Sign-in finds the existing row by the address the provider verified, so two
-- rows sharing an address would make that lookup ambiguous — and would hand
-- somebody the wrong person's films. It was already true in practice: every
-- writer of this table looks the address up first and only inserts when there
-- is nothing there. This makes the database enforce it rather than trusting
-- that every future writer remembers to.
--
-- Fails loudly if duplicates already exist, which is the right outcome: they
-- would have to be merged by hand, and quietly picking one would lose films.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
