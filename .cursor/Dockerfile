# Base image for the Life Advice Cloud Agent environment.
#
# System dependencies live here (slow, stable). Repository dependencies are
# refreshed by .cursor/install.sh after checkout, and per-boot services are
# started by .cursor/start.sh.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System packages, in three groups:
#   - build basics + ffmpeg: the render/transcode pipeline shells out to
#     ffmpeg/ffprobe, and `pnpm film` will not run without them.
#   - docker + fuse-overlayfs: local Postgres 16 runs as a container via
#     docker-compose.dev.yml (`pnpm db:up`). The default overlay2 driver cannot
#     mount nested overlays in the Cloud VM, so the fuse-overlayfs driver is used.
#   - the shared libraries a headless Chromium needs: Remotion downloads its own
#     chrome-headless-shell but relies on these system libs to launch it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg sudo xz-utils \
      ffmpeg \
      docker.io docker-compose-v2 fuse-overlayfs fuse3 \
      libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2t64 libpango-1.0-0 libcairo2 libatspi2.0-0t64 \
      fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# Node.js 22 (package.json requires >=22.4.0) and pnpm 10.15.1 (the pinned
# packageManager), enabled through corepack.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@10.15.1 --activate

# Nested Docker cannot use the default overlay2/containerd-snapshotter path in
# the Cloud VM (overlay-on-overlay mounts fail). fuse-overlayfs with the classic
# snapshotter does work.
RUN mkdir -p /etc/docker \
 && printf '%s\n' \
      '{' \
      '  "storage-driver": "fuse-overlayfs",' \
      '  "features": { "containerd-snapshotter": false }' \
      '}' > /etc/docker/daemon.json

# The agent runs as `ubuntu`; let it start dockerd and reach the docker socket.
RUN usermod -aG docker ubuntu \
 && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-ubuntu-nopasswd \
 && chmod 0440 /etc/sudoers.d/90-ubuntu-nopasswd

USER ubuntu

# Prime corepack's cache for the ubuntu user so the pinned pnpm is available
# without a runtime download (corepack's cache is per-user home).
RUN corepack prepare pnpm@10.15.1 --activate
