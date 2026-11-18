// Dumps a recomp's frames by a plan on Linux and checks them, in the container of tools/frame_dump.Dockerfile, which
// tools/remote_frame_dump.sh starts on a Linux host with an NVIDIA GPU: the dumps and
// tools/frame_check.mjs on them, made on that host's GPU and CPU instead of the machine a person or an agent works on.
// A dump is ~20 MB a second of frames, too much to bring back over a slow link, so only the check's text, the
// program's logs, the plan's shots and frame_check's flagged frames stay; the dumps are deleted unless --keep.
//
//   node tools/frame_dump.mjs --game <dir> --exe <name> --game-id <id> --rom <file> --plan <file> --out <dir>
//       [--window <w>x<h>[,<w>x<h>,<w>x<h>]] [--rate <hz>] [--seconds <from>-<to>] [--args "<program args>"]
//       [--env K=V,...] [--config <dir>] [--check "<frame_check args>"] [--workers <n>] [--keep]
//       [--queue <module>] [--vram <MiB>|auto] [--priority low] [--url <url>] [--saves <plan>]
//
// --game is the folder of a recomp's Linux build (its release archive unpacked, or its build folder with assets/),
// --exe the program in it, --game-id the name its runtime stores the ROM under (<game id>.z64, as Load ROM does). Each
// run copies --game into a folder of its own under --out with a portable.txt, so its settings and saves are the run's,
// stores the ROM, copies --config's files in (a graphics.json, a general.json) and starts the program with --boot,
// --window and --args, SDL's dummy sound driver, and RT64_FRAME_DUMP (and RT64_FRAME_DUMP_SECONDS from --seconds).
// RT64's refresh rate is set to Manual at --rate (240) in its graphics.json, made by a first start of the program
// when --config has none: Xvfb has no refresh rate of its own, and at Display the program presents only the game's own
// frames, which test nothing of the frames between. It presents as fast as it draws below that rate (Mario Golf's
// title at 1280x720: ~69 a second with the dump on, on an RTX 5090).
//
// --window gives each run's window: one size is one run, frame_check reading its dump alone; three are three runs of
// the plan, the first checked with the second as --narrower (a 4:3 window) and the third as --wider (32:9), the check
// of the frames between the game's and the sides asks for. With --window the plan's size steps are skipped. Without it each run is the plan's own size steps
// from a 1280x720 window.
//
// The plan is tools/capture_window.ps1's (its header has every step), its times in seconds since the program started:
// key, down, up, size, shot (a PNG of the window, <out>/<run>/<name>.png), until, poke, or, peek, dump, find and end
// do what they do there, keys through XTEST into the window and RDRAM through /proc/<pid>/mem (the runtime maps it as
// one 512 MB region, 0x80000000 at its first byte, each 32-bit word in the host's order). burst, record and stop are
// captures, which the dump replaces: they are skipped. drag, Windows' move loop, has no counterpart and fails the run.
// One step is this tool's own: `<t> saves same` checks that every file in the run's saves/ holds the bytes it held when
// the run started, and `<t> saves changed <timeout>` waits up to <timeout> seconds for one to differ or a new one to
// appear (the runtime gathers a game's writes for a moment before it writes them), the run failing when it doesn't.
//
// --saves <plan> checks that the game finds its save after a restart, in place of the dumps and frame_check: the save
// run plays --plan (which makes a save the game's own way, and ends with `saves changed` once it is written), and the
// program is stopped as a player quits it (SIGTERM, which SDL hands the program as a quit). Then saves/ is moved aside
// and reached through a symlink, and each file in it through a symlink of its own, as a player shares saves through a
// synced folder, and the load run starts the program again in the same folder and plays --saves' plan: it has the game
// load the save and reads that it did (an until on its RAM, a find, a shot), `saves same` once it has loaded (a
// restart that saves nothing leaves the bytes alone), and it may save again (`saves changed`) to check a write goes
// through the links. Then every link must still be the link it was, to the same file. It runs once, at --window's first
// size (1280x720). Exit 0 passes; 1 fails (the save run left nothing in saves/, the load run's plan unmet or the
// program crashed, a link replaced); 3 the save run itself failed, which checks nothing.
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
// --workers is frame_check's (a third of the cores it sees unless given), for a container held to fewer cores than
// the host has.
//
// Exit: frame_check's own (0 passes, 1 fails, 2 has nothing to test), 3 when a run failed (the program exited or
// crashed, an until or find unmet, no window), 75 when the queue asked it to stop.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes(name);
const need = (name) => opt(name) ?? (console.error(`frame_dump: ${name} is required (the header says how)`), process.exit(3));
const game = path.resolve(need('--game')), exe = need('--exe'), gameId = need('--game-id');
const rom = path.resolve(need('--rom')), planFile = path.resolve(need('--plan')), out = path.resolve(need('--out'));
const windows = opt('--window') ? opt('--window').split(',').map((s) => s.split('x').map(Number)) : null;
const rate = Number(opt('--rate', 240));
const here = path.dirname(new URL(import.meta.url).pathname);
const runNames = ['main', 'narrower', 'wider'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

class RunFailed extends Error {}
let stopped = false; // the queue asked for a stop

const readPlan = (file) => fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
const plan = readPlan(planFile);
const loadPlan = opt('--saves') ? readPlan(path.resolve(opt('--saves'))) : null;

// Every file under dir, by its path relative to dir, with its bytes (read through any link); a link to nothing has none.
function filesOf(dir) {
  const found = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name), p = path.join(dir, r);
      let st = null;
      try { st = fs.statSync(p); } catch { /* a dangling link */ }
      if (st?.isDirectory()) walk(r);
      else found.set(r, st ? fs.readFileSync(p) : null);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return found;
}

