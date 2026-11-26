#!/usr/bin/env bash
# Contrato "web-recomp" do Recompendium: prepara um checkout novo (Emscripten SDK e naga, nas versões do CI do
# N64Recomp-browser). Pode rodar de novo. Precisa no PATH: git cmake ninja clang (com alvo MIPS) ld.lld python3
# spirv-opt cargo.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
EMSDK="${EMSDK:-$root/tools/emsdk}"
EMSDK_VERSION="6.0.12"
NAGA_VERSION="30.0.1"
echo "== [1/3] conferindo ferramentas"
for t in git cmake ninja clang ld.lld python3 spirv-opt cargo; do
  command -v "$t" >/dev/null || { echo "falta $t no PATH" >&2; exit 1; }
done
clang --print-targets | grep -q mips || { echo "o clang não tem alvo MIPS" >&2; exit 1; }
echo "== [2/3] Emscripten SDK $EMSDK_VERSION"
if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  git clone -q https://github.com/emscripten-core/emsdk.git "$EMSDK"
fi
"$EMSDK/emsdk" install "$EMSDK_VERSION" >/dev/null
"$EMSDK/emsdk" activate "$EMSDK_VERSION" >/dev/null
echo "== [3/3] naga $NAGA_VERSION"
if [ ! -x "$root/tools/cargo/bin/naga" ]; then
  cargo install naga-cli --version "$NAGA_VERSION" --locked --root "$root/tools/cargo" -q
fi
echo "== ready"
