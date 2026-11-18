// Holds a recomp's 4:3 picture against a console's, frame by frame: a dump of the recomp (RT64_FRAME_DUMP, made by
// tools/frame_dump.mjs at a 4:3 window, Original resolution and Original framerate, with --watch on the game's frame
// counter) against tools/console_ref.c's of the same plan (the ROM in mupen64plus-next with Angrylion's RDP). What a
// recomp draws wrongly at every setting (a model drawn black, water or shadows drawn otherwise) never shows when a
// recomp is checked only against itself; against the console it does.
//
//   node tools/console_check.mjs <dump dir> <console dir> [--watch <file>] [--counter <n>] [--calibrate <from>-<to>]
//       [--from <s>] [--to <s>] [--threshold <t>] [--cluster <tiles>] [--run <frames>] [--save <dir>]
//
// <dump dir> holds the recomp's frames.bin (its watch.tsv is --watch, by default the one beside the dump's folder, as
// frame_dump writes it), <console dir> console_ref's frames.bin and watch.tsv. --counter is the column of the game's
// frame counter among the watched words (0); the other columns are compared too, at each frame counter both runs
// reached: a word that differs there (a random number generator's state) says the game's random numbers depend on
// more than its frames and inputs, and the two runs may drift apart from there.
//
// Pairing. A frame's time says little: the recomp's run started its game at another moment and its keys landed some
// milliseconds into a game frame, not on one. So each frame takes the game's frame counter at its time, and each of
// the recomp's own frames (one that differs from the frame before) is paired with the console's frame most like it
// among those within a few counts of its own, plus the offset the last pairs found (a key a frame later shifts the
// rest of the plan by one), searched wider at the start and wherever nothing near is alike.
//
// Comparison. The console's picture (Angrylion's VI output, borders and all) and the recomp's (RT64's VI box) differ
// in place and size by a few pixels, so where the recomp's picture lies in the console's is found once, from the
// first pairs. Both are then brought to tiles of 4x4 of the recomp's pixels, each tile's colour its mean: RT64
// filters, dithers and antialiases differently, so single pixels never agree. A tile's difference is the smallest of
// its mean RGB difference to the console's tile in its place or one tile beside it, which a pixel of misplacement or
// of motion between pairs doesn't reach. A frame is unlike the console's where tiles over --threshold touch in a
// cluster of --cluster or more (12, about a 14x14-pixel thing at 320x240), and a scene fails where --run (3) or more
// such frames come with none alike between them for longer than 0.2 s.
//
// --calibrate gives seconds of the recomp's dump (from its first frame) known to be drawn right, which set the noise
// floor: --threshold is then 1.5 times the 99.9th centile of the tiles' differences there, at least 16, unless given
// (by default 24). --from and --to keep what came between those seconds of the dump. --save writes each failing
// scene's worst frame as a PNG: the recomp's, the console's in the same place, and the tiles over the threshold in red.
//
// Exit: 0 passes, 1 fails, 2 nothing to compare (no frames, no counter in a watch.tsv).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (positional.length < 2) { console.error('console_check: <dump dir> <console dir> (the header says how)'); process.exit(2); }
const [dumpDir, refDir] = positional.map((p) => path.resolve(p));
const counterCol = Number(opt('--counter', 0));
const from = Number(opt('--from', 0)), to = Number(opt('--to', 1e9));
const clusterMin = Number(opt('--cluster', 12)), runMin = Number(opt('--run', 3));
const saveDir = opt('--save');
const T = 4; // a tile is T x T of the recomp's pixels

// frames.bin: a 40-byte header (magic, width, height, index, count, dropped, presentId, timeMs) and 8-bit RGB.
function frameIndex(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, h = Buffer.alloc(40), frames = [];
  for (let o = 0; o + 40 <= size;) {
    fs.readSync(fd, h, 0, 40, o);
    if (h.readUInt32LE(0) !== 0x44465452) throw new Error(`${file}: no frame at ${o}`);
    const w = h.readUInt32LE(4), ht = h.readUInt32LE(8);
    frames.push({ fd, at: o + 40, w, h: ht, time: Number(h.readBigUInt64LE(32)) });
    o += 40 + w * ht * 3;
  }
  return frames;
}
const pixels = (f) => { const b = Buffer.alloc(f.w * f.h * 3); fs.readSync(f.fd, b, 0, b.length, f.at); return b; };

// watch.tsv: "<ms>\t<word>..." as each changed.
function readWatch(file) {
  if (!fs.existsSync(file)) return null;
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'))
    .map(([t, ...w]) => ({ t: Number(t), w: w.map((x) => parseInt(x, 16) >>> 0) }));
  return rows.length ? rows : null;
}
const at = (rows, t) => { // the row in force at time t
  let lo = 0, hi = rows.length - 1;
  if (t < rows[0].t) return null;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rows[m].t <= t) lo = m; else hi = m - 1; }
  return rows[lo];
};

