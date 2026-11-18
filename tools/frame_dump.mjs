// Dumps a recomp's frames by a plan on Linux and checks them, in the container of tools/frame_dump.Dockerfile, which
// tools/remote_frame_dump.sh starts on a Linux host with an NVIDIA GPU: the dumps and
// tools/frame_check.mjs on them, made on that host's GPU and CPU instead of the machine a person or an agent works on.
// A dump is ~20 MB a second of frames, too much to bring back over a slow link, so only the check's text, the
// program's logs, the plan's steps and shots and frame_check's flagged frames stay; the dumps are deleted unless --keep.
//
//   node tools/frame_dump.mjs --game <dir> --exe <name> --game-id <id> --rom <file> --plan <file> --out <dir>
//       [--window <w>x<h>[,<w>x<h>,<w>x<h>]] [--rate <hz>] [--seconds <from>-<to>] [--args "<program args>"]
//       [--env K=V,...] [--config <dir>] [--check "<frame_check args>"] [--workers <n>] [--keep]
//       [--reuse] [--queue <module>] [--vram <MiB>|auto] [--priority low] [--url <url>] [--sound-reference <dir>]
//       [--launcher] [--no-dump] [--slow]
//       [--restart]
//
// --game is the folder of a recomp's Linux build (its release archive unpacked, or its build folder with assets/),
// --exe the program in it, --game-id the name its runtime stores the ROM under (<game id>.z64, as Load ROM does). Each
// run copies --game into a folder of its own under --out with a portable.txt, so its settings and saves are the run's,
// stores the ROM, copies --config's files in (a graphics.json, a general.json) and starts the program with --boot,
// --window and --args, SDL's dummy sound driver, and RT64_FRAME_DUMP (and RT64_FRAME_DUMP_SECONDS from --seconds).
// Each run's sound is recorded too, by tools/sdl_audio_record.c (built with the image's cc and loaded with
// LD_PRELOAD), into <out>/<run>/sound.tsv and sound.raw, and each step of the plan's time into steps.tsv, and
// tools/sound_check.mjs checks the first run's after frame_check, against --sound-reference's if given (a run's folder
// of an earlier dump, by the same plan, of a build whose sound is right), its text in sound_check.txt. The recording
// stays (about 23 MB a minute) for a later check against another.
// RT64's refresh rate is set to Manual at --rate (60) in its graphics.json, made by a first start of the program
// when --config has none: Xvfb has no refresh rate of its own, and at Display the program presents only the game's own
// frames, which test nothing of the frames between. 60 is a 60 Hz display's, where a game of 30 shows each frame twice,
// once between, as on Windows, where the checks were measured; a game of 60 needs 120. A rate the presents can't keep
// up with doesn't slow the game: RT64 skips a present whose next one is already queued, so the dump keeps only some of
// the game's frames, each at its pace, and the checks read its motion 0.1-0.5 s apart. Mario Golf's at Manual 240 in a
// 1280x960 window, under Xvfb on an RTX 5090 a training job held, presented 31 a second (157 at 320x240), so 12 of the
// 25 presents a second its game queued and 3.3 of its own frames a second, each shown 7 times, came out, against 22 of
// 30 at Manual 60 and all 30 at Manual 30 (none between). What a present costs there goes with the window's size, not
// with what RT64 draws: at Original in the 1280x960 window (its targets 320x240) it presented 32.5 a second, so a large
// window falls behind at any rate with frames between. Each run's line says how fast its dump came: presents and the
// game's own frames a second, and the presents the game queued against those in the dump, and frame_check leaves a
// dump that lacks over a tenth of them untested (exit 2).
//
// --window gives each run's window: one size is one run, frame_check reading its dump alone; three are three runs of
// the plan, the first checked with the second as --narrower (a 4:3 window) and the third as --wider (32:9), the check
// of the frames between the game's and the sides asks for. Two are tools/seam_check.mjs's: the first at 4 times the
// console's resolution or more (1280x960) and the second at its own (320x240), the first checked for seams thinner
// than a console pixel that the second lacks (its header says how), and --check's arguments are seam_check's. With --window the plan's size steps are skipped. Without it each run is the plan's own size steps
// from a 1280x720 window.
//
// --restart checks that what a player sets is what the game runs, after a first launch and after a restart, in place
// of frame_check: the plan is played three times in one copy of the game, its first launch with only --config's files
// (none given: a new player's very first launch) and two more starts after it (restart, again), each reading what the
// one before it left, the window --window's first size. A first launch's settings must be the defaults in effect, not
// only on disk (librecomp writes them out without calling the options' change callbacks, so an option read only in
// its callback keeps its C++ starting value until the next launch), and a setting or a binding, once written, must
// read back the same at every start. It fails where the first launch's settings files don't hold --config's values,
// where a start changed a value in them, where the runs' dumps were drawn at another size or shown in another number
// of frames a game frame, and where two launches' shots of a still picture differ (restartCheck() says how much). So
// the plan's shots are of moments that hold still at the same game state in every launch (a race's countdown, reached
// by until steps), where an option a player sees shows: Rush 2049's countdown on its first track tells Draw Distance,
// Level of Detail and Scenery Culling at Original from their defaults. On v0.1.26, whose first launch ran them at
// Original, 7 of 18 launches drew so (3 of 6 first launches, and some starts after them too), and 5 of 6 checks failed;
// on v0.1.78, 2 of 15 launches (each a third start, whose files said the defaults), and 2 of 5 checks: the fault strikes at
// some starts and not others, so one pass says little and a game's check is played two or three times. It writes <out>/restart.txt, each run's shots and its settings files (<out>/<run>/settings), and
// passes RT64_FRAME_DUMP_RATE=--rate in place of graphics.json's Manual, which a first launch doesn't have yet. Exit 0
// passes, 1 fails, 3 a run failed.
//
// The plan is tools/capture_window.ps1's (its header has every step), its times in seconds since the program started:
// key, down, up, size, shot (a PNG of the window, <out>/<run>/<name>.png), until, poke, or, peek, dump, find and end
// do what they do there, keys through XTEST into the window and RDRAM through /proc/<pid>/mem (the runtime maps it as
// one 512 MB region, 0x80000000 at its first byte, each 32-bit word in the host's order). burst, record and stop are
// captures, which the dump replaces: they are skipped. drag, Windows' move loop, has no counterpart and fails the run.
// Two steps are this tool's own:
//   <s> clock <addr> <per second>  from here to the run's end, reads the game's 32-bit counter at addr every 100 ms
//                                  against real time, a counter that counts that many a second on a console (Mario
//                                  Golf's frame counter, 0x800B67F0, 30; Donald Duck's clock, 0x800C3D24, 60), and
//                                  tools/game_speed.mjs judges the game's speed from it: each run's speed.tsv has the
//                                  reads, the log what was judged. A game faster than its console fails the run (exit
//                                  1), and one slower too with --slow, for a host known to draw the game at its pace
//   <s> click <x> <y>              clicks at x, y in the window, through XTEST as a mouse does: with --launcher a plan
//                                  starts the game with a click on Start Game (Enter under the pointer doesn't, on X)
// --launcher starts the program without --boot, at its launcher, so a plan can wait there as a player who leaves it
// open does before Start Game (a game whose clock counted the launcher's time played its demos with no title).
// --no-dump plays the plan with RT64's frame dump off and no frame_check, for the clock and the answers alone (below):
// a dump writes every frame, which slows a large window's game below its pace. Its exit is then theirs: 0 passes, 1
// fails, 3 a run failed.
//
// --queue names a JavaScript module exporting gpuRun(spec, run) of a GPU queue the host's GPU work takes turns in: the
// runs then go as one job of type frame-dump and frame_check as a second, frame-check, asking no GPU memory (its
// work is the CPU's), both at --priority (low), linked to --url and naming --game-id as their model, so the queue sizes
// each game's jobs from that game's own runs: the dumps ask --vram MiB, or by default what the queue reads off them
// (1024 before it has any; Mario Golf's three windows held 662), so many runs fit on one GPU side by side. Each asks
// the host memory of the container's cap (its docker run's --memory, read from its cgroup; a game's dumps held
// 0.3-0.6 GB, frame_check 0.6), never the queue's 8 GiB for a game it hasn't measured. A stop the queue asks for ends
// the run in progress, and the tool, with 75. Without --queue it runs at once.
//
// --reuse checks the dumps a run before with --keep left in --out, and makes only those it lacks (a run that didn't
// finish leaves none): a change to frame_check is checked against dumps already made, a check's worth of CPU instead
// of a dump's turn on the GPU and minutes of play. With every dump there it files no frame-dump job, only frame-check.
// The plan, --window, --seconds, --rate and the build must be the ones the dumps were made with; the caller keys --out
// by them.
//
// --workers is frame_check's (a third of the cores it sees unless given), for a container held to fewer cores than
// the host has.
//
// Input, by a stand-in pad (tools/stand_in_pad.c, built here with gcc and preloaded into the program when a plan
// uses one): what a player's press, a stick and a pad pulled out do on a release as it was shipped, with no pad on the
// machine. The pad is plugged in as the program first polls SDL's events, and these steps drive it:
//   <s> pad <control> <value>   a button (SDL's names: a, b, x, y, back, start, leftshoulder, dpup...) 1 or 0, or an
//                               axis (leftx, lefty, rightx, righty, lefttrigger, righttrigger) -32768 to 32767
//   <s> unplug, <s> replug      the pad pulled out, and the same pad (its GUID) plugged in again
//   <s> answer <name> <control> <value> <hold s> [<press ms> [<still ms>]]
// answer times the picture's answer to a press: it reads the window's pixels from Xvfb's screen (-fbdir) every few
// milliseconds, so it needs nothing of the build (old releases have no RT64_FRAME_DUMP), for a second, then sets
// <control> to <value> (a pad's control, or key:<key> for a key through XTEST), holds it <hold s>, lets go and reads on
// for 2.5 s. The picture has answered at the first read after the press that differs from the picture at the press by
// more than the scene drifted by itself in the second before (judgeAnswer() says how), and has settled once no later
// read differs from it by that much. It fails when the answer comes later than <press ms> (500) after the press, or
// none comes, or the picture settles later than <still ms> (1000) after the release, '-' leaving settling out. Both
// count the way to the screen: Turok 2's view, turned up from level, showed its first move 240-420 ms after the press
// and settled 0-650 ms after the release on v0.2.8 and v0.2.9, so a game whose view eases towards the stick and springs
// back when it is let go (its look before v0.2.8, settled 1.5-2.0 s after the release) fails, and one that answers a
// press a few game frames late passes. An until's or find's key may be pad:<button>, the stand-in pad's button. Each
// answer is a line in <out>/<run>/answers.txt and in the output, the press and release timed by when the pad applied
// them (the shim's log, <run>/pad.log), its reads in <run>/answer-<name>.json to judge again. Pick a still scene and a
// control that moves the picture at once and holds it: a menu's cursor, the view turning, not a car whose world moves
// by itself. The stand-in pad pulled out and plugged in again keeps its name and GUID, so it isn't every reconnect a
// player's pad makes: Rush 2049's v0.1.16, whose reconnected Bluetooth pad drove nothing, drove its car with the
// stand-in pad plugged in again, as v0.1.17 did. --no-dump (above) plays a plan of answers alone.
//
// Exit: frame_check's own (0 passes, 1 fails, 2 has nothing to test), or 1 where sound_check fails, 2 where the frames
// pass and sound_check had nothing it could check against --sound-reference (a run that fell behind real time), 3 when
// a run failed (the program exited or crashed, an until or find unmet, no window, the pad took no command), 75 when the
// queue asked it to stop; 1 too where a clock step's speed fails or an answer fails.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { judge } from './game_speed.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes(name);
const need = (name) => opt(name) ?? (console.error(`frame_dump: ${name} is required (the header says how)`), process.exit(3));
const game = path.resolve(need('--game')), exe = need('--exe'), gameId = need('--game-id');
const rom = path.resolve(need('--rom')), planFile = path.resolve(need('--plan')), out = path.resolve(need('--out'));
const windows = opt('--window') ? opt('--window').split(',').map((s) => s.split('x').map(Number)) : null;
const rate = Number(opt('--rate', 60));
const restart = flag('--restart');
const here = path.dirname(new URL(import.meta.url).pathname);
const runNames = windows?.length === 2 ? ['main', 'low'] : ['main', 'narrower', 'wider'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

class RunFailed extends Error {}
let stopped = false; // the queue asked for a stop
let speedFails = false; // a clock step's run judged the game's speed wrong
const dumping = !flag('--no-dump');

const plan = fs.readFileSync(planFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/\s+/));
const answers = plan.some((p) => p[1] === 'answer');
const usesPad = plan.some((p) => ['pad', 'unplug', 'replug'].includes(p[1]) || (p[1] === 'answer' && !p[3].startsWith('key:')) ||
  (['until', 'find'].includes(p[1]) && p[p[1] === 'until' ? 6 : 5]?.startsWith('pad:')));
