#!/usr/bin/env bash
# Item 6c's check (docs/new-recomp.md), on a recomp's released Windows archive as a player runs it: does the sound keep
# pace on the real sound device, no buffer cut down by queue_samples' catch-up past 100 ms queued and the queue never
# dry? The archive is unpacked into a new folder with the ROM stored there as Load ROM stores it (tools/boot_release.sh
# does the same), its SDL2.dll swapped for tools/sdl_queue_log.c's, which logs each buffer queued with what was queued
# before it and queues it as silence, and the program played by a plan of tools/capture_window.ps1 (keys into a level,
# shots to show it got there) with --boot. Needs Git Bash on Windows with clang-cl, lld-link, llvm-readobj and MSVC's
# libraries on PATH, INCLUDE and LIB, as a recomp's own build does (rush-2049-recomp's tools/env.sh sets them).
#
#   tools/sound_pace.sh <archive> <rom> <game id> <dir> <plan> [program args...]
#   tools/sound_pace.sh read <log> [from s]
#
# <dir> is emptied and gets the folder, queue.log, the window's stdout.log, stderr.log and the plan's shots. The game
# runs muted, so it can play on a shared desktop. `read` (run at the end of a play too) counts, from <from s> (15, past
# a boot's first loads) on: buffers queued with 100 ms or more queued before them (the catch-up drops every other
# sample of those, or more: a click with no gap, which 6b's disk-driver recording misses), and buffers queued onto an
# empty queue (dry: SDL's disk driver plays slower than real time, so only the device shows these). It prints the
# queue's milliseconds (least, median, most), the longest wait between two buffers (a stall that a dry queue follows)
# and the first times of each. 6c passes with 0 cut and 0 dry through a minute of the game's menus and a level.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

read_log() {
    awk -v from="${2:-15}" '
        /^# open/ { freq = $3; bpf = $4 * int($5 % 256 / 8); next }
        /^#/ { next }
        {
            if (!bpf) { print "no \"# open\" line: the log is not sdl_queue_log.c'"'"'s"; bad = 1; exit 1 }
            t = $1 / 1e6; ms = int($3 / bpf) * 1000 / freq
            if (n_all++ && t - last > gap && last >= from) { gap = t - last; gap_at = last }
            last = t
            if (t < from) next
            q[n++] = ms
            if (int(int($3 / bpf) * 1000000 / freq) >= 100000) { if (cut++ < 8) cut_at = cut_at sprintf(" %.1f", t) }
            if ($3 == 0) { if (dry++ < 8) dry_at = dry_at sprintf(" %.1f", t) }
        }
        END {
            if (bad) exit 1
            if (!n) { print "no buffer queued after " from " s"; exit 1 }
            asort(q)
            printf "%d buffers from %d s to %.0f s: %d cut by the catch-up, %d onto a dry queue\n", n, from, last, cut, dry
            printf "queued %.1f / %.1f / %.1f ms (least / median / most); longest wait between buffers %.0f ms, at %.1f s\n",
                q[1], q[int((n + 1) / 2)], q[n], gap * 1000, gap_at
            if (cut) print "cut at" cut_at (cut > 8 ? " ..." : "") " s"
            if (dry) print "dry at" dry_at (dry > 8 ? " ..." : "") " s"
            exit (cut || dry) ? 2 : 0
        }' "$1"
}

if [ "${1:-}" = read ]; then
    [ $# -ge 2 ] || { echo "usage: tools/sound_pace.sh read <log> [from s]" >&2; exit 1; }
    read_log "$2" "${3:-15}"
    exit
fi
[ $# -ge 5 ] || { echo "usage: tools/sound_pace.sh <archive> <rom> <game id> <dir> <plan> [program args...]" >&2; exit 1; }
archive=$1 rom=$2 game_id=$3 dir=$4 plan=$5
shift 5
for f in "$archive" "$rom" "$plan"; do [ -f "$f" ] || { echo "no $f" >&2; exit 1; }; done
plan=$(cd "$(dirname "$plan")" && pwd)/$(basename "$plan")

rm -rf "$dir"
mkdir -p "$dir/run" "$dir/shim"
dir=$(cd "$dir" && pwd)
unzip -q "$archive" -d "$dir/run"
folder=$(ls "$dir/run")
[ "$(echo "$folder" | wc -l)" = 1 ] || { echo "$archive holds more than one folder" >&2; exit 1; }
run=$dir/run/$folder
[ -f "$run/SDL2.dll" ] || { echo "$archive has no SDL2.dll beside its program" >&2; exit 1; }
touch "$run/portable.txt"
cp "$rom" "$run/$game_id.z64"

# The stand-in exports what SDL2.dll does: its own two functions, every other one forwarded to the real DLL.
mv "$run/SDL2.dll" "$run/SDL2_real.dll"
{
    echo "LIBRARY SDL2"
    echo "EXPORTS"
    llvm-readobj --coff-exports "$run/SDL2_real.dll" | sed -n 's/^ *Name: //p' |
        grep -vx 'SDL_QueueAudio\|SDL_OpenAudioDevice' | sed 's/.*/    &=SDL2_real.&/'
} > "$dir/shim/SDL2.def"
(cd "$dir/shim" && clang-cl -nologo -O2 -MT -LD "$(cygpath -w "$here/sdl_queue_log.c")" -Fe:SDL2.dll \
    -link -def:SDL2.def > build.log 2>&1) || { cat "$dir/shim/build.log"; exit 1; }
cp "$dir/shim/SDL2.dll" "$run/SDL2.dll"

exe=$(ls "$run" | grep '\.exe$')
args="--boot"
for a in "$@"; do args+=" \"$a\""; done
pwsh -NoProfile -File "$(cygpath -w "$here/capture_window.ps1")" -Exe "$(cygpath -w "$run/$exe")" \
    -WorkDir "$(cygpath -w "$run")" -Plan "$(cygpath -w "$plan")" -OutDir "$(cygpath -w "$dir")" \
    -ExeArgs "$args" -Env "SDL_QUEUE_LOG=$(cygpath -w "$dir/queue.log")" | tee "$dir/capture.log"
grep -E '^Crash:|^--boot: no valid stored ROM' "$dir/stderr.log" && { echo "the program failed"; exit 1; }
read_log "$dir/queue.log" 15
