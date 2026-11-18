# The image tools/remote_console_ref.sh runs tools/console_ref.mjs in on a Linux host: what builds mupen64plus-next's
# libretro core (with Angrylion's RDP and the LLE RSPs) and tools/console_ref.c, and runs them. No GPU: Angrylion draws
# on the CPU. The core itself is built by console_ref.mjs into a cache folder the host keeps, at the commit it pins,
# as a build job of the host's queue, not here.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates nasm \
      libgl-dev zlib1g-dev libpng-dev && \
    rm -rf /var/lib/apt/lists/*
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
