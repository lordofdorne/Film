#!/usr/bin/env bash
#
# Per-boot service startup: Docker daemon, local Postgres, schema migrations.
# Must tolerate restarts (no duplicate daemons), reach readiness, then return.
set -euo pipefail

# 1. Docker daemon. Not managed by systemd here, so start it directly and wait
#    for the socket. Guarded so a restart does not spawn a second daemon.
if ! sudo docker info >/dev/null 2>&1; then
  sudo rm -f /var/run/docker.pid 2>/dev/null || true
  sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 60); do
    if sudo docker info >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# Let the ubuntu user reach the socket without sudo — repo scripts call `docker`
# and `pnpm db:up`/`db:down` directly.
sudo chmod 666 /var/run/docker.sock

# 2. Local Postgres 16 on :55432 — the address every DATABASE_URL_* points at,
#    and the real database the db/queue/pipeline tests run against.
docker compose -f docker-compose.dev.yml up -d --wait

# 3. Apply pending migrations. Idempotent: the applied set is recorded, so this
#    is a no-op once the schema is current.
pnpm db:migrate