let answersFailed = 0;

// The X server every run draws into, larger than any window a plan asks for. With answer steps its screen is also a
// file (-fbdir, an XWD image kept up to date) the answers read the window's pixels from: 66 MB, in the container's
// /dev/shm (remote_frame_dump.sh gives it 1 GB).
const display = ':7';
const fbdir = answers ? fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : '/tmp', 'frame-dump-')) : null;
const xvfb = spawn('Xvfb', [display, '-screen', '0', '7680x2160x24', '-nolisten', 'tcp', ...(fbdir ? ['-fbdir', fbdir] : [])],
  { stdio: 'ignore' });
process.on('exit', () => { if (fbdir) fs.rmSync(fbdir, { recursive: true, force: true }); });
process.on('exit', () => xvfb.kill());
const xdo = (...a) => execFileSync('xdotool', a, { env: { ...process.env, DISPLAY: display } }).toString().trim();

const keyNames = { Enter: 'Return', Space: 'space', Shift: 'Shift_L', Escape: 'Escape', Tab: 'Tab', Up: 'Up',
  Down: 'Down', Left: 'Left', Right: 'Right', Backspace: 'BackSpace' };

// tools/sdl_audio_record.c, built once for every run: each run's sound is recorded beside its dump.
let recorder = null;
try {
  recorder = path.join(out, 'sdl_audio_record.so');
  fs.mkdirSync(out, { recursive: true });
  execFileSync('cc', ['-shared', '-fPIC', '-O2', '-o', recorder, path.join(here, 'sdl_audio_record.c'), '-ldl'], { stdio: 'pipe' });
} catch (e) {
  log(`frame_dump: no sound recorded: building sdl_audio_record.c failed: ${(e.stderr ?? e.message).toString().trim()}`);
  recorder = null;
}
const keysym = (name) => {
  if (keyNames[name]) return keyNames[name];
  if (/^[A-Za-z0-9]$/.test(name)) return name.toLowerCase();
  throw new RunFailed(`unknown key ${name}`);
};

