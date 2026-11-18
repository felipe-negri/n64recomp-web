// PROTOTYPE: the pace of what moves through the frames drawn between the game's own. Header to come once measured.
//
//   node tools/frame_pace.mjs <dump dir> [--from <s>] [--to <s>] [--save <dir>] [--verbose]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const MAGIC = 0x44465452;
const HEADER = 40;
const GW = 640; // the grey copy's width at most
const B = 16; // a block, in grey pixels
const SUB = 2; // a block's pixels sampled every SUB in x and y
const Q = 4; // the coarse copy's scale
const CR = 8; // the coarse search, in coarse pixels either way
const TEX = 6; // a block's mean difference from its own mean under which it has too little drawn to place
const BAD = 10; // a block's mean difference to its best place, of 255, over which it isn't placed
const CORNER = 2; // how much worse, of 255, a block matches 2 pixels off its place any way, at least
const EDGE = 16; // a step to the next pixel, of 255, that makes a pixel a detailed one (still())
const STILL = 0.25; // the share of a moving block's detailed pixels unmoved, at least, that leaves it out (still())
const MOVE = 2; // grey pixels a block moves between the game's frames, at least, to be measured
const MIN_MOVING = 12; // moving blocks placed in a frame between, at least, for its common weight
const OFF = 0.3; // a block's fraction off the frame's common one, at least
const OFF_PX = 1.5; // ... and grey pixels off, at least

function grey(rgb, w, h, gw, gh) {
    const out = new Float32Array(gw * gh);
    const sx = w / gw, sy = h / gh;
    for (let y = 0; y < gh; y++) {
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        for (let x = 0; x < gw; x++) {
            const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
            let sum = 0;
            for (let yy = y0; yy < y1; yy++) {
                let p = (yy * w + x0) * 3;
                for (let xx = x0; xx < x1; xx++, p += 3) {
                    sum += 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
                }
            }
            out[y * gw + x] = sum / ((y1 - y0) * (x1 - x0));
        }
    }
    return out;
}

function shrink(g, gw, gh) {
    const qw = Math.floor(gw / Q), qh = Math.floor(gh / Q);
    const out = new Float32Array(qw * qh);
    for (let y = 0; y < qh; y++) {
        for (let x = 0; x < qw; x++) {
            let s = 0;
            for (let yy = 0; yy < Q; yy++) {
                for (let xx = 0; xx < Q; xx++) {
                    s += g[(y * Q + yy) * gw + x * Q + xx];
                }
            }
            out[y * qw + x] = s / (Q * Q);
        }
    }
    return out;
}

// Mean difference of the block at (bx, by) in a against b at (bx + dx, by + dy), Infinity off the picture.
function sad(a, b, w, h, bx, by, dx, dy, size, step) {
    const x0 = bx + dx, y0 = by + dy;
    if ((x0 < 0) || (y0 < 0) || (x0 + size > w) || (y0 + size > h)) {
        return Infinity;
    }
    let s = 0, n = 0;
    for (let y = 0; y < size; y += step) {
        const ra = (by + y) * w + bx, rb = (y0 + y) * w + x0;
        for (let x = 0; x < size; x += step) {
            s += Math.abs(a[ra + x] - b[rb + x]);
            n++;
        }
    }
    return s / n;
}

function texture(a, w, bx, by) {
    let m = 0, n = 0;
    for (let y = 0; y < B; y += SUB) {
        for (let x = 0; x < B; x += SUB) {
            m += a[(by + y) * w + bx + x];
            n++;
        }
    }
    m /= n;
    let d = 0;
    for (let y = 0; y < B; y += SUB) {
        for (let x = 0; x < B; x += SUB) {
            d += Math.abs(a[(by + y) * w + bx + x] - m);
        }
    }
    return d / n;
}

