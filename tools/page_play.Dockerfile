# The image tools/remote_play_page.sh plays a page in on a Linux host with an NVIDIA GPU: Chrome (Google's own build)
# and Firefox (Mozilla's, not Ubuntu's snap), node for tools/play_page.mjs and tools/record_shaders.mjs, and the X
# server their windows go to, which Firefox needs for a WebGPU adapter and Chrome for one on the GPU (page_driver.mjs).
# Both draw WebGPU through Vulkan on the host's GPU, whose driver the NVIDIA container toolkit mounts (--gpus,
# NVIDIA_DRIVER_CAPABILITIES=all, its X driver included), and present into Xorg on NVIDIA's X driver with no display,
# so a present stays on the GPU (tools/play_job.mjs says what Xvfb's cost), with no privileges: the server's config is
# /etc/X11/page-play.conf, written here, since a server not run as root takes -config only as a name under /etc/X11.
# xdpyinfo tells when it is up. PulseAudio gives the page's sound a device that plays nowhere (a null sink), so the
# browsers run their audio threads as on a desktop. nvidia-smi comes with the driver.
# remote_play_page.sh tags it with a hash of this file and the week, so a change here, or a new week's browsers,
# makes the next run build a new one.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg xserver-xorg-core \
      x11-utils xauth libvulkan1 libpci3 pulseaudio fonts-dejavu-core fonts-liberation procps && \
    install -d -m 0755 /etc/apt/keyrings && \
    curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc && \
    echo 'deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main' \
      > /etc/apt/sources.list.d/mozilla.list && \
    printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla && \
    curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb && \
    apt-get update && apt-get install -y --no-install-recommends firefox /tmp/chrome.deb && \
    rm -rf /tmp/chrome.deb /var/lib/apt/lists/* && \
    printf '%s\n' \
      'Section "Files"' \
      '  ModulePath "/usr/lib/x86_64-linux-gnu/nvidia/xorg"' \
      '  ModulePath "/usr/lib/xorg/modules"' \
      'EndSection' \
      'Section "ServerFlags"' \
      '  Option "AutoAddDevices" "false"' \
      '  Option "AutoAddGPU" "false"' \
      'EndSection' \
      'Section "Device"' \
      '  Identifier "gpu"' \
      '  Driver "nvidia"' \
      '  Option "AllowEmptyInitialConfiguration" "true"' \
      '  Option "UseDisplayDevice" "None"' \
      'EndSection' \
      'Section "Screen"' \
      '  Identifier "screen"' \
      '  Device "gpu"' \
      '  DefaultDepth 24' \
      '  SubSection "Display"' \
      '    Depth 24' \
      '    Virtual 3840 2160' \
      '  EndSubSection' \
      'EndSection' > /etc/X11/page-play.conf
COPY --from=node:24-slim /usr/local/bin/node /usr/local/bin/node
ENV NVIDIA_DRIVER_CAPABILITIES=all