// The stand-in pad, built once for every run.
let padLib = null;
function buildPad() {
  padLib = path.join(out, 'stand_in_pad.so');
  execFileSync('gcc', ['-shared', '-fPIC', '-O2', '-o', padLib, path.join(here, 'stand_in_pad.c'), '-ldl']);
}

// Xvfb's screen file: where its pixels start and how long a row is (an XWD header, its fields 32-bit big-endian).
function openScreen() {
  const fd = fs.openSync(path.join(fbdir, 'Xvfb_screen0'), 'r');
  const h = Buffer.alloc(100);
  fs.readSync(fd, h, 0, 100, 0);
  const u = (i) => h.readUInt32BE(i * 4);
  if (u(11) !== 32) throw new RunFailed(`Xvfb's screen has ${u(11)} bits a pixel, not 32`);
  return { fd, base: u(0) + u(19) * 12, bpl: u(12) };
}
// The window's picture as the luma of a grid of its pixels, a row of the screen file read for each of the grid's rows.
const GW = 64, GH = 48;
function signature(scr, g) {
  const sig = new Uint8Array(GW * GH), row = Buffer.alloc(g.w * 4);
  for (let y = 0; y < GH; y++) {
    fs.readSync(scr.fd, row, 0, row.length, scr.base + (g.y + Math.floor((y + 0.5) * g.h / GH)) * scr.bpl + g.x * 4);
    for (let x = 0; x < GW; x++) {
      const o = Math.floor((x + 0.5) * g.w / GW) * 4; // B, G, R, X
      sig[y * GW + x] = (row[o] * 29 + row[o + 1] * 150 + row[o + 2] * 77) >> 8;
    }
  }
  return sig;
}
// The share of the grid two reads differ at.
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 12) n++; return n / a.length; };

// An answer's verdict from its reads ({ t, sig }), the press's and release's times and its limits.
// Each read is compared with a picture, never only with the read before: a scene's own motion (water, fire, a flag)
// changes a share of the grid from read to read without the view moving, so what counts is how far the picture strays
// from where it was. drift is the most the picture strayed from the first read by itself in the second before the press,
// and a read has moved once it differs from the picture at the press by over drift + 10% of the grid (5% at least).
// The picture has settled at the first read after the release that no later read (one each 20 ms) differs from by that
// much: a view that springs back, or eases on towards where the stick left it, settles only once that ends. maxStill
// '-' leaves settling out (a car that coasts on).
function judgeAnswer(samples, pressed, released, maxPress, maxStill) {
  const before = samples.filter((s) => s.t < pressed);
  const drift = Math.max(0, ...before.map((s) => changed(before[0].sig, s.sig)));
  const threshold = Math.min(0.9, Math.max(0.05, drift + 0.1));
  const atPress = before.at(-1);
  const reads = samples.length / ((samples.at(-1).t - samples[0].t) / 1000);
  const first = samples.find((s) => s.t > pressed && changed(atPress.sig, s.sig) > threshold);
  const probe = [];
  for (const s of samples) if (s.t >= released && (!probe.length || s.t - probe.at(-1).t >= 20)) probe.push(s);
  let settled = probe.length - 1;
  for (let i = probe.length - 2; i >= 0 && probe.slice(i + 1).every((s) => changed(probe[i].sig, s.sig) <= threshold); i--) settled = i;
  const r = { drift, threshold, reads, answer: first ? first.t - pressed : null, still: probe[settled].t - released };
  const why = [];
  if (drift >= 0.5) why.push(`the picture wasn't still before the press (${(drift * 100).toFixed(0)}% of it changed by itself)`);
  if (r.answer === null) why.push('the picture never answered the press');
  else if (r.answer > maxPress) why.push(`the picture answered ${r.answer} ms after the press, over ${maxPress}`);
  if (maxStill === '-') r.still = null;
  else if (probe.at(-1).t - probe[settled].t < 500) why.push(`the picture hadn't settled at the end of the reads, ${probe.at(-1).t - released} ms after the release`);
  else if (r.still > Number(maxStill)) why.push(`the picture settled ${r.still} ms after the release, over ${maxStill}`);
  return { ...r, why };
}

