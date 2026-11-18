#!/usr/bin/env bash
# Dumps a recomp's frames by a plan and checks them with tools/frame_check.mjs on a Linux host with an NVIDIA GPU over
# ssh ($DUMP_HOST, a host name ssh knows), in one command, and brings back only the results: the check made on that
# host's GPU and CPU, not on the machine you run this from. A dump is ~20 MB a second, too much to bring back over a
# slow link, so the dumps are made, checked and deleted there.
#
#   DUMP_HOST=<host> tools/remote_frame_dump.sh [-c <config dir>] <game dir> <exe> <game id> <rom> <plan> <out dir>
#       [tools/frame_dump.mjs options: --window 1280x720,960x720,2560x720 --seconds 10-70 --args "..." --check "..."]
#
# <game dir> and <rom> are paths on the host (relative to its home): the recomp's Linux build, its release archive
# unpacked or a build folder with assets/, and its ROM. <exe> is the program in <game dir>, <game id> the name its
# runtime stores the ROM under (its game_id). <plan> is a plan of tools/capture_window.ps1's here, and <out dir> a
# folder here that gets frame_check.txt (the check's output, also printed), each run's stdout.log, stderr.log and the
# plan's shots, and flagged/ (frame_check's --save). -c sends a folder of settings files (graphics.json, general.json)
# for every run. tools/frame_dump.mjs's header says what a run does and what the options mean; its exit code is this
# one's (0 passes, 1 fails, 2 nothing to test, 3 a run failed, 75 stopped by the queue).
#
# It runs in the image of tools/frame_dump.Dockerfile, tagged with a hash of that file and built on the host the first
# time a run needs it, in a container named frame-dump-<out dir's name> (`docker stop` that name to end one), as the
# host's own user, with the host's GPUs, $FRAME_DUMP_CPUS of its cores (8: a run draws on 2-3, frame_check takes
# the rest) and $FRAME_DUMP_MEMORY of its memory (2g: a game's dumps held 0.3-0.6 GB, frame_check 0.6), which is also
# the host memory each of its jobs asks the queue for, so several fit beside each other. Its files are in $FRAME_DUMP_DIR/<out dir's name> under the host's home
# (frame-dumps), deleted when it ends unless --keep is given (which keeps the dumps too, for another check there).
#
# A host whose GPU is shared through a queue: FRAME_DUMP_QUEUE_CLIENT names a JavaScript module here that exports
# gpuRun(spec, run), sent with the run, and the dumps then wait for a turn as one job and frame_check as another
# (tools/frame_dump.mjs's --queue), at low priority unless --priority says otherwise. The queue's key is
# $GPU_QUEUE_KEY, sent on ssh's stdin, never on a command line; $GPU_QUEUE_URL is passed on if set,
# $FRAME_DUMP_NETWORK names the docker network the queue answers on, and $FRAME_DUMP_JOB_URL is each job's link.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
config=""
while [[ $# -gt 0 ]]; do
    case "$1" in
    -c) config="$(cd "$2" && pwd)"; shift 2 ;;
    *) break ;;
    esac
done
[[ $# -ge 6 ]] || { sed -n '6,8p' "$0" >&2; exit 3; }
game=$1 exe=$2 game_id=$3 rom=$4 plan=$5 out=$6
shift 6
host="${DUMP_HOST:?set DUMP_HOST to the host to dump on}"
[[ -f "$plan" ]] || { echo "no plan $plan" >&2; exit 3; }
mkdir -p "$out"
out="$(cd "$out" && pwd)"
name="$(basename "$out")"
dir="${FRAME_DUMP_DIR:-frame-dumps}/$name"
image="frame-dump:$(git hash-object "$here/frame_dump.Dockerfile" | cut -c1-12)"
keep=""
for a in "$@"; do [[ "$a" == --keep ]] && keep=1; done
remote() { ssh -o BatchMode=yes "$host" "$@"; }

remote "docker image inspect $image >/dev/null 2>&1 || docker build -q -t $image - >/dev/null" \
    < "$here/frame_dump.Dockerfile"

# What the container reads, in one tar: the two scripts, the plan, the settings, the queue's client.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp "$here/frame_dump.mjs" "$here/frame_check.mjs" "$here/sound_check.mjs" "$here/sdl_audio_record.c" "$stage/"
cp "$plan" "$stage/plan.txt"
mkdir -p "$stage/config-in"
[[ -n "$config" ]] && cp -r "$config/." "$stage/config-in/"
queue=()
if [[ -n "${FRAME_DUMP_QUEUE_CLIENT:-}" ]]; then
    cp "$FRAME_DUMP_QUEUE_CLIENT" "$stage/queue.mjs"
    queue=(--queue /work/queue.mjs)
    [[ -n "${FRAME_DUMP_JOB_URL:-}" ]] && queue+=(--url "$FRAME_DUMP_JOB_URL")
fi
remote "rm -rf $dir && mkdir -p $dir/home"
tar -C "$stage" -cf - . | remote "tar -C $dir -xf -"

# The command the host runs, each argument quoted for its shell.
q() { printf '%q ' "$@"; }
cpus="${FRAME_DUMP_CPUS:-8}"
run=(docker run --rm --name "frame-dump-$name" --gpus all --cpus "$cpus" --memory "${FRAME_DUMP_MEMORY:-2g}" --shm-size 1g -e HOME=/work/home)
[[ -n "${FRAME_DUMP_NETWORK:-}" ]] && run+=(--network "$FRAME_DUMP_NETWORK")
[[ -n "${GPU_QUEUE_URL:-}" ]] && run+=(-e "GPU_QUEUE_URL=$GPU_QUEUE_URL")
cmd=(node /work/frame_dump.mjs --game /game --exe "$exe" --game-id "$game_id" --rom /rom.z64 --plan /work/plan.txt
    --out /work/out --workers "$cpus" "${queue[@]}")
[[ -n "$config" ]] && cmd+=(--config /work/config-in)
stopped() { remote "docker stop frame-dump-$name >/dev/null 2>&1" || true; exit 75; }
trap 'rm -rf "$stage"; stopped' INT TERM
set +e
printf %s "${GPU_QUEUE_KEY:-}" | remote "cd ~ && GPU_QUEUE_KEY=\$(cat) && export GPU_QUEUE_KEY && \
    $(q "${run[@]}") --user \$(id -u):\$(id -g) -e GPU_QUEUE_KEY -v \$HOME/$dir:/work \
    -v \"\$(realpath $(q "$game"))\":/game:ro -v \"\$(realpath $(q "$rom"))\":/rom.z64:ro $image $(q "${cmd[@]}" "$@")"
code=$?
set -e
trap 'rm -rf "$stage"' EXIT
trap - INT TERM

# Everything but the dumps and the runs' copies of the game comes back.
remote "tar -C $dir/out -cf - --exclude=./*/dump --exclude=./*/run --exclude=./config ." 2>/dev/null | tar -C "$out" -xf - \
    || echo "nothing came back from $host:$dir/out" >&2
[[ -n "$keep" ]] || remote "rm -rf $dir"
echo "results in $out (exit $code)"
exit $code
