// Checks the sound a recomp's desktop build played through a plan, from the recording tools/sdl_audio_record.c makes
// beside a frame dump (tools/frame_dump.mjs): <dir>/sound.tsv and sound.raw, every buffer the game queued with its
// time, and steps.tsv, the times of the plan's steps.
//
//   node tools/sound_check.mjs <dir> [--reference <dir>] [--from <s>] [--to <s>]
//
// - Behind the picture: each buffer is heard once the sound queued before it has played, so a queue that grows is
//   sound that runs behind the picture by as much, and past 100 ms queue_samples' catch-up (in the recomps that have
//   it) drops every other sample of a buffer to make it up, a click with no gap in it. The recording's device plays
//   in real time, as a sound card does (sdl_audio_record.c says why it isn't SDL's), so this reads what a player
//   hears. It fails where a buffer is queued with 100 ms or more queued before it after --from (5 s: a boot's first
//   loads). Mario Golf v0.1.2, whose sound library made 552 samples a retrace where 533 play, crackled about four times
//   a second on players' machines (fixed in v0.1.3); its recording fails here and v0.1.3's passes. Buffers queued
//   onto an empty queue (the device playing nothing meanwhile, a gap) are counted and their first times listed, but
//   don't fail: a game below full speed on a busy host runs any queue dry (docs/new-recomp.md's 6c measures that on
//   the sound device, on a quiet host).
// - Against a reference: with --reference, the recording of the same plan by a build whose sound is right (a release
//   a person has listened to, a fixed build), what the game played second by second in third-octave bands. A sound
//   left playing after its scene (a stuck or looping effect) shows as a band louder than the reference's for seconds
//   on end, and a missing channel or effect as one quieter. The two are lined up by the plan's steps (each moment
//   counted from the step before it, since a step that waits for the game moves the steps after it), and a band only
//   counts as louder where it is above everything the reference played in it within half a second either way, by 6 dB
//   or more, and quieter where it is under all of it by as much, so a race's small differences in timing from run to
//   run read as nothing. It fails where a band stays louder or quieter for 3 s or more, in sound at least 40 dB above
//   the quietest the two play in that band. Rush 2049 v0.1.30 left a tire squeal playing after a skid that started
//   while Rewind was held, until the race ended (fixed in v0.1.31); a plan that skids, rewinds, lets go and drives on
//   fails v0.1.30 against v0.1.31 and passes a second run of v0.1.31 against the first.
//
// Exit: 0 passes, 1 fails, 2 nothing to check (no recording, or a program that queued no sound).
import fs from 'node:fs';
import path from 'node:path';

const LAG_MS = 100; // sound queued before a buffer at which it fails (queue_samples' catch-up)
const HOP = 0.25; // seconds between the band levels' windows
const NEAR = 0.5; // seconds either way of the reference's moment a level is compared with
const DIFF_DB = 6; // how much louder or quieter than the reference a band counts as different
const HOLD_S = 3; // how long a band stays different for it to fail
const RANGE_DB = 40; // ... in sound at least this far above the quietest the two play in that band

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
if (!args[0] || args[0].startsWith('--')) {
  console.error('usage: node tools/sound_check.mjs <dir> [--reference <dir>] [--from <s>] [--to <s>]');
  process.exit(2);
}
const from = Number(opt('--from', 5)), to = Number(opt('--to', Infinity));

// A run's recording: its format, its buffers ({ t: seconds since the program started, queued: seconds queued before
// it, frames }), the plan's steps ({ t, kind }) and its sound as heard, one channel (the channels' mean) on the
// device's clock: each buffer where the one before it ended, or at its own time where the queue had run dry.
function readRun(dir) {
  const tsv = path.join(dir, 'sound.tsv');
  if (!fs.existsSync(tsv)) return { error: `no recording in ${dir}` };
  const lines = fs.readFileSync(tsv, 'utf8').split('\n').filter(Boolean);
  const open = lines.find((l) => l.startsWith('# open'));
  if (!open) return { error: 'the program opened no sound device through SDL_OpenAudioDevice, so nothing was recorded' };
  const [freq, channels, format] = open.split(' ').slice(2).map(Number);
  if (format !== 0x8120 && format !== 0x8010) return { error: `samples in SDL format 0x${format.toString(16)}, which this doesn't read` };
  const bytes = (format & 0xff) / 8, bpf = bytes * channels;
  const steps = fs.readFileSync(path.join(dir, 'steps.tsv'), 'utf8').split('\n').filter(Boolean)
    .map((l) => { const [ms, s] = l.split('\t'); return { ms: Number(ms), kind: s.split(' ')[0] }; });
  const start = steps[0].ms / 1000;
  const raw = fs.readFileSync(path.join(dir, 'sound.raw'));
  const buffers = [];
  let at = 0;
  for (const l of lines) {
    if (l.startsWith('#')) continue;
    const [us, len, queued] = l.split(' ').map(Number);
    buffers.push({ t: us / 1e6 - start, queued: queued / bpf / freq, frames: Math.floor(len / bpf), at });
    at += len;
  }
  if (!buffers.length) return { error: 'the program queued no sound' };
  const last = buffers[buffers.length - 1];
  const heard = new Float32Array(Math.ceil((last.t + last.queued) * freq) + last.frames);
  for (const b of buffers) {
    const i0 = Math.round((b.t + b.queued) * freq);
    if (i0 < 0) continue;
    for (let i = 0; i < b.frames && i0 + i < heard.length; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) {
        const o = b.at + (i * channels + c) * bytes;
        s += format === 0x8120 ? raw.readFloatLE(o) : raw.readInt16LE(o) / 32768;
      }
      heard[i0 + i] = s / channels;
    }
  }
  return { dir, freq, channels, buffers, heard, steps: steps.map((s) => ({ t: s.ms / 1000 - start, kind: s.kind })) };
}

