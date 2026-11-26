#!/usr/bin/env bash
# Contrato "web-recomp" do Recompendium: scripts/port.sh <nome> <rom.z64|.v64|.n64>
# Acha o port pela SHA-1 da ROM (hub/games.json) e gera build/web-<nome>/ (index.html, .js, .wasm, .data, rom.z64).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$root/hub/port.py" "$@"
