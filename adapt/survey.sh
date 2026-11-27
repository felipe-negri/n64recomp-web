#!/usr/bin/env bash
# roda o gen_syms em cada ROM com código sem compressão e mede quantas funções-chave da libultra foram reconhecidas
A=/mnt/jogos/n64-web/adapt
KEY="osCreateThread osStartThread osRecvMesg osSendMesg osSetEventMesg osCreateMesgQueue osViSwapBuffer osContInit osSpTaskLoad osSpTaskStartGo osViSetMode osCreateViManager osCreatePiManager"
one() {
  f="$1"; d="$A/survey/$(echo "$f" | tr -cd 'A-Za-z0-9')"
  mkdir -p "$d"
  if "$A/.venv/bin/python" ~/projetos/n64recomp-web/adapt/gen_syms.py "/mnt/void/games/roms/n64/$f" "$d" "$A/n64sym/src/builtin_signatures.sig" "$A/runner/lib/N64ModernRuntime" > "$d/gen.log" 2>&1; then
    n=0; for k in $KEY; do grep -q "name = \"$k\"" "$d/syms.toml" && n=$((n+1)); done
    echo -e "$n\t$f"
  else echo -e "ERR\t$f"; fi
}
export -f one; export A KEY
awk -F'\t' '$1>=300 && $2>=0.95*$1 {print $3}' $A/code_scan.txt | xargs -d '\n' -P 6 -I{} bash -c 'one "$@"' _ {} > $A/survey.txt
