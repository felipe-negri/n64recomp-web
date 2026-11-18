// Checks the sound a recomp's desktop build played through a plan, from the recording tools/sdl_audio_record.c makes
// beside a frame dump (tools/frame_dump.mjs): <dir>/sound.tsv and sound.raw, every buffer the game queued with its
// time, and steps.tsv, the times of the plan's steps.
//
//   node tools/sound_check.mjs <dir> [--reference <dir>] [--from <s>] [--to <s>]
//
// It checks what the game played against the recording of the same plan by a build whose sound is right (a release a
// person has listened to, a fixed build), given as --reference: second by second, in bands a twelfth of an octave
// wide (narrow enough for one effect's tone to stand out of a mix with music in it). A sound left playing after its
// scene (a stuck or looping effect) shows as a band louder than the reference's, and a missing channel or effect as
// one quieter. A recording holds no other way to tell either from the game's own sound: a tone that holds its pitch
// for seconds flagged the music's held notes in every recording of Rush 2049 and Mario Golf, as much as a stuck squeal.
//
// The two runs are lined up by the plan's steps, each moment counted from the step before it (a step that waits for
// the game moves the steps after it). A band at a moment is louder by how far it is over everything the reference
// played in that band within half a second either way, and quieter by how far under all of it, so the small
// differences in timing between two runs read as nothing; louder only where it is 40 dB over the quietest either run
// plays in that band, quieter only where the reference is. It fails where a band is 3 dB or more louder or quieter
// through 4 s (the median of its windows, a quarter of a second apart). Rush 2049, by a plan that drives into a race,
// skids, holds Rewind with the skid held, lets go, drives on and pauses, two runs of the same build differ by 1.1 dB at
// the most (v0.1.31 and v0.1.36, each against its other run, both ways), and a build with a known fault fails against
// both runs of its fix: v0.1.30, whose tire squeal started while Rewind was held kept playing until the race ended
// (fixed in v0.1.31), by 6.2-6.6 dB at 1.35 kHz in the seconds after Rewind is let go, and v0.1.35, whose squeal kept
// playing while Rewind was held (fixed in v0.1.36), by 4.4-5.1 dB at 1.35 kHz through the rewind. v0.1.31 against
// v0.1.36 fails there too, by 4.6 dB: it has v0.1.35's fault. No build with a known missing sound has been recorded,
// so the quieter side has only been seen as the mirror of these (v0.1.36 against v0.1.31 is quieter by 5.3 dB).
//
// A run whose game fell behind real time can't be compared: the plan's keys, timed on the host's clock, then met its
// race at other moments than the reference's, and on a busy host Rush 2049's v0.1.30 failed against its own run on
// an idle host in 19 bands, through the half minute after the first gap. So where the queue ran dry more than
// MAX_GAPS times (the game queued too little sound to keep up; a run on an idle host ran dry at most once, as a
// level loads, and that run 15 times) in either run, it says so and checks nothing.
//
// It also prints how much sound was queued before each buffer (least, median, most: how far behind the game it was
// heard) and the buffers queued onto an empty queue (a gap), but fails on neither: a busy host runs any queue dry, and
// whether a game's sound keeps pace with a sound card is a sound card's to show. Mario Golf v0.1.2, whose queue grew
// past queue_samples' 100 ms catch-up on players' sound cards so that it cut samples and crackled (fixed in v0.1.3),
// held 22-34 ms on the recorder's device, as v0.1.3 held 0-54. Without --reference this reading is all it prints.
// --from (5 s, past a boot's first loads) and --to keep what is checked between those seconds.
//
// Exit: 0 passes, 1 fails, 2 nothing to check (no recording, a program that queued no sound, no --reference, or one
// whose plan played other steps).
import fs from 'node:fs';
import path from 'node:path';

const HOP = 0.25; // seconds between the band levels' windows
const NEAR = 0.5; // seconds either way of the reference's moment a level is compared with
const PER_OCTAVE = 12; // bands an octave
const DIFF_DB = 3; // how much louder or quieter than the reference a band fails at
const HOLD_S = 4; // ... through this many seconds
const RANGE_DB = 40; // ... in sound at least this far above the quietest the two play in that band
const MAX_GAPS = 3; // times either run's queue may run dry before the two can't be compared

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

