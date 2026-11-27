#!/usr/bin/env bash
# uma volta do discover em cada jogo; registra brilho do print final e a última pilha
A=/mnt/jogos/n64-web/adapt
while IFS= read -r f; do
  d="$A/try/$(echo "$f" | tr -cd 'A-Za-z0-9')"; mkdir -p "$d"
  PLAY_SECONDS=90 ADAPT_TRACE=1 ~/projetos/n64recomp-web/adapt/discover.sh "/mnt/void/games/roms/n64/$f" "$d" 2 > "$d/discover.log" 2>&1
  last=$(ls -t "$d"/run-*.log 2>/dev/null | head -1)
  shot="${last%.log}.png"; shot="${shot/run-/shot-}"
  b=$(python3 -c "
from PIL import Image; import sys
try:
  im=Image.open(sys.argv[1]).convert('L'); print(im.getextrema()[1])
except Exception as e: print('sem-print')" "$shot")
  w=$(grep -a "adapt-where" "$last" 2>/dev/null | tail -2 | tr '\n' ' ' | cut -c1-300)
  echo -e "$b\t$f\t$w" >> $A/try.txt
done < "$1"
