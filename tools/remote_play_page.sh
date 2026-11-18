#!/usr/bin/env bash
# Plays a page (tools/play_page.mjs) or records its shaders (tools/record_shaders.mjs) on a Linux host with an NVIDIA
# GPU over ssh ($PLAY_HOST, a host name ssh knows), in Chrome or Firefox in a container there, in one command, and
# brings back only what the play wrote: its output (printed as it comes), the files it was told to write, and the lines
# it recorded. The page is a build on that host (a game's page built there) or a URL (GitHub Pages).
#
#   PLAY_HOST=<host> tools/remote_play_page.sh [--measure] [--model <game>] <out dir> <play_page.mjs | record_shaders.mjs> <its args...>
#
# The tool's arguments are its own (each one's header), with four kinds rewritten for the host:
#   host:<path>   a file or folder on the host, relative to its home (a build dir, a ROM), given to the tool read-only
#   out:<name>    a file the tool writes (--json, --shot, record_shaders' list), which comes back as <out dir>/<name>;
#                 one already there is sent first, so record_shaders' --add records into it
#   --record <f>  a local file of runs (plays.jsonl): sent, so the tool compares the run with the earlier ones, and the
#                 lines the run adds are appended to the local file
#   a local file  sent as it is (a plan, a --preload script), a plan with the files its evalFile steps name
# Anything else (a URL, a number, a flag) goes as it is. For example, a smoke play of a page built there:
#
#   tools/remote_play_page.sh --model mg out/mg-smoke play_page.mjs chrome host:pages/mg/build-web host:roms/mg.z64 \
#       ../mario-golf-recomp/play_plan.json --shot out:end.png --record plays.jsonl --game mg --build "main 1a2b3c4"
#
# It runs in the image of tools/page_play.Dockerfile, tagged with a hash of that file and the week and built on the host
# the first time a run needs it, in a container named page-play-<out dir's name> (`docker stop` that name to end one),
# as the host's own user, with the host's GPUs, capped at $PLAY_CPUS cores (8) and $PLAY_MEMORY of memory (16g). Its
# files are in $PLAY_DIR/<out dir's name> under the host's home (page-plays), deleted when it ends. tools/play_job.mjs
# starts the browsers' display and sound there and runs the tool.
#
# A host whose GPU is shared through a queue: PLAY_QUEUE_CLIENT names a JavaScript module here that exports
# gpuRun(spec, run), sent with the run, and the play waits for a turn as one job of it (play_job.mjs's header says what
# each asks): one that checks beside other jobs, or with --measure one that has the GPU to itself, for a play whose
# numbers are the result. --model is the game's name, which the queue sizes the job by (the tool's --game when it has
# one). The queue's key is $GPU_QUEUE_KEY, sent on ssh's stdin, never on a command line; $GPU_QUEUE_URL is passed on if
# set, $PLAY_NETWORK names the docker network the queue answers on, $PLAY_JOB_URL is the job's link, and
# $PLAY_PRIORITY its priority (low). The exit code is the tool's (play_page.mjs's header), 75 when the queue stopped
# it, 3 for a mistake in the arguments.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
measure="" model=""
while [[ $# -gt 0 ]]; do
    case "$1" in
    --measure) measure=1; shift ;;
    --model) model="$2"; shift 2 ;;
    *) break ;;
    esac
done
[[ $# -ge 2 ]] || { sed -n '6,7p' "$0" >&2; exit 3; }
out=$1 tool=$2
shift 2
case "$tool" in play_page.mjs|record_shaders.mjs) ;; *) echo "the tool is play_page.mjs or record_shaders.mjs, not $tool" >&2; exit 3 ;; esac
host="${PLAY_HOST:?set PLAY_HOST to the host to play on}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
name="$(basename "$out")"
dir="${PLAY_DIR:-page-plays}/$name"
image="page-play:$(git hash-object "$here/page_play.Dockerfile" | cut -c1-12)-$(date -u +%G%V)"
remote() { ssh -o BatchMode=yes "$host" "$@"; }

