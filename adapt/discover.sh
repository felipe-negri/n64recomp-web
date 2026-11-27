#!/usr/bin/env bash
# N64 adaptativo, laço de descoberta (protótipo): recompila, monta a página, joga ~60 s no Chrome headless e, quando o
# runtime não acha uma função ("Failed to find function at 0x..."), anota o endereço em <jogo>/extra.txt e repete.
# usage: discover.sh <rom.z64> <pasta do jogo> [voltas]
set -uo pipefail
rom="$1"; game="$2"; rounds="${3:-8}"
A=/mnt/jogos/n64-web/adapt; Z=/mnt/jogos/n64-web/work/Zelda64Recomp-web-665db5a9f45e
HERE="$(cd "$(dirname "$0")" && pwd)"
source /mnt/jogos/n64-web/emsdk/emsdk_env.sh > /dev/null 2>&1
exec 9> "$A/runner.lock"; flock 9  # o runner é um só: uma descoberta por vez
for i in $(seq 1 "$rounds"); do
  echo "== volta $i"
  "$A/.venv/bin/python" "$HERE/recomp.py" "$rom" "$game" "$A/runner" "$Z/N64Recomp" "$Z/RSPRecomp" \
    "$A/n64sym/src/builtin_signatures.sig" "$HERE/ucode_lib.json" | tail -2 || exit 1
  (cd "$A/runner" && cmake build-web > /dev/null 2>&1 && nice cmake --build build-web --target SuperMario64Recompiled > "$game/build.log" 2>&1) \
    || { grep -E "error" "$game/build.log" | head -5; exit 1; }
  hash=$(grep -oE "0x[0-9a-f]{16}" "$A/runner/include/adapt_game.h" | head -1 | cut -c3-)
  rm -rf "$game/page" && mkdir -p "$game/page" && B="$A/runner/build-web"
  cp $B/SuperMario64Recompiled.{js,wasm,data} $B/coi_serviceworker.js "$game/page/" && cp -L "$game/rom.z64" "$game/page/rom.z64"
  python3 - "$game/page" "$hash" "$HERE/../hub/hub_rom.js" "$B/SuperMario64Recompiled.html" <<'E'
import json, sys
page, h, hub, html = sys.argv[1:5]
open(f"{page}/index.html", "w").write(open(html).read().replace("</body>", f"<script>{open(hub).read()}</script></body>", 1))
json.dump({"rom": "rom.z64", "dest": f".config/N64Adaptive/adapt.{h}.z64"}, open(f"{page}/hub-rom.json", "w"))
E
  (cd /mnt/jogos/n64-web/probe && CLICK=640,409 timeout 400 node probe.mjs "$game/page" index.html ${PLAY_SECONDS:-150} "$game/shot-$i.png" > "$game/run-$i.log" 2>&1)
  new=$(grep -oE "Failed to find function at 0x[0-9A-Fa-f]+" "$game/run-$i.log" | awk '{print $NF}' | sort -u)
  uc=$(grep -oE "adapt-ucode .*" "$game/run-$i.log" | sed -E 's/.*size=(0x[0-9A-F]+) hash=([0-9a-f]+) head=([0-9a-f]+).*/\2 \1 \3/' | sort -u)
  if [ -z "$new" ] && [ -z "$uc" ]; then echo "nada novo na volta $i"; break; fi
  [ -n "$new" ] && echo "$new" | tee -a "$game/extra.txt"
  [ -n "$uc" ] && echo "$uc" | tee -a "$game/ucodes.txt"
done