// The share of a block's detailed pixels (a step of EDGE or more to the next across or down) that are as they were in
// the frame before, where they were: a HUD's figures over a world that moves, which a block holding both places at
// one end of the way or the other, whichever is more of it.
function still(g1, g0, gw, bx, by) {
    let edge = 0, same = 0;
    for (let y = 0; y < B; y++) {
        for (let x = 0; x < B; x++) {
            const p = (by + y) * gw + bx + x;
            if (Math.max(Math.abs(g1[p + 1] - g1[p]), Math.abs(g1[p + gw] - g1[p])) >= EDGE) {
                edge++;
                same += (Math.abs(g1[p] - g0[p]) <= 3) ? 1 : 0;
            }
        }
    }
    return edge ? same / edge : 0;
}

// Where the block at (bx, by) in the game's new frame g1 was in its frame before, g0: { dx, dy (sub-pixel), err } or
// null where it isn't placed.
function placeBefore(g1, q1, g0, q0, gw, gh, bx, by) {
    const qw = Math.floor(gw / Q), qh = Math.floor(gh / Q);
    // Coarse: a window of 2 blocks around the block's middle.
    const cs = 2 * B / Q, cx = Math.round((bx + B / 2) / Q - cs / 2), cy = Math.round((by + B / 2) / Q - cs / 2);
    let best = Infinity, bdx = 0, bdy = 0;
    for (let dy = -CR; dy <= CR; dy++) {
        for (let dx = -CR; dx <= CR; dx++) {
            const s = (cx < 0 || cy < 0 || cx + cs > qw || cy + cs > qh) ? Infinity : sad(q1, q0, qw, qh, cx, cy, dx, dy, cs, 1);
            if (s < best) {
                best = s; bdx = dx; bdy = dy;
            }
        }
    }
    if (best === Infinity) {
        return null;
    }
    // Fine, about it.
    let fb = Infinity, fx = 0, fy = 0;
    const cost = new Map();
    for (let dy = bdy * Q - Q; dy <= bdy * Q + Q; dy++) {
        for (let dx = bdx * Q - Q; dx <= bdx * Q + Q; dx++) {
            const s = sad(g1, g0, gw, gh, bx, by, dx, dy, B, SUB);
            cost.set(`${dx},${dy}`, s);
            if (s < fb) {
                fb = s; fx = dx; fy = dy;
            }
        }
    }
    if (fb > BAD) {
        return null;
    }
    const c = (dx, dy) => cost.get(`${dx},${dy}`) ?? sad(g1, g0, gw, gh, bx, by, dx, dy, B, SUB);
    // Placed only where 2 pixels off its place any way matches clearly worse: a line or an edge, which matches as well
    // anywhere along itself, isn't placed.
    let corner = Infinity;
    for (const [ex, ey] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
        corner = Math.min(corner, c(fx + ex, fy + ey) - fb);
    }
    if (!(corner >= CORNER)) {
        return null;
    }
    const para = (l, m, r) => {
        const den = l - 2 * m + r;
        return (den > 0 && Number.isFinite(den)) ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den))) : 0;
    };
    return { dx: fx + para(c(fx - 1, fy), fb, c(fx + 1, fy)), dy: fy + para(c(fx, fy - 1), fb, c(fx, fy + 1)), err: fb };
}

// Where along the way from its new place to its old the block is in a frame between, as a fraction s (0 at the new
// game frame's place, 1 at the old's), searched from -0.5 to 1.5 a pixel at a time, then between: { s, err, sharp }.
function placeBetween(g1, gk, gw, gh, bx, by, o) {
    const len = Math.hypot(o.dx, o.dy);
    const steps = Math.ceil(len * 2);
    const ss = [], cs = [];
    for (let i = -Math.ceil(steps / 4); i <= steps + Math.ceil(steps / 4); i++) {
        const s = i / steps;
        ss.push(s);
        cs.push(sad(g1, gk, gw, gh, bx, by, Math.round(s * o.dx), Math.round(s * o.dy), B, SUB));
    }
    let k = 0;
    for (let i = 1; i < cs.length; i++) {
        if (cs[i] < cs[k]) {
            k = i;
        }
    }
    let s = ss[k];
    if ((k > 0) && (k < cs.length - 1) && Number.isFinite(cs[k - 1]) && Number.isFinite(cs[k + 1])) {
        const den = cs[k - 1] - 2 * cs[k] + cs[k + 1];
        if (den > 0) {
            s += Math.max(-0.5, Math.min(0.5, (cs[k - 1] - cs[k + 1]) / (2 * den))) / steps;
        }
    }
    // How clearly it is there: the best match 2 pixels or more from it along the way against it, so a block that
    // matches as well elsewhere along the way (a row of like marks, a line along the way it moves) isn't placed.
    let other = Infinity;
    cs.forEach((v, i) => {
        if ((Math.abs(i - k) >= 4) && Number.isFinite(v)) {
            other = Math.min(other, v);
        }
    });
    return { s, err: cs[k], sharp: other - cs[k] };
}