# What the container reads, in one tar: the tools, the inputs, the out dir as it is, the queue's client.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/tools" "$stage/in" "$stage/out" "$stage/home"
cp "$here"/*.mjs "$here"/*.js "$stage/tools/"
cp -r "$out/." "$stage/out/"
mounts=() targs=() record="" record_lines=0 n=0
prev=""
for a in "$@"; do
    n=$((n + 1))
    if [[ "$prev" == --record ]]; then
        record="$a"
        [[ -f "$record" ]] && cp "$record" "$stage/in/record.jsonl" || : > "$stage/in/record.jsonl"
        record_lines=$(wc -l < "$stage/in/record.jsonl")
        targs+=(/work/in/record.jsonl)
    elif [[ "$a" == host:* ]]; then
        mounts+=(-v "\$HOME/${a#host:}:/host/$n:ro")
        targs+=("/host/$n")
    elif [[ "$a" == out:* ]]; then
        targs+=("/work/out/${a#out:}")
    elif [[ -f "$a" ]]; then
        mkdir -p "$stage/in/$n"
        cp "$a" "$stage/in/$n/"
        # A plan's evalFile steps name files relative to it: they go beside it as it names them.
        if [[ "$a" == *.json ]]; then
            node -e '
                const fs = require("fs"), path = require("path");
                const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
                const steps = [plan.load, plan.setup, plan.start, plan.play, ...(plan.sections || []).map((s) => s.steps)];
                for (const s of [].concat(...steps.filter(Boolean))) if (Array.isArray(s) && s[0] === "evalFile") console.log(s[1]);
            ' "$a" | tr -d '\r' | while IFS= read -r f; do
                [[ "$f" != /* && "$f" != *..* ]] || { echo "an evalFile step names $f, outside its plan's folder" >&2; exit 3; }
                mkdir -p "$stage/in/$n/$(dirname "$f")"
                cp "$(dirname "$a")/$f" "$stage/in/$n/$f"
            done
        fi
        targs+=("/work/in/$n/$(basename "$a")")
    else
        targs+=("$a")
    fi
    prev="$a"
done
if [[ -z "$model" ]]; then
    for ((i = 0; i < ${#targs[@]} - 1; i++)); do [[ "${targs[i]}" == --game ]] && model="${targs[i + 1]}"; done
fi
job=()
if [[ -n "${PLAY_QUEUE_CLIENT:-}" ]]; then
    [[ -n "$model" ]] || { echo "--model <game> (or the tool's --game) is needed to take a turn in the queue" >&2; exit 3; }
    cp "$PLAY_QUEUE_CLIENT" "$stage/queue.mjs"
    job=(--queue /work/queue.mjs --model "$model" --priority "${PLAY_PRIORITY:-low}")
    [[ -n "${PLAY_JOB_URL:-}" ]] && job+=(--url "$PLAY_JOB_URL")
    [[ -n "$measure" ]] && job+=(--measure)
fi

# The image, built once a week (or for a change to its Dockerfile) by whichever run first needs it, the older ones
# removed (one still in use stays).
remote "flock /tmp/page-play-image.lock sh -c 'docker image inspect $image >/dev/null 2>&1 || \
    { docker build -q -t $image - >/dev/null && docker image ls page-play --format {{.Repository}}:{{.Tag}} | \
      grep -vx $image | xargs -r docker rmi >/dev/null 2>&1; true; }'" < "$here/page_play.Dockerfile"
remote "rm -rf $dir && mkdir -p $dir"
tar -C "$stage" -cf - . | remote "tar -C $dir -xf -"

q() { printf '%q ' "$@"; }
run=(docker run --rm --name "page-play-$name" --gpus all --cpus "${PLAY_CPUS:-8}" --memory "${PLAY_MEMORY:-16g}"
    --shm-size 2g -e HOME=/work/home -w /work/out)
[[ -n "${PLAY_NETWORK:-}" ]] && run+=(--network "$PLAY_NETWORK")
[[ -n "${GPU_QUEUE_URL:-}" ]] && run+=(-e "GPU_QUEUE_URL=$GPU_QUEUE_URL")
cmd=(node /work/tools/play_job.mjs "${job[@]}" -- node "/work/tools/$tool" "${targs[@]}")
stopped() { remote "docker stop page-play-$name >/dev/null 2>&1" || true; exit 75; }
trap 'rm -rf "$stage"; stopped' INT TERM
set +e
printf %s "${GPU_QUEUE_KEY:-}" | remote "cd ~ && GPU_QUEUE_KEY=\$(cat) && export GPU_QUEUE_KEY && \
    $(q "${run[@]}") --user \$(id -u):\$(id -g) -e GPU_QUEUE_KEY -v \$HOME/$dir:/work ${mounts[*]} $image $(q "${cmd[@]}")"
code=$?
set -e
trap 'rm -rf "$stage"' EXIT
trap - INT TERM

# What the play wrote, and the runs it recorded.
remote "tar -C $dir/out -cf - ." 2>/dev/null | tar -C "$out" -xf - || echo "nothing came back from $host:$dir/out" >&2
if [[ -n "$record" ]]; then
    remote "tail -n +$((record_lines + 1)) $dir/in/record.jsonl" >> "$record" || echo "no runs came back from $host" >&2
fi
remote "rm -rf $dir"
echo "results in $out (exit $code)"
exit $code