// The runtime's RDRAM in pid: its anonymous read-write mapping of 512 MB, or the last 512 MB of a larger one that ends
// where the inaccessible rest of the runtime's reservation (its kuseg window, ---p) begins. The kernel merges the region
// with an anonymous read-write mapping just below it whenever their flags agree, so it isn't always 512 MB on its own.
function rdramOf(pid) {
  const maps = fs.readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n')
    .map((line) => line.match(/^([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ 0\s*$/)).filter(Boolean)
    .map((m) => ({ start: BigInt('0x' + m[1]), end: BigInt('0x' + m[2]), perms: m[3] }));
  const size = 512n << 20n;
  const exact = maps.find((m) => m.perms === 'rw-p' && m.end - m.start === size);
  if (exact) return exact.start;
  const merged = maps.find((m, i) => m.perms === 'rw-p' && m.end - m.start > size && maps[i + 1]?.start === m.end &&
    maps[i + 1].perms === '---p');
  return merged ? merged.end - size : null;
}

const runName = (i) => (windows ? runNames[i] : 'main');
// A dump a finished run left (--keep), for --reuse.
const kept = (i) => fs.existsSync(path.join(out, runName(i), 'dump.done'));

// One run of the plan as <out>/<name>: in a new copy of the game with config's files (<out>/<name>/run), or, given
// work, in that folder as an earlier run left it (a restart).
async function playRun(name, size, signal, { config, work: keptWork }) {
  const dir = path.join(out, name), work = keptWork ?? path.join(dir, 'run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (!keptWork) {
    fs.cpSync(game, work, { recursive: true });
    fs.writeFileSync(path.join(work, 'portable.txt'), '');
    fs.copyFileSync(rom, path.join(work, `${gameId}.z64`));
    for (const f of config ? fs.readdirSync(config) : []) fs.copyFileSync(path.join(config, f), path.join(work, f));
  }
  const env = { ...process.env, DISPLAY: display, SDL_AUDIODRIVER: 'dummy' };
  if (dumping) env.RT64_FRAME_DUMP = path.join(dir, 'dump');
  const preload = [];
  if (recorder) { preload.push(recorder); env.SDL_AUDIO_RECORD = path.join(dir, 'sound'); }
  if (dumping && opt('--seconds')) env.RT64_FRAME_DUMP_SECONDS = opt('--seconds');
  if (restart) env.RT64_FRAME_DUMP_RATE = String(rate); // a first launch has no graphics.json to set Manual in
  const padCmds = path.join(dir, 'pad.txt'), padLog = path.join(dir, 'pad.log');
  if (usesPad) {
    if (!padLib) buildPad();
    fs.writeFileSync(padCmds, '');
    preload.push(padLib);
    Object.assign(env, { STAND_IN_PAD: padCmds, STAND_IN_PAD_LOG: padLog });
  }
  if (preload.length) env.LD_PRELOAD = preload.join(' ');
  for (const kv of (opt('--env') ?? '').split(',').filter(Boolean)) { const k = kv.indexOf('='); env[kv.slice(0, k)] = kv.slice(k + 1); }
  const [w, h] = size ?? [1280, 720];
  const progArgs = [...(flag('--launcher') ? [] : ['--boot']), '--window', `${w}x${h}`, ...(opt('--args') ?? '').split(/\s+/).filter(Boolean)];
  const started = Date.now();
  const proc = spawn(path.join(work, exe), progArgs, { cwd: work, env,
    stdio: ['ignore', fs.openSync(path.join(dir, 'stdout.log'), 'w'), fs.openSync(path.join(dir, 'stderr.log'), 'w')] });
  let exited = null;
  proc.on('exit', (code, sig) => { exited = sig ?? code; });
  const t = () => (Date.now() - started) / 1000;
  // Each step as it is done: printed, in <run>/plan.log, which stays with the dump (when a reused dump's run had its
  // plan reach a scene), and with its wall-clock time in <run>/steps.tsv (for the sound check).
  const steps = fs.openSync(path.join(dir, 'steps.tsv'), 'w');
  const say = (s) => {
    const l = `${name} ${t().toFixed(1).padStart(6)}s ${s}`;
    log(l);
    fs.appendFileSync(path.join(dir, 'plan.log'), `${l}\n`);
    fs.writeSync(steps, `${Date.now()}\t${s}\n`);
  };
  say(`started ${exe} ${progArgs.join(' ')}`);
  let win = null, mem = null, rdram = null, shift = 0;
  const names = {};
  const live = () => {
    if (signal?.aborted) { stopped = true; throw new RunFailed(`the queue asked it to stop: ${signal.reason?.message ?? signal.reason}`); }
    if (exited !== null) throw new RunFailed(`the program exited with ${exited} at ${t().toFixed(1)}s`);
  };
  const findWindow = async () => {
    for (const end = Date.now() + 60000; Date.now() < end; await sleep(250)) {
      live();
      let ids = '';
      try { ids = xdo('search', '--onlyvisible', '--pid', String(proc.pid)); } catch { /* none yet */ }
      if (ids) { win = ids.split('\n').pop(); try { xdo('mousemove', '--window', win, '1', '1'); xdo('windowfocus', win); } catch { /* no focus to take */ } return; }
    }
    throw new RunFailed('no window in 60 s');
  };
  const memory = () => {
    if (rdram === null) { rdram = rdramOf(proc.pid); if (rdram === null) throw new RunFailed(`no RDRAM in pid ${proc.pid}`); }
    if (mem === null) mem = fs.openSync(`/proc/${proc.pid}/mem`, 'r+');
    return rdram;
  };
  // A position in /proc/<pid>/mem is a Number: fs.writeSync takes a BigInt one as null and writes at the file's
  // offset, address 0, which fails with EIO (readSync takes either). A user address is below 2^47, so it is exact.
  const at = (addr) => Number(memory() + BigInt(addr - 0x80000000));
  const read = (addr, len = 4) => { const pos = at(addr), b = Buffer.alloc(len); fs.readSync(mem, b, 0, len, pos); return b; };
  const write = (addr, v) => { const pos = at(addr), b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); fs.writeSync(mem, b, 0, 4, pos); };
  const num = (s) => {
    let m = s.match(/^\[(.+)\](?:\+(.+))?$/);
    if (m) return (read(num(m[1])).readUInt32LE() + (m[2] ? num(m[2]) : 0)) >>> 0;
    m = s.match(/^([A-Za-z_]\w*)(?:\+(.+))?$/);
    if (m && !/^0x/i.test(s)) { if (!(m[1] in names)) throw new RunFailed(`no find has set ${m[1]}`); return (names[m[1]] + (m[2] ? num(m[2]) : 0)) >>> 0; }
    return Number(s) >>> 0;
  };
  const press = async (key, ms = 120) => { xdo('keydown', keysym(key)); await sleep(ms); xdo('keyup', keysym(key)); };
  // A command to the stand-in pad, and when it applied it (ms since 1970): its line in the pad's log, waited for while
  // `meanwhile` runs (an answer's reads).
  let padSent = 0;
  const padLines = () => (fs.existsSync(padLog) ? fs.readFileSync(padLog, 'utf8').split('\n').filter((l) => l && l.split(' ')[1] !== 'plug') : []);
  const pad = async (cmd, meanwhile = () => sleep(5)) => {
    const n = padSent++;
    fs.appendFileSync(padCmds, cmd + '\n');
    for (const end = Date.now() + 2000; Date.now() < end; await meanwhile()) {
      live();
      const l = padLines()[n];
      if (!l) continue;
      const [ms, ...rest] = l.split(' ');
      if (!/ ok$/.test(l)) throw new RunFailed(`the stand-in pad refused ${cmd}: ${rest.join(' ')}`);
      return Number(ms);
    }
    const plugged = fs.existsSync(padLog) ? fs.readFileSync(padLog, 'utf8').split('\n').find((l) => / plug /.test(l)) : null;
    throw new RunFailed(`the stand-in pad took no ${cmd} in 2 s (${plugged ?? 'never plugged in: the program polls no SDL events, or the pad was not preloaded'})`);
  };
  const results = [];
  // The clock step's reads, [ms, value], every 100 ms on a timer of their own while the plan goes on.
  let clock = null, clockTimer = null;
  const clockRead = () => {
    try { clock.reads.push([performance.now(), read(clock.addr).readUInt32LE()]); } catch { /* the game's RDRAM not mapped yet */ }
  };
  try {
    await findWindow();
    if (size) xdo('windowsize', win, String(w), String(h));
    plan: for (const p of plan) {
      while (t() < Number(p[0]) + shift) { live(); await sleep(10); }
      live();
      switch (p[1]) {
        case 'key': await press(p[2], p[3] ? Number(p[3]) : 120); say(`key ${p[2]}`); break;
        case 'down': xdo('keydown', keysym(p[2])); say(`down ${p[2]}`); break;
        case 'up': xdo('keyup', keysym(p[2])); say(`up ${p[2]}`); break;
        case 'size':
          if (size) { say(`size ${p[2]}x${p[3]} skipped: --window gives the size`); break; }
          xdo('windowsize', win, p[2], p[3]); say(`size ${p[2]}x${p[3]}`); break;
        case 'shot': {
          const shoot = (file) => execFileSync('bash', ['-c', `xwd -silent -id ${win} | convert xwd:- ${JSON.stringify(path.join(dir, file))}`],
            { env: { ...process.env, DISPLAY: display } });
          shoot(p[2] + '.png');
          // --restart compares shots only of a picture that holds still: a second one half a second later says so.
          if (restart) { await sleep(500); shoot(p[2] + '.still.png'); }
          say(`shot ${p[2]}`); break;
        }
        case 'burst': case 'record': case 'stop': say(`${p[1]} skipped: the dump has every frame`); break;
        case 'drag': throw new RunFailed('drag is Windows\' move loop, which this has no counterpart of');
        case 'until': case 'find': {
          const began = t(), timeout = Number(p[p[1] === 'until' ? 5 : 4]), key = p[p[1] === 'until' ? 6 : 5];
          let met = false, pressed = -10;
          const words = p[1] === 'find' ? p[3].split(',').map(num) : null;
          while (t() - began < timeout) {
            live();
            try {
              if (p[1] === 'until') met = ((read(num(p[2])).readUInt32LE() & num(p[3])) >>> 0) === num(p[4]);
              else {
                const b = read(0x80000000, 32 << 20);
                for (let o = 0; o + 8 <= b.length; o += 4)
                  if (b.readUInt32LE(o) === words[0] && b.readUInt32LE(o + 4) === words[1]) { names[p[2]] = 0x80000000 + o; met = true; break; }
              }
            } catch (e) { if (e instanceof RunFailed && /no RDRAM/.test(e.message)) rdram = null; else throw e; }
            if (met) break;
            if (key && t() - pressed >= 1.5) {
              pressed = t();
              if (key.startsWith('pad:')) { await pad(`${key.slice(4)} 1`); await sleep(120); await pad(`${key.slice(4)} 0`); }
              else await press(key);
            }
            await sleep(p[1] === 'until' ? 20 : 500);
          }
          shift += t() - began;
          if (p[1] === 'until') say(`until ${p[2]} ${met ? 'met' : 'NOT met'} after ${(t() - began).toFixed(1)}s`);
          else say(met ? `find ${p[2]} at 0x${names[p[2]].toString(16).toUpperCase()}` : `find ${p[2]} NOT found`);
          if (!met) throw new RunFailed(`${p[1]} ${p[2]} unmet`);
          break;
        }
        case 'poke': write(num(p[2]), num(p[3])); say(`poke ${p[2]} ${p[3]}`); break;
        case 'or': { const a = num(p[2]); write(a, read(a).readUInt32LE() | num(p[3])); say(`or ${p[2]} ${p[3]}`); break; }
        case 'peek': say('peek ' + p[2].split(',').map((a) => `${a}=0x${read(num(a)).readUInt32LE().toString(16).toUpperCase().padStart(8, '0')}`).join(' ')); break;
        case 'dump': fs.writeFileSync(path.join(dir, p[4] + '.bin'), read(num(p[2]), num(p[3]))); say(`dump ${p[2]} ${p[3]} ${p[4]}.bin`); break;
        case 'pad': await pad(`${p[2]} ${p[3]}`); say(`pad ${p[2]} ${p[3]}`); break;
        case 'unplug': case 'replug': await pad(p[1]); say(p[1]); break;
        case 'answer': {
          const [, , label, control, value, hold, maxPress = 500, maxStill = 1000] = p;
          const scr = openScreen();
          const geo = Object.fromEntries(xdo('getwindowgeometry', '--shell', win).split('\n').map((l) => l.split('=')));
          const g = { x: Number(geo.X), y: Number(geo.Y), w: Number(geo.WIDTH), h: Number(geo.HEIGHT) };
          const samples = [];
          const sample = async () => { samples.push({ t: Date.now(), sig: signature(scr, g) }); await sleep(3); };
          const readFor = async (ms) => { for (const end = Date.now() + ms; Date.now() < end; await sample()) live(); };
          const set = async (v) => {
            if (!control.startsWith('key:')) return pad(`${control} ${v}`, sample);
            const ms = Date.now();
            xdo(Number(v) ? 'keydown' : 'keyup', keysym(control.slice(4)));
            return ms;
          };
          try {
            await readFor(1000);
            const pressed = await set(value);
            await readFor(Number(hold) * 1000 - (Date.now() - pressed));
            const released = await set(0);
            await readFor(2500 - (Date.now() - released));
            const r = judgeAnswer(samples, pressed, released, Number(maxPress), maxStill);
            fs.writeFileSync(path.join(dir, `answer-${label}.json`), JSON.stringify({ pressed, released, grid: [GW, GH],
              t: samples.map((s) => s.t), sigs: Buffer.concat(samples.map((s) => s.sig)).toString('base64') }));
            const text = `answer ${label}: ${control} ${value} for ${hold} s: ` +
              `${r.answer === null ? 'no answer' : `answered in ${r.answer} ms`}` +
              `${r.still === null ? '' : `, settled ${r.still} ms after the release`} ` +
              `(${r.reads.toFixed(0)} reads a second, drift ${(r.drift * 100).toFixed(1)}%, moved over ${(r.threshold * 100).toFixed(1)}%)` +
              (r.why.length ? `: FAILS: ${r.why.join('; ')}` : ': passes');
            if (r.why.length) answersFailed++;
            results.push(text);
            say(text);
          } finally { fs.closeSync(scr.fd); }
          break;
        }
        case 'clock':
          clock = { addr: num(p[2]), perSecond: Number(p[3]), reads: [] };
          clearInterval(clockTimer); clockTimer = setInterval(clockRead, 100); clockRead();
          say(`clock ${p[2]} at ${p[3]} a second`); break;
        case 'click': xdo('mousemove', '--window', win, p[2], p[3]); await sleep(100); xdo('click', '1'); say(`click ${p[2]} ${p[3]}`); break;
        case 'end': break plan;
        default: throw new RunFailed(`unknown plan step: ${p.join(' ')}`);
      }
    }
  } finally {
    clearInterval(clockTimer);
    if (clock) {
      fs.writeFileSync(path.join(dir, 'speed.tsv'), clock.reads.map(([ms, v]) => `${Math.round(ms)}\t${v}`).join('\n') + '\n');
      const { lines, fails } = judge(clock.reads, clock.perSecond, { slow: flag('--slow') });
      for (const line of lines) say(line);
      speedFails ||= fails;
    }
    if (mem !== null) fs.closeSync(mem);
    if (exited === null) {
      proc.kill('SIGTERM');
      for (let n = 0; n < 50 && exited === null; n++) await sleep(100);
      if (exited === null) proc.kill('SIGKILL');
      say('stopped');
    }
  }
  if (results.length) fs.writeFileSync(path.join(dir, 'answers.txt'), results.join('\n') + '\n');
  const crash = fs.readFileSync(path.join(dir, 'stderr.log'), 'utf8').match(/^.*Crash:.*$/m);
  if (crash) throw new RunFailed(`the program crashed: ${crash[0]}`);
  fs.writeFileSync(path.join(dir, 'dump.done'), '');
  const pace = paceOf(path.join(dir, 'dump'));
  if (pace) say(pace);
  return path.join(dir, 'dump');
}

// How fast a dump's frames came, from frames.bin's headers (rt64_frame_dump.h's FrameHeader, 40 bytes before each
// frame's 8-bit RGB): presents a second, the game's own frames a second (a game frame is the last of its present's
// frames, its index the count less 1; the rest RT64 draws between), and the presents the game queued (State's
// present ids, one a screen update) against those the dump has: RT64 skips a present whose next one is already queued,
// and shows nothing for one whose game frame it has shown, so the ids the dump lacks are the presents that showed nothing.
function paceOf(dump) {
  const file = path.join(dump, 'frames.bin');
  if (!fs.existsSync(file)) return null;
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, h = Buffer.alloc(40);
  let frames = 0, own = 0, dropped = 0, first = null, last = null, firstId = null, lastId = null;
  const counts = [], ids = new Set();
  for (let o = 0; o + 40 <= size; frames++) {
    fs.readSync(fd, h, 0, 40, o);
    if (h.readUInt32LE(0) !== 0x44465452) break; // rt64_frame_dump.h's FrameDump::Magic
    const w = h.readUInt32LE(4), ht = h.readUInt32LE(8), index = h.readUInt32LE(12), count = h.readUInt32LE(16);
    if (o + 40 + w * ht * 3 > size) break;
    if (index === count - 1) { own++; counts.push(count); }
    dropped += h.readUInt32LE(20);
    const id = Number(h.readBigUInt64LE(24));
    ids.add(id); lastId = id; firstId ??= id;
    last = Number(h.readBigUInt64LE(32)); first ??= last;
    o += 40 + w * ht * 3;
  }
  fs.closeSync(fd);
  const s = (last - first) / 1000;
  if (!(s > 0)) return null;
  counts.sort((a, b) => a - b);
  const a = (n) => (n / s).toFixed(1);
  return `dump: ${frames} frames in ${s.toFixed(1)} s, ${a(frames)} presented a second, ${a(own)} of the game's own ` +
    `(each shown ${counts[counts.length >> 1] ?? 0} times, median), ${a(lastId - firstId + 1)} presents queued a second ` +
    `(${a(ids.size)} in the dump), ${dropped} frames dropped by the writer`;
}

// graphics.json for every run: --config's, or the one a first start of the program writes, at Manual --rate.
async function makeConfig() {
  const config = path.join(out, 'config');
  fs.rmSync(config, { recursive: true, force: true });
  fs.mkdirSync(config, { recursive: true });
  if (opt('--config')) fs.cpSync(path.resolve(opt('--config')), config, { recursive: true });
  const gj = path.join(config, 'graphics.json');
  if (!fs.existsSync(gj)) {
    const work = path.join(out, 'first-start');
    fs.rmSync(work, { recursive: true, force: true });
    fs.cpSync(game, work, { recursive: true });
    fs.writeFileSync(path.join(work, 'portable.txt'), '');
    const proc = spawn(path.join(work, exe), [], { cwd: work, stdio: 'ignore',
      env: { ...process.env, DISPLAY: display, SDL_AUDIODRIVER: 'dummy' } });
    for (let n = 0; n < 300 && !fs.existsSync(path.join(work, 'graphics.json')); n++) await sleep(100);
    await sleep(500);
    proc.kill('SIGKILL');
    if (!fs.existsSync(path.join(work, 'graphics.json'))) throw new RunFailed('the program wrote no graphics.json in 30 s');
    fs.copyFileSync(path.join(work, 'graphics.json'), gj);
    fs.rmSync(work, { recursive: true, force: true });
  }
  const g = JSON.parse(fs.readFileSync(gj, 'utf8'));
  if (!('rr_option' in g)) log('frame_dump: graphics.json has no rr_option; the refresh rate is left as it is');
  else { g.rr_option = 'Manual'; g.rr_manual_value = rate; fs.writeFileSync(gj, JSON.stringify(g, null, 4)); }
  return config;
}

const runs = windows ?? [null];
const reusing = () => flag('--reuse') && runs.every((_, i) => kept(i));

async function dumps(signal) {
  const made = [];
  let config = null;
  for (const [i, size] of runs.entries()) {
    if (flag('--reuse') && kept(i)) { log(`${runName(i)} reused`); made.push(path.join(out, runName(i), 'dump')); continue; }
    config ??= await makeConfig();
    made.push(await playRun(runName(i), size, signal, { config }));
  }
  return made;
}

// --restart: the plan played three times in one copy of the game, a first launch with only --config's files and two
// starts after it, each run's settings files copied to <out>/<run>/settings as it ends.
const restartNames = ['first', 'restart', 'again'];
const jsonFiles = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.json') && fs.statSync(path.join(d, f)).isFile());
async function restartRuns(signal) {
  const config = opt('--config') ? path.resolve(opt('--config')) : null;
  const work = path.join(out, 'first', 'run');
  for (const name of restartNames) {
    await playRun(name, windows?.[0] ?? null, signal, { config, work: name === 'first' ? undefined : work });
    const kept = path.join(out, name, 'settings');
    fs.mkdirSync(kept, { recursive: true });
    for (const f of jsonFiles(work)) fs.copyFileSync(path.join(work, f), path.join(kept, f));
  }
}

// Each settings file's values by key (a.b.c, a.0 for an array's first), as JSON text.
function flatten(v, key = '', into = new Map()) {
  if (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length))
    for (const [k, x] of Object.entries(v)) flatten(x, key ? `${key}.${k}` : k, into);
  else into.set(key, JSON.stringify(v));
  return into;
}
function settingsOf(d) {
  const files = new Map();
  for (const f of fs.existsSync(d) ? jsonFiles(d) : []) {
    try { files.set(f, flatten(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))); }
    catch (e) { files.set(f, new Map([['(the file)', `not JSON: ${e.message}`]])); }
  }
  return files;
}
// What changed from settings a to b: each value that differs, and each file or key one of them lacks.
function settingsDiff(a, b, keysOfA = false) {
  const lines = [];
  for (const [f, av] of a) {
    const bv = b.get(f);
    if (!bv) { lines.push(`${f}: gone`); continue; }
    for (const [k, x] of av) if (bv.get(k) !== x) lines.push(`${f}: ${k} ${x} -> ${bv.get(k) ?? '(gone)'}`);
    if (!keysOfA) for (const k of bv.keys()) if (!av.has(k)) lines.push(`${f}: ${k} (new) ${bv.get(k)}`);
  }
  if (!keysOfA) for (const f of b.keys()) if (!a.has(f)) lines.push(`${f}: new`);
  return lines;
}