const dumpFrames = frameIndex(path.join(dumpDir, 'frames.bin'));
const refFrames = frameIndex(path.join(refDir, 'frames.bin'));
const dumpWatch = readWatch(opt('--watch', path.join(path.dirname(dumpDir), 'watch.tsv')));
const refWatch = readWatch(path.join(refDir, 'watch.tsv'));
if (!dumpFrames.length || !refFrames.length || !dumpWatch || !refWatch) {
  console.log(`console_check: nothing to compare (${dumpFrames.length} recomp frames, ${refFrames.length} console frames, ` +
    `${dumpWatch ? '' : 'no recomp watch.tsv, '}${refWatch ? '' : 'no console watch.tsv'})`);
  process.exit(2);
}

// The other watched words, at each count both reached: do the game's random numbers follow its frames and inputs?
{
  const first = (rows) => { const m = new Map(); for (const r of rows) if (!m.has(r.w[counterCol])) m.set(r.w[counterCol], r.w); return m; };
  const a = first(dumpWatch), b = first(refWatch);
  for (let c = 0; c < dumpWatch[0].w.length; c++) {
    if (c === counterCol) continue;
    let same = 0, n = 0, firstDiff = null;
    for (const [count, w] of a) {
      const v = b.get(count);
      if (!v) continue;
      n++;
      if (v[c] === w[c]) same++; else firstDiff ??= `count ${count}: recomp ${w[c].toString(16).toUpperCase()}, console ${v[c].toString(16).toUpperCase()}`;
    }
    console.log(`watched word ${c}: the same at ${same} of the ${n} counts both runs reached` + (firstDiff ? `, first apart at ${firstDiff}` : ''));
  }
}

// The recomp's own frames (each unlike the one before) in --from..--to, with their counts.
const t0 = dumpFrames[0].time;
const rec = [];
{
  let last = '';
  for (const f of dumpFrames) {
    const s = (f.time - t0) / 1000;
    if (s < from || s > to) continue;
    const px = pixels(f), hash = crypto.createHash('md5').update(px).digest('hex');
    if (hash === last) continue;
    last = hash;
    const r = at(dumpWatch, f.time);
    if (r) rec.push({ f, s, count: r.w[counterCol] });
  }
}
const ref = refFrames.map((f) => ({ f, count: at(refWatch, f.time)?.w[counterCol] ?? -1 })).filter((r) => r.count >= 0);
const W = rec[0]?.f.w, H = rec[0]?.f.h;
if (!rec.length) { console.log('console_check: no recomp frames with a count'); process.exit(2); }
const RW = refFrames[0].w, RH = refFrames[0].h;
const TW = Math.floor(W / T), TH = Math.floor(H / T);
console.log(`console_check: ${rec.length} of the recomp's own frames (${W}x${H}) against ${ref.length} of the console's (${RW}x${RH})`);

// The console's frames by count.
const byCount = new Map();
for (const r of ref) { if (!byCount.has(r.count)) byCount.set(r.count, []); byCount.get(r.count).push(r); }
const near = (count, off, reach) => {
  const out = [];
  for (let c = count + off - reach; c <= count + off + reach; c++) for (const r of byCount.get(c) ?? []) out.push(r);
  return out;
};

// Small thumbnails for the first pairing, before the geometry is known: the whole of each picture at 32x24.
const thumb = (px, w, h) => {
  const o = new Float32Array(32 * 24 * 3);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) for (let c = 0; c < 3; c++) {
    let s = 0, n = 0;
    for (let yy = Math.floor(y * h / 24); yy < Math.floor((y + 1) * h / 24); yy++)
      for (let xx = Math.floor(x * w / 32); xx < Math.floor((x + 1) * w / 32); xx++) { s += px[(yy * w + xx) * 3 + c]; n++; }
    o[(y * 32 + x) * 3 + c] = s / Math.max(n, 1);
  }
  return o;
};
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const cache = new Map();
const refPixels = (r) => { if (!cache.has(r)) { if (cache.size > 64) cache.delete(cache.keys().next().value); cache.set(r, pixels(r.f)); } return cache.get(r); };

