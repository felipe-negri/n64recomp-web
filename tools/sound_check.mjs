// sound_check draft: reads a run's recording (tools/sdl_audio_record.c) and prints what it holds. Header to come.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const dir = path.resolve(args[0]);

export function readRecording(dir) {
  const lines = fs.readFileSync(path.join(dir, 'sound.tsv'), 'utf8').split('\n').filter(Boolean);
  const open = lines.find((l) => l.startsWith('# open'));
  if (!open) throw new Error('the recording has no "# open" line: the program opened no sound device through SDL_OpenAudioDevice');
  const [, , freq, channels, format] = open.split(' ').map(Number);
  const bytes = (format & 0xff) / 8, bpf = bytes * channels;
  const raw = fs.readFileSync(path.join(dir, 'sound.raw'));
  const buffers = [];
  let at = 0;
  for (const l of lines) {
    if (l.startsWith('#')) continue;
    const [us, len, queued] = l.split(' ').map(Number);
    const frames = Math.floor(len / bpf);
    const peak = new Float32Array(frames);
    const data = new Float32Array(frames * channels);
    for (let i = 0; i < frames * channels; i++) {
      const o = at + i * bytes;
      data[i] = format === 0x8120 ? raw.readFloatLE(o) : format === 0x8010 ? raw.readInt16LE(o) / 32768 : 0;
    }
    buffers.push({ us, frames, queued: queued / bpf, data, start: at, len });
    at += len;
  }
  const steps = fs.existsSync(path.join(dir, 'steps.tsv')) ?
    fs.readFileSync(path.join(dir, 'steps.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => {
      const [ms, s] = l.split('\t'); return { ms: Number(ms), words: s.split(' ') };
    }) : [];
  return { freq, channels, format, buffers, steps, raw };
}

const r = readRecording(dir);
const t0 = r.steps[0]?.ms ?? r.buffers[0].us / 1000;
console.log(`${r.freq} Hz, ${r.channels} ch, format 0x${r.format.toString(16)}, ${r.buffers.length} buffers`);
// Per second: frames queued, queued ms (min/max), rms dB, peak, buffers.
const sec = new Map();
for (const b of r.buffers) {
  const t = Math.floor((b.us / 1000 - t0) / 1000);
  const s = sec.get(t) ?? { n: 0, frames: 0, qmin: 1e9, qmax: 0, sum: 0, cnt: 0, peak: 0, lens: new Map() };
  s.n++; s.frames += b.frames; s.qmin = Math.min(s.qmin, b.queued); s.qmax = Math.max(s.qmax, b.queued);
  for (const v of b.data) { s.sum += v * v; s.cnt++; s.peak = Math.max(s.peak, Math.abs(v)); }
  s.lens.set(b.frames, (s.lens.get(b.frames) ?? 0) + 1);
  sec.set(t, s);
}
for (const [t, s] of [...sec].sort((a, b) => a[0] - b[0])) {
  const db = 10 * Math.log10(s.sum / Math.max(1, s.cnt) + 1e-12);
  console.log(`${String(t).padStart(4)} s  ${String(s.n).padStart(3)} bufs ${String(s.frames).padStart(6)} frames  queued ${(s.qmin * 1000 / r.freq).toFixed(0)}-${(s.qmax * 1000 / r.freq).toFixed(0)} ms  rms ${db.toFixed(1)} dB  peak ${s.peak.toFixed(3)}  lens ${[...s.lens].map(([k, v]) => `${k}x${v}`).join(',')}`);
}
for (const st of r.steps) console.log(`step ${((st.ms - t0) / 1000).toFixed(1)} ${st.words.join(' ')}`);