// A shot as a grey 160x120 picture, for comparing runs' shots of the same window.
function thumb(file) {
  return execFileSync('convert', [file, '-resize', '160x120!', '-colorspace', 'Gray', '-depth', '8', 'gray:-'],
    { maxBuffer: 1 << 20 });
}
const mae = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

// A dump's frames by their headers alone: the size they were drawn at and how many frames each game frame was shown
// in, the most common of each.
function dumpShape(d) {
  const file = path.join(d, 'frames.bin');
  if (!fs.existsSync(file)) return null;
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, head = Buffer.alloc(40);
  const sizes = new Map(), counts = new Map();
  let frames = 0;
  for (let o = 0; o + 40 <= size; frames++) {
    fs.readSync(fd, head, 0, 40, o);
    if (head.readUInt32LE(0) !== 0x44465452) break; // rt64_frame_dump.h's FrameDump::Magic
    const w = head.readUInt32LE(4), h = head.readUInt32LE(8), k = `${w}x${h}`, c = head.readUInt32LE(16);
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
    counts.set(c, (counts.get(c) ?? 0) + 1);
    o += 40 + w * h * 3;
  }
  fs.closeSync(fd);
  const most = (m) => [...m].sort((x, y) => y[1] - x[1])[0]?.[0];
  return frames ? { frames, size: most(sizes), count: most(counts) } : null;
}