// Where the recomp's picture lies in the console's: x' = ox + x * sx, y' = oy + y * sy, from the first pairs.
const sample = (px, w, h, x, y, c) => {
  x = Math.min(Math.max(x, 0), w - 1.001); y = Math.min(Math.max(y, 0), h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = (y0 * w + x0) * 3 + c;
  return (px[i] * (1 - fx) + px[i + 3] * fx) * (1 - fy) + (px[i + w * 3] * (1 - fx) + px[i + w * 3 + 3] * fx) * fy;
};
let geo = { ox: 0, oy: 0, sx: RW / W, sy: RH / H };
{
  const pairs = [];
  let off = 0;
  const step = Math.max(1, Math.floor(rec.length / 40));
  for (let i = 0; i < rec.length && pairs.length < 24; i += step) {
    const a = thumb(pixels(rec[i].f), W, H);
    let best = null;
    for (const r of near(rec[i].count, off, 12)) {
      const d = dist(a, thumb(refPixels(r), RW, RH));
      if (!best || d < best.d) best = { d, r };
    }
    // a picture with something to place by: not a black or flat screen
    let spread = 0; for (let k = 3; k < a.length; k++) spread += Math.abs(a[k] - a[k - 3]);
    if (best && spread / a.length > 2) { pairs.push({ a: pixels(rec[i].f), b: refPixels(best.r) }); off = best.r.count - rec[i].count; }
  }
  const cost = (g) => {
    let s = 0, n = 0;
    for (const { a, b } of pairs) for (let y = 4; y < H - 4; y += 6) for (let x = 4; x < W - 4; x += 6) for (let c = 0; c < 3; c++) {
      s += Math.abs(a[(y * W + x) * 3 + c] - sample(b, RW, RH, g.ox + x * g.sx, g.oy + y * g.sy, c)); n++;
    }
    return s / Math.max(n, 1);
  };
  let best = cost(geo);
  for (const [dPos, dScale] of [[4, 0.02], [2, 0.01], [1, 0.005], [0.5, 0.0025], [0.25, 0.001]]) {
    for (let improved = true; improved;) {
      improved = false;
      for (const [k, d] of [['ox', dPos], ['ox', -dPos], ['oy', dPos], ['oy', -dPos], ['sx', dScale], ['sx', -dScale], ['sy', dScale], ['sy', -dScale]]) {
        const g = { ...geo, [k]: geo[k] + d * (k[0] === 's' ? RW / W : 1) }, c = cost(g);
        if (c < best) { best = c; geo = g; improved = true; }
      }
    }
  }
  console.log(`the recomp's picture lies at (${geo.ox.toFixed(2)}, ${geo.oy.toFixed(2)}) of the console's, ` +
    `scaled ${geo.sx.toFixed(4)} x ${geo.sy.toFixed(4)}; ${pairs.length} pairs placed it, ${best.toFixed(1)} apart a pixel`);
}

// Tiles.
const recTiles = (px) => {
  const o = new Float32Array(TW * TH * 3);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) s += px[((ty * T + y) * W + tx * T + x) * 3 + c];
    o[(ty * TW + tx) * 3 + c] = s / (T * T);
  }
  return o;
};
const refTileCache = new Map();
const refTiles = (r) => {
  if (refTileCache.has(r)) return refTileCache.get(r);
  const px = refPixels(r), o = new Float32Array(TW * TH * 3);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++)
      s += sample(px, RW, RH, geo.ox + (tx * T + x + 0.5) * geo.sx - 0.5, geo.oy + (ty * T + y + 0.5) * geo.sy - 0.5, c);
    o[(ty * TW + tx) * 3 + c] = s / (T * T);
  }
  if (refTileCache.size > 256) refTileCache.delete(refTileCache.keys().next().value);
  refTileCache.set(r, o);
  return o;
};
// Each tile's difference: the least of its mean RGB difference to the console's tile in its place or one beside it.
const tileDiff = (a, b) => {
  const d = new Float32Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    let m = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= TW || y >= TH) continue;
      const i = (ty * TW + tx) * 3, j = (y * TW + x) * 3;
      const v = (Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2])) / 3;
      if (v < m) m = v;
    }
    d[ty * TW + tx] = m;
  }
  return d;
};
const mean = (d) => { let s = 0; for (const v of d) s += v; return s / d.length; };
const largestCluster = (d, thr) => {
  const seen = new Uint8Array(d.length);
  let best = { size: 0 };
  for (let i = 0; i < d.length; i++) {
    if (seen[i] || d[i] <= thr) continue;
    const stack = [i];
    seen[i] = 1;
    let size = 0, x0 = TW, y0 = TH, x1 = 0, y1 = 0;
    while (stack.length) {
      const k = stack.pop(), x = k % TW, y = (k / TW) | 0;
      size++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, kk = yy * TW + xx;
        if (xx >= 0 && yy >= 0 && xx < TW && yy < TH && !seen[kk] && d[kk] > thr) { seen[kk] = 1; stack.push(kk); }
      }
    }
    if (size > best.size) best = { size, x0, y0, x1, y1 };
  }
  return best;
};

