// Runs one play of a page (tools/play_page.mjs) or one shader recording (tools/record_shaders.mjs) as a job of a GPU
// queue, in the container of tools/page_play.Dockerfile, which tools/remote_play_page.sh starts on a Linux host whose
// GPU is shared through that queue. It starts what the browsers need there (Xvfb on DISPLAY :99 for Firefox's
// window, PulseAudio with a null sink for their sound), waits for the job's turn, runs the command and ends the job.
//
//   node tools/play_job.mjs --queue <module> --model <game> [--measure] [--priority low] [--url <url>]
//       -- <command> [args...]
//
// --queue names a JavaScript module exporting gpuRun(spec, run), the queue's client; without it the command runs at
// once. A play that checks (a smoke play, a Firefox play for crashes, a recording) is a job of type page-play asking
// "auto" GPU memory for --model (the game's name: the queue sizes the ask from that game's last runs, plus a margin,
// and a first run asks 2 GiB; a page holds under 1), so it runs beside other jobs. --measure files it as page-measure asking more memory
// than the GPU has, so it runs alone on the GPU, as the one-page-at-a-time rule asks of a play whose numbers are the
// result; in Xvfb every present is copied on the CPU, which paces the page, so a play here measures no page
// (docs/playing.md). The host memory each asks is the container's own cap (its docker run's --memory, read from its
// cgroup), so what the queue reserves is what the play can hold, never the queue's 8 GiB for a game it hasn't measured;
// with no cap it is the queue's reading of the game's last runs. The cores are capped by the docker run (--cpus). Both
// are --priority (low) and linked to --url. A stop the queue asks for ends the play, and this, with 75.
//
// Where the command records a run (play_page's --record <file>) and gives no --host-reading, the line it appended is
// given one from the queue's account of the job once it ends: gpuOthers, the jobs that ran on the GPU beside it, and
// building, true where a job that asked no GPU memory (a build, a check on the CPU) did. play_page.mjs then compares
// later runs only with runs that had neither. The command's exit code is this one's.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const split = args.indexOf('--');
if (split < 0 || split === args.length - 1) {
  console.error('play_job: node tools/play_job.mjs [--queue <module> --model <game>] [--measure] [--priority low] [--url <url>] -- <command> [args...]');
  process.exit(3);
}
const own = args.slice(0, split), command = args.slice(split + 1);
const opt = (name, def) => { const i = own.indexOf(name); return i < 0 ? def : own[i + 1]; };
const measure = own.includes('--measure');
const queue = opt('--queue'), model = opt('--model');
if (queue && !model) { console.error('play_job: --model <game> is required with --queue'); process.exit(3); }

// The X server Firefox's window goes to, larger than any size a play asks for, and the sound device that plays
// nowhere. Each is ended when this ends.
const display = ':99';
const xvfb = spawn('Xvfb', [display, '-screen', '0', '3840x2160x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
const runtime = fs.mkdtempSync('/tmp/play-job-');
const env = { ...process.env, DISPLAY: display, XDG_RUNTIME_DIR: runtime };
try {
  execFileSync('pulseaudio', ['--start', '--exit-idle-time=-1', '--load=module-null-sink sink_name=null'], { env, stdio: 'ignore' });
} catch { console.log('play_job: no PulseAudio, the browsers play their sound to no device'); }
process.on('exit', () => { xvfb.kill(); try { execFileSync('pulseaudio', ['--kill'], { env, stdio: 'ignore' }); } catch { /* gone */ } });

const recordAt = command.indexOf('--record');
const recordFile = recordAt >= 0 && !command.includes('--host-reading') ? command[recordAt + 1] : null;
const linesBefore = recordFile && fs.existsSync(recordFile) ? fs.readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).length : 0;

// The command, in a process group of its own so a stop ends the browser it started too.
const play = (signal) => new Promise((resolve) => {
  const proc = spawn(command[0], command.slice(1), { env, stdio: 'inherit', detached: true });
  const stop = () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* gone */ } };
  signal?.addEventListener('abort', () => {
    console.log(`play_job: the queue asked it to stop (${signal.reason?.message ?? signal.reason}), ending the play`);
    stop();
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } }, 10000).unref();
  }, { once: true });
  proc.on('exit', (code, sig) => resolve(signal?.aborted ? 75 : code ?? (sig ? 128 + os.constants.signals[sig] : 1)));
});

// The container's memory cap in MiB (cgroup v2's memory.max), null when it has none.
function capMiB() {
  try {
    const max = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    return /^\d+$/.test(max) ? Math.ceil(Number(max) / 1048576) : null;
  } catch { return null; }
}

let code, job = null;
if (!queue) code = await play(null);
else {
  const { gpuRun, GPUQ_BASE } = await import(pathToFileURL(queue).href);
  let said = 0;
  code = await gpuRun({
    type: measure ? 'page-measure' : 'page-play', label: measure ? 'Page play, measured alone' : 'Page play',
    vramMiB: measure ? 32768 : 'auto', ...(measure ? {} : { guessMiB: 2048 }), model, ramMiB: capMiB(),
    priority: opt('--priority', 'low'), url: opt('--url') || null, ref: os.hostname(),
    onUpdate: (j) => {
      job = j;
      if (j.state === 'waiting' && Date.now() - said > 60000) {
        said = Date.now();
        console.log(`play_job: waiting for the GPU, ${j.ahead ?? '?'} ahead${j.waitMs != null ? `, ~${Math.ceil(j.waitMs / 60000)} min` : ''}${j.why?.text ? `: ${j.why.text}` : ''}`);
      }
    },
  }, async (signal, j) => {
    job = j;
    console.log(`play_job: job ${j.id} running, asking ${j.vramMiB ?? 'the whole GPU'} MiB of the GPU and ${j.ramMiB} MiB of the host`);
    const c = await play(signal);
    if (c === 75) throw Object.assign(new Error('stopped by the queue'), { code: 75 });
    return c;
  }).catch((e) => { console.log(`play_job: ${e.message}`); return e.code === 75 || e.name === 'AbortError' ? 75 : 1; });
  // The queue's account of the job once it ended: what ran beside it the whole time.
  if (job) {
    try {
      const base = (process.env.GPU_QUEUE_URL || GPUQ_BASE).replace(/\/+$/, '');
      const r = await fetch(`${base}/jobs/${job.id}`, { headers: { authorization: `Bearer ${process.env.GPU_QUEUE_KEY}` } });
      if (r.ok) job = await r.json();
    } catch { /* the last answer it gave will do */ }
  }
}

// The run's line, given what ran beside it.
if (recordFile && job?.run && fs.existsSync(recordFile)) {
  const lines = fs.readFileSync(recordFile, 'utf8').split('\n').filter(Boolean);
  const beside = (job.run.beside ?? []).filter((b) => !b.warm);
  const hostReading = { gpuOthers: beside.filter((b) => b.vramMiB !== 0).length, building: beside.some((b) => b.vramMiB === 0) };
  console.log(`play_job: ran ${Math.round(job.run.ranMs / 1000)} s, ${Math.round(job.run.aloneMs / 1000)} s of it alone on the GPU; ` +
    `beside it: ${Object.entries(Object.groupBy(beside, (b) => b.type)).map(([t, l]) => `${l.length} ${t}`).join(', ') || 'nothing'}`);
  for (let i = linesBefore; i < lines.length; i++) {
    try { lines[i] = JSON.stringify({ ...JSON.parse(lines[i]), hostReading }); } catch { /* not a run */ }
  }
  fs.writeFileSync(recordFile, lines.join('\n') + '\n');
}
process.exit(code);