// --restart's verdict, also in <out>/restart.txt. It fails where the first launch's settings files don't hold
// --config's values, where a start changed a value the one before it wrote (a setting or a binding not read back),
// where a dump's frames were drawn at another size or shown in another number of frames a game frame, and where two
// launches' shots of a picture that holds still differ by more than SHOT_SLACK (of 255, a grey pixel's mean). A shot
// that differs by more from its .still, taken half a second later, is moving and isn't compared: a launch's moment
// wanders by a frame or two, which a still picture doesn't show. Rush 2049's countdown on its first track, from three
// launches each, read 0.1-1.0 apart within a launch's settings and 9-10 between Draw Distance, Level of Detail and
// Scenery Culling at Original and at their defaults; its attract race, moving, 14-37.
const SHOT_SLACK = 3;
function restartCheck() {
  const lines = [], say = (s) => lines.push(s);
  let failed = false;
  const fail = (s) => { failed = true; say(`FAIL ${s}`); };
  const given = settingsOf(opt('--config') ? path.resolve(opt('--config')) : path.join(out, 'none'));
  const runs = restartNames.map((n) => ({ name: n, settings: settingsOf(path.join(out, n, 'settings')) }));
  say(`settings files the first launch left: ${[...runs[0].settings.keys()].join(', ') || 'none'}`);
  for (const l of settingsDiff(given, runs[0].settings, true)) fail(`--config's value not kept by the first launch: ${l}`);
  for (let i = 1; i < runs.length; i++)
    for (const l of settingsDiff(runs[i - 1].settings, runs[i].settings)) fail(`changed by the ${runs[i].name} start: ${l}`);
  const shapes = restartNames.map((n) => dumpShape(path.join(out, n, 'dump')));
  if (shapes.every(Boolean)) {
    say(`dumps: ${shapes.map((s, i) => `${restartNames[i]} ${s.frames} frames at ${s.size}, ${s.count} a game frame`).join('; ')}`);
    for (const k of ['size', 'count']) if (new Set(shapes.map((s) => s[k])).size > 1) fail(`the runs' frames differ in ${k}`);
  } else say('dumps: not in every run (a build without RT64_FRAME_DUMP), so only the shots compare the pictures');
  const shots = fs.readdirSync(path.join(out, 'first')).filter((f) => f.endsWith('.png') && !f.endsWith('.still.png'));
  for (const s of shots) {
    const files = restartNames.map((n) => path.join(out, n, s));
    if (!files.every((f) => fs.existsSync(f) && fs.existsSync(f.replace(/\.png$/, '.still.png')))) { say(`shot ${s}: not in every run`); continue; }
    const pics = files.map(thumb), moved = files.map((f, i) => mae(pics[i], thumb(f.replace(/\.png$/, '.still.png'))));
    if (Math.max(...moved) > SHOT_SLACK) { say(`shot ${s}: moving (${moved.map((m) => m.toFixed(1)).join(', ')} in half a second), not compared`); continue; }
    const apart = [[0, 1], [1, 2], [0, 2]].map(([i, j]) => `${restartNames[i]}-${restartNames[j]} ${mae(pics[i], pics[j]).toFixed(1)}`);
    const worst = Math.max(...[[0, 1], [1, 2], [0, 2]].map(([i, j]) => mae(pics[i], pics[j])));
    (worst > SHOT_SLACK ? fail : say)(`shot ${s}: launches apart ${apart.join(', ')}`);
  }
  if (!shots.length) say('shots: none in the plan, so the pictures aren\'t compared');
  say(failed ? 'restart check: FAILS' : 'restart check: passes');
  const text = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'restart.txt'), text);
  process.stdout.write(text);
  return failed ? 1 : 0;
}

