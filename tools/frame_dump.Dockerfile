# The image tools/remote_frame_dump.sh runs a recomp's Linux desktop build in, on a Linux host with an NVIDIA GPU, to
# dump its frames (RT64_FRAME_DUMP) by a plan and check them with tools/frame_check.mjs (tools/frame_dump.mjs drives
# both). The program draws on the host's GPU through NVIDIA's Vulkan driver, which the NVIDIA container toolkit mounts
# (--gpus, NVIDIA_DRIVER_CAPABILITIES=all), into Xvfb: NVIDIA's Vulkan presents to an X server without its driver,
# so no X server on the GPU, no display and no privileges are needed. xdotool sends a plan's keys and sizes the window,
# ImageMagick and x11-apps' xwd take its shots. GTK 3 and FreeType are what a recomp's Linux archive doesn't carry.
# remote_frame_dump.sh tags it with a hash of this file, so a change here makes the next run build a new one.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xdotool x11-utils x11-apps imagemagick \
      libgtk-3-0t64 libfreetype6 libvulkan1 ca-certificates procps && \
    rm -rf /var/lib/apt/lists/*
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
ENV NVIDIA_DRIVER_CAPABILITIES=all
