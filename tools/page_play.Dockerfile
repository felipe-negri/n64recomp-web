# The image tools/remote_play_page.sh plays a page in on a Linux host with an NVIDIA GPU: Chrome (Google's own build)
# and Firefox (Mozilla's, not Ubuntu's snap), node for tools/play_page.mjs and tools/record_shaders.mjs, and Xvfb for
# Firefox's window, which it needs for a WebGPU adapter (page_driver.mjs). Both draw WebGPU through Vulkan on the host's
# GPU, whose driver the NVIDIA container toolkit mounts (--gpus, NVIDIA_DRIVER_CAPABILITIES=all), and present into
# Xvfb, with no X server on the GPU, no display and no privileges. PulseAudio gives the page's sound a device that plays
# nowhere (a null sink), so the browsers run their audio threads as on a desktop. nvidia-smi comes with the driver.
# remote_play_page.sh tags it with a hash of this file and the week, so a change here, or a new week's browsers,
# makes the next run build a new one.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg xvfb xauth \
      libvulkan1 libpci3 pulseaudio fonts-dejavu-core fonts-liberation procps && \
    install -d -m 0755 /etc/apt/keyrings && \
    curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc && \
    echo 'deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main' \
      > /etc/apt/sources.list.d/mozilla.list && \
    printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla && \
    curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb && \
    apt-get update && apt-get install -y --no-install-recommends firefox /tmp/chrome.deb && \
    rm -rf /tmp/chrome.deb /var/lib/apt/lists/*
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
ENV NVIDIA_DRIVER_CAPABILITIES=all
