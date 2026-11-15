#!/usr/bin/env bash
# Says whether a game's row in docs/new-recomp.md lets it be released: the checklists gate a game's first release
# (CLAUDE.md, Rules). A game is released, its desktop build's first GitHub release and its page's first publish to the
# hub, only once each item in its row has been played and passes, or fails with its fix filed (the row marks it
# "fails"). tools/publish_pages.sh asks it before a game's first publish and tools/boot_release.sh before the first
# release of a recomp of the project's own; a released game's later releases and publishes aren't held by an item added
# after (its backcheck is filed work, docs/new-recomp.md, Keeping them).
#
#   tools/checklist.sh <game> [--main]           <game> as its row and the README's Games table name it
#   tools/checklist.sh --repo <owner/name> [--main]   the game whose README Games row links that repo
#
# It prints the row's labels that hold the release, one line, and exits 1 while there are any, 0 once there are none
# (2 for no such row). --main reads the README and docs/new-recomp.md from N64Recomp-browser's main on GitHub (gh
# signed in) rather than this checkout's: a recomp's lib/N64Recomp-browser is at its pin, whose rows are older than
# main's. A recomp not in the Games table yet (its row goes in with the port) is named by CHECKLIST_GAME.
#
# Not holding a first release, though still in Left until played:
# - 8a, 8c, W10 and W11: the release's own boots play 8a, and 8c, W10 (from Pages) and W11 need the page published.
#   The work that releases the game plays them right after and updates the row.
# - W6's Drive: a signed-in player's save reaching the Drive is played by hand, and no game has played it yet.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
game="" repo="" main=false
while [ $# -gt 0 ]; do
    case "$1" in
    --repo) repo=$2; shift 2 ;;
    --main) main=true; shift ;;
    -*) echo "usage: tools/checklist.sh <game> | --repo <owner/name> [--main]" >&2; exit 2 ;;
    *) game=$1; shift ;;
    esac
done
[ -n "$game$repo" ] || { echo "usage: tools/checklist.sh <game> | --repo <owner/name> [--main]" >&2; exit 2; }
# Each doc is read whole before awk looks at it: awk exits at its row, and piped from gh that left gh writing to a
# closed pipe, so under pipefail the script died of SIGPIPE (141) wherever gh was still writing, on one host and not
# another.
read_doc() {
    if $main; then gh api "repos/n64hub/N64Recomp-browser/contents/$1" -H "Accept: application/vnd.github.raw"
    else cat "$here/../$1"; fi | tr -d '\r'
}
if [ -z "$game" ]; then
    readme=$(read_doc README.md)
    game=$(awk -F'|' -v r="https://github.com/$repo)" '
        /^\| / && index($4, r) { gsub(/^ +| +$/, "", $2); print $2; exit }' <<< "$readme")
    game=${game:-${CHECKLIST_GAME:-}}
    [ -n "$game" ] || { echo "no Games row in the README links $repo: set CHECKLIST_GAME to its game's row name" >&2; exit 2; }
fi
doc=$(read_doc docs/new-recomp.md)
row=$(awk -F'|' -v g="$game" '
    /^\| / && NF == 5 { t = $2; gsub(/^ +| +$/, "", t); if (t == g) { print $3 "|" $4; exit } }' <<< "$doc")
[ -n "$row" ] || { echo "$game has no row in docs/new-recomp.md (Where each game stands)" >&2; exit 2; }
after=" 8a 8c W10 W11 W6's Drive "
left=()
IFS=',|' read -ra labels <<< "$row"
for l in "${labels[@]}"; do
    l=$(echo "$l" | sed 's/^ *//; s/ *$//')
    [ -n "$l" ] || continue
    case "$l" in *" fails") continue ;; esac
    [[ $after == *" $l "* ]] && continue
    left+=("$l")
done
if [ ${#left[@]} -eq 0 ]; then
    echo "$game: its row lets it be released (only fails with their fixes filed, or what the release plays)"
else
    echo "$game: not played yet, so not released: ${left[*]}"
    exit 1
fi