const run = readRun(path.resolve(args[0]));
if (run.error) { console.log(`sound: ${run.error}`); process.exit(2); }
let failed = false;
const s1 = (x) => x.toFixed(1);

// Behind the picture.
{
  const kept = run.buffers.filter((b) => b.t >= from && b.t <= to);
  const q = kept.map((b) => b.queued * 1000).sort((a, b) => a - b);
  const behind = kept.filter((b) => b.queued * 1000 >= LAG_MS);
  let sounding = false;
  const dry = [];
  for (const b of run.buffers) {
    if (b.t >= from && b.t <= to && sounding && b.queued === 0) dry.push(b);
    sounding ||= b.t >= from;
  }
  console.log(`sound: ${run.freq} Hz, ${run.channels} channels, ${kept.length} buffers from ${from} s to ${s1(Math.min(to, run.buffers.at(-1).t))} s, ` +
    `queued ${q[0]?.toFixed(0)} / ${q[q.length >> 1]?.toFixed(0)} / ${q.at(-1)?.toFixed(0)} ms before them (least / median / most)`);
  const times = (bs) => bs.slice(0, 8).map((b) => s1(b.t)).join(' ') + (bs.length > 8 ? ' ...' : '') + ' s';
  if (behind.length) {
    failed = true;
    console.log(`sound behind the picture: FAILS, ${behind.length} of ${kept.length} buffers queued with ${LAG_MS} ms or more before them, at ${times(behind)}`);
  } else console.log(`sound behind the picture: passes, no buffer queued with ${LAG_MS} ms before it`);
  if (dry.length) console.log(`sound gaps: ${dry.length} buffers queued onto an empty queue, at ${times(dry)} (not failed: a busy host runs any queue dry)`);
}

// Band levels: dB in third-octave bands, a window every HOP seconds.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
const BANDS = [];
for (let f = 100; f <= 12500; f *= 2 ** (1 / 3)) BANDS.push(f);
function levels(r) {
  const n = 1 << Math.round(Math.log2(r.freq * 2 * HOP)); // about two hops long
  const win = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  const out = [];
  for (let k = 0; (k * HOP) * r.freq + n <= r.heard.length; k++) {
    const i0 = Math.round(k * HOP * r.freq), re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = r.heard[i0 + i] * win[i];
    fft(re, im);
    const p = BANDS.map(() => 0);
    for (let b = 1; b < n / 2; b++) {
      const f = b * r.freq / n, band = Math.floor(Math.log2(f / 100) * 3 + 0.5);
      if (band >= 0 && band < BANDS.length) p[band] += re[b] * re[b] + im[b] * im[b];
    }
    out.push({ t: (i0 + n / 2) / r.freq, db: p.map((v) => 10 * Math.log10(v / n + 1e-12)) });
  }
  return out;
}

// Against a reference.
if (opt('--reference')) {
  const ref = readRun(path.resolve(opt('--reference')));
  if (ref.error) { console.log(`sound against the reference: ${ref.error}`); process.exit(2); }
  const kinds = (r) => r.steps.map((s) => s.kind).join(' ');
  if (kinds(run) !== kinds(ref)) {
    console.log('sound against the reference: the two runs played different steps (a different plan, or one failed), so they don\'t line up');
    process.exit(2);
  }
  // A moment of the run, on the reference's clock: as long after the same step.
  const onRef = (t) => {
    let i = 0;
    while (i + 1 < run.steps.length && run.steps[i + 1].t <= t) i++;
    return ref.steps[i].t + (t - run.steps[i].t);
  };
  const a = levels(run), b = levels(ref);
  const floor = BANDS.map((_, j) => Math.min(...a.map((w) => w.db[j]), ...b.map((w) => w.db[j])));
  const found = [];
  for (const [j, f] of BANDS.entries()) {
    let streak = null;
    const close = (end) => {
      if (streak && end - streak.t0 >= HOLD_S) found.push({ ...streak, t1: end, f });
      streak = null;
    };
    for (const w of a) {
      if (w.t < from || w.t > to) { close(w.t); continue; }
      const rt = onRef(w.t);
      const near = b.filter((x) => Math.abs(x.t - rt) <= NEAR).map((x) => x.db[j]);
      if (!near.length) { close(w.t); continue; }
      const hi = Math.max(...near), lo = Math.min(...near);
      const kind = w.db[j] >= hi + DIFF_DB && w.db[j] >= floor[j] + RANGE_DB ? 'louder' :
        w.db[j] <= lo - DIFF_DB && lo >= floor[j] + RANGE_DB ? 'quieter' : null;
      if (kind && streak?.kind === kind) { streak.most = Math.max(streak.most, Math.abs(kind === 'louder' ? w.db[j] - hi : lo - w.db[j])); continue; }
      close(w.t);
      if (kind) streak = { kind, t0: w.t, most: Math.abs(kind === 'louder' ? w.db[j] - hi : lo - w.db[j]) };
    }
    close(Math.min(to, a.at(-1).t + HOP));
  }
  found.sort((x, y) => x.t0 - y.t0);
  const hz = (f) => f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`;
  if (found.length) {
    failed = true;
    console.log(`sound against ${ref.dir}: FAILS, ${found.length} bands ${DIFF_DB} dB or more louder or quieter for ${HOLD_S} s or more:`);
    for (const x of found) console.log(`  ${x.kind} at ${hz(x.f)} from ${s1(x.t0)} to ${s1(x.t1)} s, by up to ${x.most.toFixed(0)} dB`);
  } else console.log(`sound against ${ref.dir}: passes, no band ${DIFF_DB} dB louder or quieter for ${HOLD_S} s`);
}
process.exit(failed ? 1 : 0);
