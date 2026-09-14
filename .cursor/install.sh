#!/usr/bin/env bash
#
# Idempotent repository bootstrap, run after checkout / when refreshing deps.
# No servers, migrations, or tests here — only durable, source-derived setup.
set -euo pipefail

# One env file drives every command (see .env.example). Never clobber a
# customised one; the defaults point at the local Postgres on :55432.
if [ ! -f .env ]; then
  cp .env.example .env
fi

corepack prepare pnpm@10.15.1 --activate >/dev/null 2>&1 || true

# Frozen install: the lockfile is the source of truth.
pnpm install --frozen-lockfile

# Scripts (db:migrate, worker, intake, bed:upload) import the workspace packages
# from their built dist/ output, and db:migrate does not build first — so the
# packages must be compiled before anything in start.sh or the terminals runs.
pnpm build:packages