function check(made) {
  const a = [path.join(here, made.length === 2 ? 'seam_check.mjs' : 'frame_check.mjs'), made[0]];
  if (made.length === 2) a.push('--low', made[1]);
  if (made.length === 3) a.push('--narrower', made[1], '--wider', made[2]);
  if (opt('--workers') && (made.length !== 2)) a.push('--workers', opt('--workers'));
  fs.rmSync(path.join(out, 'flagged'), { recursive: true, force: true });
  a.push('--save', path.join(out, 'flagged'), ...(opt('--check') ?? '').split(/\s+/).filter(Boolean));
  log(`${path.basename(a[0], '.mjs')} ${a.slice(1).join(' ')}`);
  let code = 0, text;
  try { text = execFileSync(process.execPath, a, { maxBuffer: 1 << 28 }).toString(); }
  catch (e) { code = e.status ?? 1; text = (e.stdout ?? '').toString() + (e.stderr ?? '').toString(); }
  fs.writeFileSync(path.join(out, `${path.basename(a[0], '.mjs')}.txt`), text);
  process.stdout.write(text);
  log(`${path.basename(a[0], '.mjs')} exited ${code}`);
  return code;
}

// sound_check on the first run's recording, after frame_check, in the same job: its exit, 1 where it fails.
function soundCheck(made) {
  const a = [path.join(here, 'sound_check.mjs'), path.dirname(made[0])];
  if (opt('--sound-reference')) a.push('--reference', path.resolve(opt('--sound-reference')));
  log(`sound_check ${a.slice(1).join(' ')}`);
  let code = 0, text;
  try { text = execFileSync(process.execPath, a, { maxBuffer: 1 << 24 }).toString(); }
  catch (e) { code = e.status ?? 1; text = (e.stdout ?? '').toString() + (e.stderr ?? '').toString(); }
  fs.writeFileSync(path.join(out, 'sound_check.txt'), text);
  process.stdout.write(text);
  log(`sound_check exited ${code}`);
  return code;
}
const both = (made) => {
  const frames = check(made), sound = soundCheck(made);
  return sound === 1 ? 1 : sound === 2 && opt('--sound-reference') && frames === 0 ? 2 : frames;
};

