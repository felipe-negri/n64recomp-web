#!/usr/bin/env bash
# N64 adaptativo, laço de descoberta (protótipo): recompila, monta a página, joga ~60 s no Chrome headless e, quando o
# runtime não acha uma função ("Failed to find function at 0x..."), anota o endereço em <jogo>/extra.txt e repete.
# usage: discover.sh <rom.z64> <pasta do jogo> [voltas]
set -uo pipefail
rom="$1"; game="$2"; rounds="${3:-8}"
HERE="$(cd "$(dirname "$0")" && pwd)"
W="${N64_WORK:-$HERE/../work}"                     # adapt/setup.sh deixa tudo aqui
PY="${ADAPT_PY:-$W/adapt-venv/bin/python}"
RUNNER="${ADAPT_RUNNER:-$W/adapt-runner}"
TOOLS="${ADAPT_TOOLS:-$RUNNER/lib/N64ModernRuntime/N64Recomp/build}"
SIGS="${ADAPT_SIGS:-$W/n64sym/src/builtin_signatures.sig}"
export PLAYWRIGHT_PKG="${PLAYWRIGHT_PKG:-$W/adapt-node/package.json}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$W/adapt-node/browsers}"
source "${EMSDK:-$HERE/../tools/emsdk}/emsdk_env.sh" > /dev/null 2>&1
[ -n "${N64_EXTRA_PATH:-}" ] && export PATH="$N64_EXTRA_PATH:$PATH"
NAGA_BIN="${NAGA:-$HERE/../tools/cargo/bin/naga}"
exec 9> "$RUNNER.lock"; flock 9  # o runner é um só: uma descoberta por vez
for i in $(seq 1 "$rounds"); do
  echo "== volta $i"
  "$PY" "$HERE/recomp.py" "$rom" "$game" "$RUNNER" "$TOOLS/N64Recomp" "$TOOLS/RSPRecomp" "$SIGS" \
    "$HERE/ucode_lib.json" | tail -2 || exit 1
  if [ ! -f "$RUNNER/build-web/build.ninja" ]; then  # primeira vez: configura o build web do runner
    # os ports do Emscripten que o RecompFrontend/RmlUi pedem (num emsdk novo não estão no cache)
    embuilder build sdl2-mt freetype-legacysjlj > "$game/embuilder.log" 2>&1 || { tail -20 "$game/embuilder.log"; exit 1; }
    (cd "$RUNNER" && emcmake cmake -S . -B build-web -G Ninja -DCMAKE_BUILD_TYPE=Release -DRT64_NAGA_EXECUTABLE="$NAGA_BIN" \
      -DSM64_PATCHES=OFF > "$game/configure.log" 2>&1) || { tail -20 "$game/configure.log"; exit 1; }
  fi
  if ! (cd "$RUNNER" && cmake build-web > /dev/null 2>&1 && nice cmake --build build-web --target SuperMario64Recompiled -- -k 0 > "$game/build.log" 2>&1); then
    # desvio para fora da função ("undeclared label"): anota origem e destino em merge.txt e tenta de novo
    m=$(python3 - "$game/build.log" "$RUNNER/RecompiledFuncs" "$game/merge.txt" <<'PY'
import re, sys
log = open(sys.argv[1], errors="replace").read()
out = set()
for f, line, lab in re.findall(r"(\S+\.c):(\d+):\d+: error: use of undeclared label 'L_([0-9A-F]+)'", log):
    src = open(f, errors="replace").read().splitlines()[: int(line)]
    addr = next((m.group(1) for l in reversed(src) for m in [re.search(r"// 0x([0-9A-F]{8}):", l)] if m), None)
    fn = next((m.group(1) for l in reversed(src) for m in [re.search(r"^RECOMP_FUNC \w+ (\w+)\(", l)] if m), None)
    if addr:
        pair = f"0x{addr} 0x{lab}"
        seen = open(sys.argv[3]).read() if __import__("os").path.exists(sys.argv[3]) else ""
        # o mesmo par de novo: juntar não resolveu (overlays que se sobrepõem, dado no meio): vira stub
        out.add(f"stub {fn}" if pair in seen and fn else pair)
# qualquer outro erro no C gerado: a função vira stub (sem ela o resto do jogo ainda compila)
for f, line in re.findall(r"(\S+RecompiledFuncs/\S+\.c):(\d+):\d+: error: (?!use of undeclared label 'L_)", log):
    src = open(f, errors="replace").read().splitlines()[: int(line)]
    fn = next((m.group(1) for l in reversed(src) for m in [re.search(r"^RECOMP_FUNC \w+ (\w+)\(", l)] if m), None)
    if fn:
        out.add(f"stub {fn}")
print("\n".join(sorted(out)))
PY
)
    if [ -z "$m" ]; then grep -E "error" "$game/build.log" | head -5; exit 1; fi
    echo "$m" | grep -v '^stub ' | tee -a "$game/merge.txt"
    echo "$m" | grep '^stub ' | awk '{print $2}' | tee -a "$game/stubs.txt"
    # função que só o N64Recomp conhecia (static_N_ADDR): vira entrada do mapa, para o stub pegar pelo nosso nome
    echo "$m" | grep -oE '^stub static_[0-9]+_[0-9A-F]{8}' | sed -E 's/.*_([0-9A-F]{8})$/0x\1/' >> "$game/extra.txt"
    continue
  fi
  hash=$(grep -oE "0x[0-9a-f]{16}" "$RUNNER/include/adapt_game.h" | head -1 | cut -c3-)
  rm -rf "$game/page" && mkdir -p "$game/page" && B="$RUNNER/build-web"
  cp $B/SuperMario64Recompiled.{js,wasm,data} $B/coi_serviceworker.js "$game/page/" && cp -L "$game/rom.z64" "$game/page/rom.z64"
  python3 - "$game/page" "$hash" "$HERE/../hub/hub_rom.js" "$B/SuperMario64Recompiled.html" <<'E'
