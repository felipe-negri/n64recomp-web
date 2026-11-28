#!/usr/bin/env bash
# N64 adaptativo: ferramentas que o modo genérico usa (chamado pelo scripts/setup.sh). Pode rodar de novo.
# Em $N64_WORK: venv (splat, spimdisasm, rabbitizer, xxhash), assinaturas do n64sym, Playwright + Chromium para as
# partidas headless, e o runner (o projeto do Super Mario 64: Recompiled do n64hub, num commit fixo, com as mudanças
# de adapt/runner/files por cima) mais o N64Recomp/RSPRecomp com os patches web.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
W="${N64_WORK:-$here/../work}"
mkdir -p "$W"
RUNNER_REPO=https://github.com/n64hub/super-mario-64-recomp
RUNNER_COMMIT=0daea3f9b7d9059df8b658d8616e41e08bef5a4d
N64SYM_COMMIT=ccf4600f3389f1a84bde23339225cf372fdf7712

if [ ! -x "$W/adapt-venv/bin/python" ]; then
  python3 -m venv "$W/adapt-venv"
  "$W/adapt-venv/bin/pip" install -q 'splat64[mips]==0.50.1' spimdisasm==1.42.4 rabbitizer==1.16.2 xxhash==4.1.0
fi
if [ ! -f "$W/n64sym/src/builtin_signatures.sig" ]; then
  git init -q "$W/n64sym" && git -C "$W/n64sym" fetch -q --depth 1 https://github.com/shygoo/n64sym "$N64SYM_COMMIT" \
    && git -C "$W/n64sym" checkout -q FETCH_HEAD
fi
if [ ! -d "$W/adapt-node/node_modules/playwright" ]; then
  mkdir -p "$W/adapt-node" && (cd "$W/adapt-node" && npm init -y > /dev/null && npm i -s playwright@1.65.1 \
    && PLAYWRIGHT_BROWSERS_PATH="$W/adapt-node/browsers" npx -y playwright install chromium > /dev/null)
fi
R="$W/adapt-runner"
if [ ! -f "$R/.adapt-ready" ]; then
  [ -d "$R/.git" ] || git clone -q "$RUNNER_REPO" "$R"
  git -C "$R" checkout -q "$RUNNER_COMMIT"
  git -C "$R" submodule update -q --init --recursive --jobs 8
  cmake -P "$R/lib/N64Recomp-browser/patches/apply.cmake" "$R/lib" > /dev/null
  (cd "$here/runner/files" && find . -type f) | while read -r f; do mkdir -p "$R/$(dirname "$f")"; cp "$here/runner/files/$f" "$R/$f"; done
  T="$R/lib/N64ModernRuntime/N64Recomp"
  cmake -S "$T" -B "$T/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ > /dev/null
  cmake --build "$T/build" > /dev/null
  touch "$R/.adapt-ready"
fi
echo "adaptativo pronto em $W"