// The queue: how far behind the game its sound was heard, and its gaps.
{
  const kept = run.buffers.filter((b) => b.t >= from && b.t <= to);
  const q = kept.map((b) => b.queued * 1000).sort((a, b) => a - b);
  const dry = kept.filter((b, i) => i > 0 && b.queued === 0);
  console.log(`sound: ${run.freq} Hz, ${run.channels} channels, ${kept.length} buffers from ${from} s to ${s1(Math.min(to, run.buffers.at(-1).t))} s, ` +
    `queued ${q[0]?.toFixed(0)} / ${q[q.length >> 1]?.toFixed(0)} / ${q.at(-1)?.toFixed(0)} ms before them (least / median / most)` +
    (dry.length ? `, ${dry.length} onto an empty queue, at ${dry.slice(0, 8).map((b) => s1(b.t)).join(' ')}${dry.length > 8 ? ' ...' : ''} s` : ''));
}

// Band levels: dB in bands PER_OCTAVE to an octave, a window every HOP seconds.
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
for (let f = 100; f <= 12500; f *= 2 ** (1 / PER_OCTAVE)) BANDS.push(f);
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
      const f = b * r.freq / n, band = Math.floor(Math.log2(f / 100) * PER_OCTAVE + 0.5);
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
  for (const r of [run, ref]) {
    const gaps = r.buffers.filter((b, i) => i > 0 && b.t >= from && b.t <= to && b.queued === 0).length;
    if (gaps > MAX_GAPS) {
      console.log(`sound against the reference: ${r === run ? 'this run' : 'the reference'}'s queue ran dry ${gaps} times, so ` +
        "its game fell behind real time (a busy host) and the plan's keys met it at other moments: record it again on an idle host");
      process.exit(2);
    }
  }
  // A moment of the run, on the reference's clock: as long after the same step.
  const onRef = (t) => {
    let i = 0;
    while (i + 1 < run.steps.length && run.steps[i + 1].t <= t) i++;
    return ref.steps[i].t + (t - run.steps[i].t);
  };
  const a = levels(run), b = levels(ref);
  const floor = BANDS.map((_, j) => Math.min(...a.map((w) => w.db[j]), ...b.map((w) => w.db[j])));
  // Each band's excess at each window: how far over everything the reference played near that moment it is (louder),
  // or under all of it (quieter), where the louder side is RANGE_DB over the band's quietest; then its median over
  // every HOLD_S seconds, the worst of which is the band's.
  const n = Math.round(HOLD_S / HOP), worst = [];
  for (const [j, f] of BANDS.entries()) {
    const ex = { louder: [], quieter: [] };
    for (const w of a) {
      const near = w.t >= from && w.t <= to ? b.filter((x) => Math.abs(x.t - onRef(w.t)) <= NEAR).map((x) => x.db[j]) : [];
      const hi = near.length ? Math.max(...near) : NaN, lo = near.length ? Math.min(...near) : NaN;
      ex.louder.push({ t: w.t, e: near.length && w.db[j] >= floor[j] + RANGE_DB ? w.db[j] - hi : -Infinity });
      ex.quieter.push({ t: w.t, e: near.length && lo >= floor[j] + RANGE_DB ? lo - w.db[j] : -Infinity });
    }
    for (const kind of ['louder', 'quieter']) {
      const e = ex[kind];
      let top = { e: -Infinity };
      for (let k = 0; k + n <= e.length; k++) {
        const m = e.slice(k, k + n).map((x) => x.e).sort((x, y) => x - y)[n >> 1];
        if (m > top.e) top = { e: m, t0: e[k].t, t1: e[k + n - 1].t };
      }
      worst.push({ kind, f, ...top });
    }
  }
  worst.sort((x, y) => y.e - x.e);
  const hz = (f) => f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`;
  const bad = worst.filter((x) => x.e >= DIFF_DB);
  const say = (x) => `${x.kind} at ${hz(x.f)} from ${s1(x.t0)} to ${s1(x.t1)} s, by ${x.e.toFixed(1)} dB`;
  if (bad.length) {
    failed = true;
    console.log(`sound against ${ref.dir}: FAILS, ${bad.length} bands ${DIFF_DB} dB or more louder or quieter through ${HOLD_S} s:`);
    for (const x of bad.slice(0, 12)) console.log(`  ${say(x)}`);
  } else console.log(`sound against ${ref.dir}: passes, the most a band differs through ${HOLD_S} s: ${say(worst[0])}`);
} else {
  console.log('sound: no --reference to check it against');
  process.exit(2);
}
process.exit(failed ? 1 : 0);