import json, sys
page, h, hub, html = sys.argv[1:5]
open(f"{page}/index.html", "w").write(open(html).read().replace("</body>", f"<script>{open(hub).read()}</script></body>", 1))
json.dump({"rom": "rom.z64", "dest": f".config/N64Adaptive/adapt.{h}.z64"}, open(f"{page}/hub-rom.json", "w"))
E
  (CLICK=640,409 timeout 400 node "$HERE/probe.mjs" "$game/page" index.html ${PLAY_SECONDS:-150} "$game/shot-$i.png" > "$game/run-$i.log" 2>&1)
  new=$(grep -oE "Failed to find function at 0x[0-9A-Fa-f]+" "$game/run-$i.log" | awk '{print $NF}' | sort -u)
  dm=$(grep -aoE "adapt-dma 0x[0-9A-F]+ 0x[0-9A-F]+ 0x[0-9A-F]+" "$game/run-$i.log" | cut -d' ' -f2- | sort -u)
  # só interessam DMAs de código (pelo menos 3 "jr ra" no trecho da ROM): os de dados (milhares) não mudam o mapa
  dm=$(echo "$dm" | python3 -c "
import sys
rom = open(sys.argv[1], 'rb').read()
for l in sys.stdin:
    p = l.split()
    if len(p) == 3:
        r, n = int(p[0], 16), int(p[2], 16)
        if rom[r:r + n].count(bytes.fromhex('03e00008')) >= 3:
            print(l.strip())" "$game/rom.z64")
  newdm=$(comm -13 <(sort -u "$game/dmas.txt" 2>/dev/null) <(echo "$dm" | sed '/^$/d'))
  [ -n "$newdm" ] && echo "$newdm" >> "$game/dmas.txt"
  uc=$(grep -oE "adapt-ucode .*" "$game/run-$i.log" | sed -E 's/.*size=(0x[0-9A-F]+) hash=([0-9a-f]+) head=([0-9a-f]+).*/\2 \1 \3/' | sort -u)
  if [ -z "$new" ] && [ -z "$uc" ] && [ -z "$newdm" ]; then echo "nada novo na volta $i"; break; fi
  [ -n "$newdm" ] && echo "dmas novos: $(echo "$newdm" | wc -l)"
  [ -n "$new" ] && echo "$new" | tee -a "$game/extra.txt"
  [ -n "$uc" ] && echo "$uc" | tee -a "$game/ucodes.txt"
done