// Pair every frame.
const pairs = [];
{
  let off = 0;
  const recent = [];
  for (const r of rec) {
    const a = recTiles(pixels(r.f));
    let best = null;
    for (const reach of [3, 12]) {
      for (const c of near(r.count, off, reach)) {
        const d = tileDiff(a, refTiles(c)), m = mean(d);
        if (!best || m < best.m) best = { m, d, c };
      }
      if (best && best.m < 12) break;
    }
    if (!best) { pairs.push({ r, none: true }); continue; }
    recent.push(best.c.count - r.count);
    if (recent.length > 9) recent.shift();
    off = [...recent].sort((x, y) => x - y)[recent.length >> 1];
    pairs.push({ r, c: best.c, d: best.d, m: best.m });
  }
}

// The noise floor.
let thr = Number(opt('--threshold', 24));
if (opt('--calibrate') && !opt('--threshold')) {
  const [c0, c1] = opt('--calibrate').split('-').map(Number);
  const vals = [];
  for (const p of pairs) if (!p.none && p.r.s >= c0 && p.r.s <= c1) for (const v of p.d) vals.push(v);
  vals.sort((x, y) => x - y);
  const p999 = vals[Math.floor(vals.length * 0.999)] ?? 0;
  thr = Math.max(16, 1.5 * p999);
  console.log(`noise floor from ${c0}-${c1} s: ${vals.length} tiles, 99.9th centile ${p999.toFixed(1)}, threshold ${thr.toFixed(1)}`);
}

// Unlike frames, and the scenes they make.
const unpaired = pairs.filter((p) => p.none).length;
for (const p of pairs) if (!p.none) { p.cl = largestCluster(p.d, thr); p.unlike = p.cl.size >= clusterMin; }
const scenes = [];
let cur = null;
for (const p of pairs) {
  if (p.none) continue;
  if (p.unlike) {
    if (cur && p.r.s - cur.last.r.s <= 0.2) { cur.frames.push(p); cur.last = p; }
    else { cur = { frames: [p], last: p }; scenes.push(cur); }
  }
}
const failing = scenes.filter((s) => s.frames.length >= runMin);
const unlikeCount = pairs.filter((p) => p.unlike).length;
console.log(`threshold ${thr.toFixed(1)}, cluster ${clusterMin} tiles of ${T}x${T}: ${unlikeCount} of ${pairs.length} frames unlike the console's` +
  (unpaired ? `, ${unpaired} with no console frame near their count` : ''));
for (const s of scenes) {
  const worst = s.frames.reduce((a, b) => (b.cl.size > a.cl.size ? b : a));
  const w = worst.cl, pct = (v, n) => Math.round(100 * v / n);
  console.log(`${s.frames.length >= runMin ? 'FAIL' : 'pass'} ${s.frames[0].r.s.toFixed(2)}-${s.last.r.s.toFixed(2)} s: ${s.frames.length} frames unlike, ` +
    `the worst ${worst.r.s.toFixed(2)} s (count ${worst.r.count}, the console's ${worst.c.count}): ${w.size} tiles at ` +
    `${pct(w.x0, TW)}-${pct(w.x1 + 1, TW)}% across, ${pct(w.y0, TH)}-${pct(w.y1 + 1, TH)}% down`);
  if (saveDir && s.frames.length >= runMin) save(worst, `unlike-${worst.r.s.toFixed(2)}s.png`);
}
console.log(failing.length ? `FAIL: ${failing.length} scenes drawn unlike the console for ${runMin} frames or more` : 'pass: no scene drawn unlike the console');
process.exit(failing.length ? 1 : 0);

function save(p, name) {
  fs.mkdirSync(saveDir, { recursive: true });
  const a = pixels(p.r.f), b = refPixels(p.c), out = Buffer.alloc(W * 3 * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    const o = (y * W * 3 + x) * 3 + c, v = a[(y * W + x) * 3 + c];
    out[o] = v;
    out[o + W * 3] = Math.round(sample(b, RW, RH, geo.ox + (x + 0.5) * geo.sx - 0.5, geo.oy + (y + 0.5) * geo.sy - 0.5, c));
    const k = Math.floor(y / T) * TW + Math.floor(x / T), over = Math.floor(y / T) < TH && Math.floor(x / T) < TW && p.d[k] > thr;
    out[o + W * 6] = over ? (c === 0 ? 255 : v >> 2) : v >> 1;
  }
  fs.writeFileSync(path.join(saveDir, name), png(W * 3, H, out));
}
function png(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4);
    len.writeUInt32BE(data.length); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