function median(v) {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[s.length >> 1] : NaN;
}

// One present: the game's frame before (g0), the frames between and the game's new frame (g1).
function checkPresent(prev, frames, gw, gh) {
    const last = frames[frames.length - 1];
    const g0 = prev.g, q0 = prev.q, g1 = last.g, q1 = last.q;
    const blocks = [];
    for (let by = B; by + 2 * B <= gh; by += B) {
        for (let bx = B; bx + 2 * B <= gw; bx += B) {
            if (texture(g1, gw, bx, by) < TEX) {
                continue;
            }
            const o = placeBefore(g1, q1, g0, q0, gw, gh, bx, by);
            if (!o || (Math.hypot(o.dx, o.dy) < MOVE) || (still(g1, g0, gw, bx, by) >= STILL)) {
                continue;
            }
            blocks.push({ bx, by, o, at: [] });
        }
    }
    const between = frames.slice(0, -1);
    const weights = [];
    for (const f of between) {
        const ss = [];
        for (const b of blocks) {
            const p = placeBetween(g1, f.g, gw, gh, b.bx, b.by, b.o);
            b.at.push(p);
            if ((p.err <= BAD) && (p.sharp >= CORNER)) {
                ss.push(p.s);
            }
        }
        weights.push(ss.length >= MIN_MOVING ? median(ss) : NaN);
    }
    const off = [], measured = [];
    for (const b of blocks) {
        const len = Math.hypot(b.o.dx, b.o.dy);
        let worst = null, seen = false;
        b.at.forEach((p, i) => {
            const w = weights[i];
            if (!Number.isFinite(w) || (p.err > BAD) || (p.sharp < CORNER)) {
                return;
            }
            seen = true;
            const d = p.s - w;
            if ((Math.abs(d) >= OFF) && (Math.abs(d) * len >= OFF_PX) && (!worst || Math.abs(d) > Math.abs(worst.d))) {
                worst = { d, s: p.s, w, i };
            }
        });
        if (worst) {
            const kind = ((worst.s < -0.15) || (worst.s > 1.15)) ? 'far' :
                ((Math.abs(worst.s) < 0.15) || (Math.abs(worst.s - 1) < 0.15)) ? 'step' : 'off';
            off.push({ bx: b.bx, by: b.by, len, kind, ...worst });
        }
        if (seen) {
            measured.push({ bx: b.bx, by: b.by, off: !!worst });
        }
    }
    return { moving: blocks.length, weights, off, measured };
}

