// Runs a game's ROM in tools/console_ref.c by a plan, in the container of tools/console_ref.Dockerfile, which
// tools/remote_console_ref.sh starts on a Linux host: the console's picture of the plan, for tools/console_check.mjs.
//
//   node tools/console_ref.mjs --rom <file> --plan <file> --out <dir> --cache <dir> [--game-id <id>]
//       [--seconds <from>-<to>] [--watch <addr>,...] [--rsp parallel|cxd4] [--max-seconds <s>] [--option <k>=<v>,...]
//       [--against <dump dir> [--check "<console_check args>"] [--again]]
//       [--queue <module>] [--priority low] [--url <url>]
//
// The core, mupen64plus-next at the commit below, is built once into --cache (mupen64plus_next-<commit>.so and the
// libretro.h it was built with) and console_ref.c on every run (a second). --seconds, --watch, --rsp, --max-seconds and --option
// are console_ref.c's (its header says what it writes into --out).
//
// --against names a recomp's frame dump of the same plan (frame_dump.mjs --keep --watch, its run's dump folder), which
// tools/console_check.mjs then holds against the console's, with --check's arguments and --save <out>/unlike; its
// output goes to <out>/console_check.txt too. --again keeps a console run already in --out and only checks.
//
// --queue names a JavaScript module exporting gpuRun(spec, run), the host's queue: the core's build then goes as a
// build job and the run as a frame-check job (the console's picture is drawn on the CPU), neither asking any GPU
// memory, each asking the host memory of the container's cap, at --priority (low), linked to --url, the run naming
// --game-id as its model. Without --queue they run at once.
//
// Exit: console_ref's (0, 3 when the plan's until or find went unmet or the core failed), else console_check's with
// --against (0 passes, 1 fails, 2 nothing to compare), 75 when the queue stopped it.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const coreRepo = 'https://github.com/libretro/mupen64plus-libretro-nx';
const coreCommit = '15bada85906593376e8fd697f1b0b3af3a20f512';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const need = (name) => opt(name) ?? (console.error(`console_ref: ${name} is required (the header says how)`), process.exit(3));
const rom = path.resolve(need('--rom')), plan = path.resolve(need('--plan')), out = path.resolve(need('--out'));
const cache = path.resolve(need('--cache')), gameId = opt('--game-id', path.basename(rom));
const here = path.dirname(new URL(import.meta.url).pathname);
const core = path.join(cache, `mupen64plus_next-${coreCommit.slice(0, 12)}.so`);
const header = path.join(cache, `libretro-${coreCommit.slice(0, 12)}.h`);
const log = (s) => console.log(s);
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(cache, { recursive: true });

function buildCore() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'core-'));
  const git = (...a) => execFileSync('git', ['-C', src, ...a], { stdio: 'inherit' });
  git('init', '-q');
  git('fetch', '-q', '--depth', '1', coreRepo, coreCommit);
  git('checkout', '-q', 'FETCH_HEAD');
  const t = Date.now();
  execFileSync('make', ['-C', src, `-j${os.availableParallelism()}`, 'platform=unix', 'HAVE_THR_AL=1', 'LLE=1',
    'HAVE_PARALLEL_RSP=1'], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.copyFileSync(path.join(src, 'mupen64plus_next_libretro.so'), core + '.tmp');
  fs.copyFileSync(path.join(src, 'libretro-common/include/libretro.h'), header);
  fs.renameSync(core + '.tmp', core);
  fs.rmSync(src, { recursive: true, force: true });
  log(`core built in ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

function run(signal) {
  const inc = fs.mkdtempSync(path.join(os.tmpdir(), 'inc-'));
  fs.copyFileSync(header, path.join(inc, 'libretro.h'));
  const exe = path.join(inc, 'console_ref');
  execFileSync('cc', ['-O2', '-g', '-rdynamic', '-I', inc, path.join(here, 'console_ref.c'), '-o', exe, '-ldl'], { stdio: 'inherit' });
  const a = [core, rom, plan, out];
  for (const o of ['--seconds', '--watch', '--rsp', '--max-seconds', '--option', '--replay', '--pad', '--pad-shift', '--replay-word']) if (opt(o)) a.push(o, opt(o));
  return new Promise((resolve) => {
    const p = spawn(exe, a, { stdio: 'inherit' });
    signal?.addEventListener('abort', () => { p.kill('SIGKILL'); resolve(75); });
    p.on('exit', (c, s) => resolve(c ?? (s ? 3 : 0)));
  });
}

function check() {
  const a = [path.join(here, 'console_check.mjs'), path.resolve(opt('--against')), out, '--save', path.join(out, 'unlike'),
    ...(opt('--check') ?? '').split(/\s+/).filter(Boolean)];
  let code = 0, text;
  try { text = execFileSync(process.execPath, a, { maxBuffer: 1 << 28 }).toString(); }
  catch (e) { code = e.status ?? 1; text = (e.stdout ?? '').toString() + (e.stderr ?? '').toString(); }
  fs.writeFileSync(path.join(out, 'console_check.txt'), text);
  process.stdout.write(text);
  return code;
}

function capMiB() {
  try {
    const max = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    return /^\d+$/.test(max) ? Math.ceil(Number(max) / 1048576) : null;
  } catch { return null; }
}

let code;
const again = args.includes('--again') && fs.existsSync(path.join(out, 'frames.bin'));
try {
  if (opt('--queue')) {
    const { gpuRun } = await import(pathToFileURL(path.resolve(opt('--queue'))).href);
    const spec = (type, label, model) => ({ type, label, vramMiB: 0, model, priority: opt('--priority', 'low'),
      ramMiB: capMiB(), url: opt('--url') || undefined, ref: process.env.HOSTNAME,
      onUpdate: (j) => j.state === 'waiting' && log(`queue: ${type} waiting, ${j.ahead} ahead: ${j.why?.text ?? 'going next'}`) });
    if (!again && !fs.existsSync(core)) await gpuRun(spec('build', 'console_ref: mupen64plus-next', 'mupen64plus-next'), async () => buildCore());
    code = again ? 0 : await gpuRun(spec('frame-check', `console_ref: ${gameId}`, gameId), (signal) => run(signal));
    if (code === 0 && opt('--against')) code = await gpuRun(spec('frame-check', `console_check: ${gameId}`, gameId), async () => check());
  } else {
    if (!again && !fs.existsSync(core)) buildCore();
    code = again ? 0 : await run(null);
    if (code === 0 && opt('--against')) code = check();
  }
} catch (e) {
  log(`console_ref: ${e?.stack ?? e}`);
  code = 3;
}
process.exit(code);