// The X server every run draws into, larger than any window a plan asks for.
const display = ':7';
const xvfb = spawn('Xvfb', [display, '-screen', '0', '7680x2160x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
process.on('exit', () => xvfb.kill());
const xdo = (...a) => execFileSync('xdotool', a, { env: { ...process.env, DISPLAY: display } }).toString().trim();

const keyNames = { Enter: 'Return', Space: 'space', Shift: 'Shift_L', Escape: 'Escape', Tab: 'Tab', Up: 'Up',
  Down: 'Down', Left: 'Left', Right: 'Right' };
const keysym = (name) => {
  if (keyNames[name]) return keyNames[name];
  if (/^[A-Za-z0-9]$/.test(name)) return name.toLowerCase();
  throw new RunFailed(`unknown key ${name}`);
};

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

// One run of steps, its logs and shots in <out>/<name>. The program runs in a copy of --game of the run's own, or in
// shared, a folder --saves' two runs share, copied by the first.
async function playRun(name, steps, size, signal, config, shared = null) {
  const dir = path.join(out, name), work = shared ?? path.join(dir, 'run');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(work)) {
    fs.cpSync(game, work, { recursive: true });
    fs.writeFileSync(path.join(work, 'portable.txt'), '');
    fs.copyFileSync(rom, path.join(work, `${gameId}.z64`));
    for (const f of fs.readdirSync(config)) fs.copyFileSync(path.join(config, f), path.join(work, f));
  }
  const savesDir = path.join(work, 'saves'), savesAtStart = filesOf(savesDir);
  const env = { ...process.env, DISPLAY: display, SDL_AUDIODRIVER: 'dummy' };
  if (!loadPlan) env.RT64_FRAME_DUMP = path.join(dir, 'dump');
  if (!loadPlan && opt('--seconds')) env.RT64_FRAME_DUMP_SECONDS = opt('--seconds');
  for (const kv of (opt('--env') ?? '').split(',').filter(Boolean)) { const k = kv.indexOf('='); env[kv.slice(0, k)] = kv.slice(k + 1); }
  const [w, h] = size ?? [1280, 720];
  const progArgs = ['--boot', '--window', `${w}x${h}`, ...(opt('--args') ?? '').split(/\s+/).filter(Boolean)];
  const started = Date.now();
  const proc = spawn(path.join(work, exe), progArgs, { cwd: work, env,
    stdio: ['ignore', fs.openSync(path.join(dir, 'stdout.log'), 'w'), fs.openSync(path.join(dir, 'stderr.log'), 'w')] });
  let exited = null;
  proc.on('exit', (code, sig) => { exited = sig ?? code; });
  const t = () => (Date.now() - started) / 1000;
  const say = (s) => log(`${name} ${t().toFixed(1).padStart(6)}s ${s}`);
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
  try {
    await findWindow();
    if (size) xdo('windowsize', win, String(w), String(h));
    plan: for (const p of steps) {
      while (t() < Number(p[0]) + shift) { live(); await sleep(10); }
      live();
      switch (p[1]) {
        case 'key': await press(p[2], p[3] ? Number(p[3]) : 120); say(`key ${p[2]}`); break;
        case 'down': xdo('keydown', keysym(p[2])); say(`down ${p[2]}`); break;
        case 'up': xdo('keyup', keysym(p[2])); say(`up ${p[2]}`); break;
        case 'size':
          if (size) { say(`size ${p[2]}x${p[3]} skipped: --window gives the size`); break; }
          xdo('windowsize', win, p[2], p[3]); say(`size ${p[2]}x${p[3]}`); break;
        case 'shot':
          execFileSync('bash', ['-c', `xwd -silent -id ${win} | convert xwd:- ${JSON.stringify(path.join(dir, p[2] + '.png'))}`],
            { env: { ...process.env, DISPLAY: display } });
          say(`shot ${p[2]}`); break;
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
            if (key && t() - pressed >= 1.5) { pressed = t(); await press(key); }
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
        case 'saves': {
          // The first file whose bytes differ from the run's start, or that appeared or went since.
          const differs = () => {
            const now = filesOf(savesDir);
            for (const [r, b] of now) { const was = savesAtStart.get(r); if (!was !== !b || (b && !b.equals(was))) return r; }
            for (const r of savesAtStart.keys()) if (!now.has(r)) return r;
            return null;
          };
          if (p[2] === 'same') {
            const r = differs();
            if (r !== null) throw new RunFailed(`saves same: saves/${r} changed since the run started`);
            say('saves same'); break;
          }
          if (p[2] !== 'changed') throw new RunFailed(`unknown plan step: ${p.join(' ')}`);
          const began = t();
          let r = null;
          while ((r = differs()) === null && t() - began < Number(p[3] ?? 10)) { live(); await sleep(250); }
          shift += t() - began;
          if (r === null) throw new RunFailed(`saves changed: nothing in saves/ changed in ${p[3] ?? 10} s`);
          say(`saves changed: saves/${r} after ${(t() - began).toFixed(1)}s`); break;
        }
        case 'end': break plan;
        default: throw new RunFailed(`unknown plan step: ${p.join(' ')}`);
      }
    }
  } finally {
    if (mem !== null) fs.closeSync(mem);
    if (exited === null) {
      proc.kill('SIGTERM');
      for (let n = 0; n < 50 && exited === null; n++) await sleep(100);
      if (exited === null) proc.kill('SIGKILL');
      say('stopped');
    }
  }
  const crash = fs.readFileSync(path.join(dir, 'stderr.log'), 'utf8').match(/^.*Crash:.*$/m);
  if (crash) throw new RunFailed(`the program crashed: ${crash[0]}`);
  return path.join(dir, 'dump');
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

async function dumps(signal) {
  const config = await makeConfig();
  const made = [];
  for (const [i, size] of (windows ?? [null]).entries()) made.push(await playRun(windows ? runNames[i] : 'main', plan, size, signal, config));
  return made;
}

// --saves: the save run, saves/ put behind links, the load run in the same folder, and the links checked. Returns the
// exit code.
async function saveCheck(signal) {
  const config = await makeConfig();
  const work = path.join(out, 'game'), saves = path.join(work, 'saves'), size = windows?.[0] ?? null;
  fs.rmSync(work, { recursive: true, force: true });
  try { await playRun('save', plan, size, signal, config, work); }
  catch (e) {
    if (!(e instanceof RunFailed) || stopped) throw e;
    log(`frame_dump: the save run failed, which checks nothing: ${e.message}`);
    return 3;
  }
  const made = filesOf(saves);
  for (const [r, b] of made) log(`saved saves/${r}: ${b ? `${b.length} bytes` : 'a link to nothing'}`);
  if (!made.size) { log('frame_dump: FAIL: the save run left nothing in saves/'); return 1; }
  // saves/ moves to saves-linked/ and each file in it to saves-files/, each reached through a relative link, which
  // resolves to the same file whether it is read from the link's folder or from its target's.
  const links = new Map([['saves', 'saves-linked']]);
  fs.renameSync(saves, path.join(work, 'saves-linked'));
  fs.symlinkSync('saves-linked', saves);
  for (const r of made.keys()) {
    const at = path.join(work, 'saves-linked', r), to = path.join(work, 'saves-files', r);
    if (fs.lstatSync(at).isSymbolicLink()) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(at, to);
    links.set(path.join('saves', r), path.relative(path.dirname(at), to));
    fs.symlinkSync(links.get(path.join('saves', r)), at);
  }
  let failed = null;
  try { await playRun('load', loadPlan, size, signal, config, work); }
  catch (e) {
    if (!(e instanceof RunFailed) || stopped) throw e;
    failed = `the load run: ${e.message}`;
  }
  const broken = [...links].map(([l, target]) => {
    let now = null;
    try { now = fs.readlinkSync(path.join(work, l)); } catch { /* not a link */ }
    if (now === target) return null;
    const what = now !== null ? `a link to ${now}` : fs.existsSync(path.join(work, l)) ? 'no longer a link' : 'gone';
    return `${l}, a link to ${target}, is ${what}`;
  }).filter(Boolean);
  for (const f of [failed, ...broken].filter(Boolean)) log(`frame_dump: FAIL: ${f}`);
  if (failed || broken.length) return 1;
  log(`frame_dump: the save check passes: the save was found after a restart, through ${links.size} link(s) that stayed`);
  return 0;
}

function check(made) {
  const a = [path.join(here, 'frame_check.mjs'), made[0]];
  if (made.length === 3) a.push('--narrower', made[1], '--wider', made[2]);
  if (opt('--workers')) a.push('--workers', opt('--workers'));
  a.push('--save', path.join(out, 'flagged'), ...(opt('--check') ?? '').split(/\s+/).filter(Boolean));
  log(`frame_check ${a.slice(1).join(' ')}`);
  let code = 0, text;
  try { text = execFileSync(process.execPath, a, { maxBuffer: 1 << 28 }).toString(); }
  catch (e) { code = e.status ?? 1; text = (e.stdout ?? '').toString() + (e.stderr ?? '').toString(); }
  fs.writeFileSync(path.join(out, 'frame_check.txt'), text);
  process.stdout.write(text);
  log(`frame_check exited ${code}`);
  return code;
}

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
      onUpdate: (j) => j.state === 'waiting' && log(`queue: ${type} waiting, ${j.ahead} ahead: ${j.why?.text ?? 'going next'}`) });
    const vram = opt('--vram', 'auto') === 'auto' ? 'auto' : Number(opt('--vram'));
    if (loadPlan) code = await gpuRun(spec('frame-dump', `Save check: ${gameId}`, vram), (signal) => saveCheck(signal));
    else {
      const made = await gpuRun(spec('frame-dump', `Frame dump: ${gameId}`, vram), (signal) => dumps(signal));
      code = await gpuRun(spec('frame-check', `frame_check: ${gameId}`, 0), async () => check(made));
    }
  } else code = loadPlan ? await saveCheck(null) : check(await dumps(null));
} catch (e) {
  log(`frame_dump: ${e instanceof RunFailed ? e.message : e?.stack ?? e}`);
  code = stopped ? 75 : 3;
}
if (!flag('--keep')) fs.rmSync(path.join(out, 'game'), { recursive: true, force: true });
if (!flag('--keep')) for (const n of [...runNames, 'first-start']) {
  fs.rmSync(path.join(out, n, 'dump'), { recursive: true, force: true });
  fs.rmSync(path.join(out, n, 'run'), { recursive: true, force: true });
}
xvfb.kill();
process.exit(code);