function png(width, height, rgb) {
    const crcTable = new Int32Array(256).map((_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        return c;
    });
    const crc = (bytes) => {
        let c = -1;
        for (const v of bytes) {
            c = crcTable[(c ^ v) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ -1) >>> 0;
    };
    const chunk = (type, data) => {
        const out = Buffer.alloc(12 + data.length);
        out.writeUInt32BE(data.length, 0);
        out.write(type, 4, 'latin1');
        data.copy(out, 8);
        out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
        return out;
    };
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// The game's frame before, the frames between and the game's new one side by side, the off blocks outlined in the
// frame between they were off in (magenta a step, yellow too far, cyan otherwise).
function save(file, prev, frames, off, gw) {
    const all = [prev, ...frames];
    const w = prev.w, h = prev.h, n = all.length;
    const out = Buffer.alloc(w * n * h * 3);
    all.forEach((f, i) => {
        for (let y = 0; y < Math.min(h, f.h); y++) {
            f.rgb.copy(out, (y * w * n + i * w) * 3, y * f.w * 3, (y * f.w + Math.min(w, f.w)) * 3);
        }
    });
    const scale = w / gw;
    const colour = { step: [255, 0, 255], far: [255, 255, 0], off: [0, 255, 255] };
    for (const b of off) {
        const x0 = Math.floor(b.bx * scale) + (b.i + 1) * w, y0 = Math.floor(b.by * scale), s = Math.ceil(B * scale);
        for (let i = 0; i < s; i++) {
            for (const [x, y] of [[x0 + i, y0], [x0 + i, y0 + s - 1], [x0, y0 + i], [x0 + s - 1, y0 + i]]) {
                if ((x < w * n) && (y < h)) {
                    out.set(colour[b.kind], (y * w * n + x) * 3);
                }
            }
        }
    }
    fs.writeFileSync(file, png(w * n, h, out));
}

function* readFrames(dir, from, to) {
    const file = path.join(dir, 'frames.bin');
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(HEADER);
    let startMs = null;
    for (let o = 0; o + HEADER <= size;) {
        fs.readSync(fd, head, 0, HEADER, o);
        if (head.readUInt32LE(0) !== MAGIC) {
            throw new Error(`frames.bin: no frame header at byte ${o}`);
        }
        const w = head.readUInt32LE(4), h = head.readUInt32LE(8);
        const bytes = w * h * 3;
        if (o + HEADER + bytes > size) {
            break;
        }
        const timeMs = Number(head.readBigUInt64LE(32));
        startMs ??= timeMs;
        const t = (timeMs - startMs) / 1000;
        if (t > to) {
            break;
        }
        if (t >= from) {
            const rgb = Buffer.allocUnsafe(bytes);
            fs.readSync(fd, rgb, 0, bytes, o + HEADER);
            yield { t, w, h, rgb, index: head.readUInt32LE(12), count: head.readUInt32LE(16),
                dropped: head.readUInt32LE(20), presentId: Number(head.readBigUInt64LE(24)) };
        }
        o += HEADER + bytes;
    }
    fs.closeSync(fd);
}


// A worker matches triplets: this file again, told so by its workerData (frame_check's own workers import it too).
if (!isMainThread && workerData?.pace) {
    parentPort.on('message', ({ id, a, b, c, gw, gh }) => {
        const r = checkPresent(a, [b, c], gw, gh);
        parentPort.postMessage({ id, r: { moving: r.moving, weights: r.weights, off: r.off, measured: r.measured } });
    });
}

const MAX_GAP = 0.1; // seconds from a triplet's first frame to its last, at most
const PLACE_WINDOW = 2; // seconds a place's blocks are counted over
const PLACE_OFF = 8; // ... off in this many triplets, at least,
const PLACE_SHARE = 0.5; // ... and this share of those where they were measured,
const PLACE_SPAN = 0.5; // ... from the first to the last over this many seconds at least

// Checks a dump's pace: { failed, untested, lines }.
export async function checkPace(dir, { from = 0, to = Infinity, workers = 1, saveDir = null, verbose = false,
    read = null, write = null } = {}) {
    const lines = [];
    const log = (s) => {
        lines.push(s);
        if (verbose) {
            console.log(s);
        }
    };
    if (saveDir) {
        fs.mkdirSync(saveDir, { recursive: true });
    }
    const results = read ? JSON.parse(fs.readFileSync(read, 'utf8')) : [];
    const pool = [], idle = [], waiters = [];
    let inFlight = 0, wake = null;
    const post = (task) => new Promise((resolve) => {
        inFlight++;
        const go = () => {
            const w = idle.pop();
            w.resolve = resolve;
            w.postMessage(task);
        };
        idle.length ? go() : waiters.push(go);
    });
    for (let i = 0; i < (read ? 0 : workers); i++) {
        const w = new Worker(new URL(import.meta.url), { workerData: { pace: true } });
        w.on('message', ({ r }) => {
            const resolve = w.resolve;
            idle.push(w);
            waiters.shift()?.();
            inFlight--;
            resolve(r);
            wake?.();
        });
        w.on('error', (e) => {
            console.error(e);
            process.exit(2);
        });
        pool.push(w);
        idle.push(w);
    }
    let window = [], framesRead = 0, betweenFrames = 0, repeats = 0;
    const jobs = [];
    for (const f of (read ? [] : readFrames(dir, from, to))) {
        framesRead++;
        betweenFrames += (f.index < f.count - 1) ? 1 : 0;
        const gw = Math.min(GW, f.w), gh = Math.floor(gw * f.h / f.w);
        f.g = grey(f.rgb, f.w, f.h, gw, gh);
        f.rgb = null;
        const last = window[window.length - 1];
        if (last && ((last.w !== f.w) || (last.h !== f.h))) {
            window = [];
        } else if (last) {
            // A repeat (the same picture presented again) moves nothing: left out.
            let d = 0;
            for (let i = 0; i < f.g.length; i += 7) {
                d += Math.abs(f.g[i] - last.g[i]);
            }
            if (d / (f.g.length / 7) < 0.05) {
                repeats++;
                continue;
            }
        }
        f.q = shrink(f.g, gw, gh);
        window.push(f);
        if (window.length > 3) {
            window.shift();
        }
        if ((window.length === 3) && (window[2].t - window[0].t <= MAX_GAP)) {
            const [a, b, c] = window;
            jobs.push(post({ a: { g: a.g, q: a.q }, b: { g: b.g }, c: { g: c.g, q: c.q }, gw, gh }).then((r) => {
                r.t = b.t;
                results.push(r);
            }));
            // Frames read ahead stay a few per worker.
            while (inFlight > workers * 3) {
                await new Promise((resolve) => (wake = resolve));
            }
        }
    }
    await Promise.all(jobs);
    pool.forEach((w) => w.terminate());
    results.sort((x, y) => x.t - y.t);
    if (write) {
        fs.writeFileSync(write, JSON.stringify(results));
    }
    // Per place (a block of the grid), in PLACE_WINDOW s windows: how often a block measured there was off, over how long.
    const cells = new Map();
    for (const r of results) {
        for (const m of r.measured) {
            const k = `${m.bx},${m.by}`;
            if (!cells.has(k)) {
                cells.set(k, []);
            }
            cells.get(k).push({ t: r.t, off: m.off });
        }
    }
    const bad = [];
    for (const [k, v] of cells) {
        let best = null;
        for (let i = 0, j = 0; i < v.length; i++) {
            while (v[i].t - v[j].t > PLACE_WINDOW) {
                j++;
            }
            const w = v.slice(j, i + 1), offs = w.filter((x) => x.off);
            const span = offs.length ? offs[offs.length - 1].t - offs[0].t : 0;
            const e = { n: w.length, o: offs.length, share: offs.length / w.length, span, t0: offs[0]?.t,
                t1: offs[offs.length - 1]?.t };
            if (!best || (e.o * e.share > best.o * best.share)) {
                best = e;
            }
        }
        const [bx, by] = k.split(',').map(Number);
        if (best && (best.o >= PLACE_OFF) && (best.share >= PLACE_SHARE) && (best.span >= PLACE_SPAN)) {
            bad.push({ bx, by, ...best });
        }
    }
    // Places: bad blocks within 2 blocks of each other, joined.
    let places = [];
    for (const c of bad) {
        const near = places.filter((q) => q.some((d) => (Math.abs(d.bx - c.bx) <= 2 * B) && (Math.abs(d.by - c.by) <= 2 * B)));
        places = places.filter((q) => !near.includes(q));
        places.push([c, ...near.flat()]);
    }
    places.sort((p, q) => q.length - p.length);
    const untested = !read && (betweenFrames < framesRead / 100);
    log(`pace (${dir}): ${results.length} triplets of frames matched (${framesRead} frames, ${betweenFrames} drawn ` +
        `between the game's own, ${repeats} repeats), ${places.length} places off the rest's pace` +
        (places.length ? ': FAILS' : '') + (untested ? '; under 1 in 100 frames drawn between the game\'s own: untested' : ''));
    for (const p of places) {
        const t0 = Math.min(...p.map((c) => c.t0)), t1 = Math.max(...p.map((c) => c.t1));
        const x0 = Math.min(...p.map((c) => c.bx)), x1 = Math.max(...p.map((c) => c.bx)) + B;
        const y0 = Math.min(...p.map((c) => c.by)), y1 = Math.max(...p.map((c) => c.by)) + B;
        const kinds = {};
        for (const r of results.filter((x) => (x.t >= t0) && (x.t <= t1))) {
            for (const o of r.off.filter((x) => p.some((c) => (c.bx === x.bx) && (c.by === x.by)))) {
                kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
            }
        }
        log(`  ${p.length} blocks at ${x0}-${x1} x ${y0}-${y1} (of a ${GW} wide copy) from ${t0.toFixed(2)} to ` +
            `${t1.toFixed(2)} s: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    }
    // Each place's triplet with the most of its blocks off, saved: read again from the dump, the rest's frames long gone.
    for (const p of (saveDir ? places : [])) {
        const inPlace = (o) => p.some((c) => (c.bx === o.bx) && (c.by === o.by));
        const t0 = Math.min(...p.map((c) => c.t0)), t1 = Math.max(...p.map((c) => c.t1));
        const r = results.filter((x) => (x.t >= t0) && (x.t <= t1))
            .reduce((x, y) => (y.off.filter(inPlace).length > x.off.filter(inPlace).length) ? y : x);
        let win = [];
        for (const f of readFrames(dir, r.t - MAX_GAP - 0.05, r.t + MAX_GAP + 0.05)) {
            const gw = Math.min(GW, f.w), gh = Math.floor(gw * f.h / f.w);
            f.g = grey(f.rgb, f.w, f.h, gw, gh);
            const last = win[win.length - 1];
            if (last && (last.w === f.w) && (last.h === f.h)) {
                let d = 0;
                for (let i = 0; i < f.g.length; i += 7) {
                    d += Math.abs(f.g[i] - last.g[i]);
                }
                if (d / (f.g.length / 7) < 0.05) {
                    continue;
                }
            }
            win = [...win, f].slice(-3);
            if ((win.length === 3) && (Math.abs(win[1].t - r.t) < 1e-6)) {
                save(path.join(saveDir, `pace-${r.t.toFixed(2)}.png`), win[0], win.slice(1), r.off.filter(inPlace), gw);
                log(`  saved pace-${r.t.toFixed(2)}.png`);
                break;
            }
        }
    }
    return { failed: places.length > 0, untested, lines };
}

if (isMainThread && process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)) {
    const args = process.argv.slice(2);
    const opt = (name, fallback) => {
        const i = args.indexOf(name);
        return (i < 0) ? fallback : args[i + 1];
    };
    if (!args[0] || args[0].startsWith('--')) {
        console.error('usage: node tools/frame_pace.mjs <dump dir> [--from <s>] [--to <s>] [--save <dir>] [--workers <n>]');
        process.exit(2);
    }
    try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* runs at normal */ }
    const r = await checkPace(args[0], { from: Number(opt('--from', 0)), to: Number(opt('--to', Infinity)),
        workers: Math.max(Math.round(Number(opt('--workers', os.availableParallelism() / 3))) || 1, 1),
        saveDir: opt('--save', null), verbose: true, read: opt('--read', null), write: opt('--write', null) });
    process.exit(r.failed ? 1 : (r.untested ? 2 : 0));
}
