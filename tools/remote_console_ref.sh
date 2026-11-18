#!/usr/bin/env bash
# The console's picture of a plan (tools/console_ref.mjs: the game's ROM in mupen64plus-next with Angrylion) made on a
# Linux host over ssh ($DUMP_HOST), for tools/console_check.mjs to hold a recomp's frame dump against there. Like
# tools/remote_frame_dump.sh, whose dumps it sits beside: the frames stay on the host, in $FRAME_DUMP_DIR/<out dir's
# name>/out, and only log.txt, watch.tsv, the plan's shots and console_check's output and saved frames come back.
# --against <dump> is the out dir's name of a tools/remote_frame_dump.sh run of the same plan made with --keep and
# --watch, whose dump (its main run's) tools/console_check.mjs then holds against the console's there.
#
#   DUMP_HOST=<host> tools/remote_console_ref.sh <rom> <plan> <out dir> [--against <dump>] [tools/console_ref.mjs options:
#       --seconds 10-70 --watch 0x800B67F0 --game-id <id> --check "<console_check args>" --again]
#
# <rom> is a path on the host (relative to its home), <plan> a plan of tools/capture_window.ps1's here. It runs in the
# image of tools/console_ref.Dockerfile, tagged with a hash of that file and built on the host the first time, in a
# container named console-ref-<out dir's name> (`docker stop` that name to end one), as the host's own user, with
# $CONSOLE_REF_CPUS of its cores (8: Angrylion draws on all it gets) and $FRAME_DUMP_MEMORY of its memory (2g). The core
# is built once into $CONSOLE_REF_CACHE on the host (console-ref-cache). A queue: as remote_frame_dump.sh
# ($FRAME_DUMP_QUEUE_CLIENT, $GPU_QUEUE_KEY on ssh's stdin, $FRAME_DUMP_NETWORK, $FRAME_DUMP_JOB_URL). Its exit code is
# console_ref.mjs's.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[[ $# -ge 3 ]] || { sed -n '9,10p' "$0" >&2; exit 3; }
rom=$1 plan=$2 out=$3
shift 3
against=() mount=() again=""
for a in "$@"; do [[ "$a" == --again ]] && again=1; done
if [[ "${1:-}" == --against ]]; then
    mount=(-v "\$HOME/${FRAME_DUMP_DIR:-frame-dumps}/$2/out/main:/recomp:ro")
    against=(--against /recomp/dump)
    shift 2
fi
host="${DUMP_HOST:?set DUMP_HOST to the host to run on}"
[[ -f "$plan" ]] || { echo "no plan $plan" >&2; exit 3; }
mkdir -p "$out"
out="$(cd "$out" && pwd)"
name="$(basename "$out")"
dir="${FRAME_DUMP_DIR:-frame-dumps}/$name"
cache="${CONSOLE_REF_CACHE:-$(dirname "${FRAME_DUMP_DIR:-frame-dumps}")/console-ref-cache}"
image="console-ref:$(git hash-object "$here/console_ref.Dockerfile" | cut -c1-12)"
remote() { ssh -o BatchMode=yes "$host" "$@"; }

remote "docker image inspect $image >/dev/null 2>&1 || docker build -q -t $image - >/dev/null" \
    < "$here/console_ref.Dockerfile"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp "$here/console_ref.mjs" "$here/console_ref.c" "$here/console_check.mjs" "$stage/"
cp "$plan" "$stage/plan.txt"
# --replay's file (a recomp's watch.tsv here) goes with the plan, and the container reads it there.
args=()
while [[ $# -gt 0 ]]; do
    if [[ "$1" == --replay ]]; then cp "$2" "$stage/replay.tsv"; args+=(--replay /work/replay.tsv); shift 2
    else args+=("$1"); shift; fi
done
set -- "${args[@]}"
queue=()
if [[ -n "${FRAME_DUMP_QUEUE_CLIENT:-}" ]]; then
    cp "$FRAME_DUMP_QUEUE_CLIENT" "$stage/queue.mjs"
    queue=(--queue /work/queue.mjs)
    [[ -n "${FRAME_DUMP_JOB_URL:-}" ]] && queue+=(--url "$FRAME_DUMP_JOB_URL")
fi
remote "mkdir -p $dir $cache" && [[ -n "$again" ]] || remote "rm -rf $dir/out"
tar -C "$stage" -cf - . | remote "tar -C $dir -xf -"

q() { printf '%q ' "$@"; }
run=(docker run --rm --name "console-ref-$name" --cpus "${CONSOLE_REF_CPUS:-8}" --memory "${FRAME_DUMP_MEMORY:-2g}"
    -e HOME=/tmp)
[[ -n "${FRAME_DUMP_NETWORK:-}" ]] && run+=(--network "$FRAME_DUMP_NETWORK")
[[ -n "${GPU_QUEUE_URL:-}" ]] && run+=(-e "GPU_QUEUE_URL=$GPU_QUEUE_URL")
cmd=(node /work/console_ref.mjs --rom /rom.z64 --plan /work/plan.txt --out /work/out --cache /cache "${queue[@]}" "${against[@]}")
stopped() { remote "docker stop console-ref-$name >/dev/null 2>&1" || true; exit 75; }
trap 'rm -rf "$stage"; stopped' INT TERM
set +e
printf %s "${GPU_QUEUE_KEY:-}" | remote "cd ~ && GPU_QUEUE_KEY=\$(cat) && export GPU_QUEUE_KEY && \
    $(q "${run[@]}") --user \$(id -u):\$(id -g) -e GPU_QUEUE_KEY -v \$HOME/$dir:/work -v \$HOME/$cache:/cache ${mount[*]} \
    -v \"\$(realpath $(q "$rom"))\":/rom.z64:ro $image $(q "${cmd[@]}" "$@")"
code=$?
set -e
trap 'rm -rf "$stage"' EXIT
trap - INT TERM
remote "tar -C $dir/out -cf - --exclude=./frames.bin --exclude=./Mupen64plus ." 2>/dev/null | tar -C "$out" -xf - \
    || echo "nothing came back from $host:$dir/out" >&2
echo "results in $out, frames in $host:$dir/out (exit $code)"
exit $code