// The container's memory cap in MiB (cgroup v2's memory.max), null when it has none (the queue then reads the game's
// last runs).
function capMiB() {
  try {
    const max = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    return /^\d+$/.test(max) ? Math.ceil(Number(max) / 1048576) : null;
  } catch { return null; }
}

let code;
try {
  await sleep(500);
  if (opt('--queue')) {
    const { gpuRun } = await import(pathToFileURL(path.resolve(opt('--queue'))).href);
    const spec = (type, label, vramMiB) => ({ type, label, vramMiB, model: gameId, priority: opt('--priority', 'low'),
      ...(vramMiB === 'auto' ? { guessMiB: 1024 } : {}), ramMiB: capMiB(),
      url: opt('--url') || undefined, ref: process.env.HOSTNAME,
      onUpdate: (j) => j.state === 'waiting' && log(`queue: ${type} waiting, ${j.ahead} ahead${j.waitMs != null ? `, ~${Math.ceil(j.waitMs / 60000)} min` : ''}: ${j.why?.text ?? 'going next'}`) });
    const made = reusing() && !restart ? await dumps(null) : await gpuRun(spec('frame-dump', `Frame dump: ${gameId}`, opt('--vram', 'auto') === 'auto' ? 'auto' : Number(opt('--vram'))),
      (signal) => (restart ? restartRuns(signal) : dumps(signal)));
    // --restart's check reads headers and 160x120 shots, seconds of one core: no job of its own.
    if (restart) code = restartCheck();
    else code = dumping ? await gpuRun(spec('frame-check', `frame_check: ${gameId}`, 0), async () => both(made)) : 0;
  } else if (restart) { await restartRuns(null); code = restartCheck(); }
  else code = dumping ? both(await dumps(null)) : (await dumps(null), 0);
  if (speedFails) { log("frame_dump: the game's speed fails (the clock step's lines above)"); code = 1; }
  if (answersFailed) { log(`frame_dump: ${answersFailed} answer${answersFailed > 1 ? 's' : ''} failed (the answer lines above)`); code = 1; }
} catch (e) {
  log(`frame_dump: ${e instanceof RunFailed ? e.message : e?.stack ?? e}`);
  code = stopped ? 75 : 3;
}
for (const n of [...runNames, ...restartNames, 'first-start']) {
  if (!flag('--keep')) fs.rmSync(path.join(out, n, 'dump'), { recursive: true, force: true });
  fs.rmSync(path.join(out, n, 'run'), { recursive: true, force: true });
}
xvfb.kill();
process.exit(code);
