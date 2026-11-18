// PROTOTYPE: the pace of what moves through the frames drawn between the game's own. Header to come once measured.
//
//   node tools/frame_pace.mjs <dump dir> [--from <s>] [--to <s>] [--save <dir>] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = 0x44465452;
const HEADER = 40;
const GW = 640; // the grey copy's width at most
const B = 16; // a block, in grey pixels
const SUB = 2; // a block's pixels sampled every SUB in x and y
const Q = 4; // the coarse copy's scale
const CR = 8; // the coarse search, in coarse pixels either way
const TEX = 6; // a block's mean difference from its own mean under which it has too little drawn to place
const BAD = 10; // a block's mean difference to its best place, of 255, over which it isn't placed
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
    // How clearly it is there: the worst of a pixel either way along the line against the best.
    const near = [cs[Math.max(k - 2, 0)], cs[Math.min(k + 2, cs.length - 1)]].filter(Number.isFinite);
    return { s, err: cs[k], sharp: near.length ? Math.min(...near) - cs[k] : 0 };
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
            if (!o || (Math.hypot(o.dx, o.dy) < MOVE)) {
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
            if ((p.err <= BAD) && (p.sharp > 1)) {
                ss.push(p.s);
            }
        }
        weights.push(ss.length >= MIN_MOVING ? median(ss) : NaN);
    }
    const off = [];
    for (const b of blocks) {
        const len = Math.hypot(b.o.dx, b.o.dy);
        let worst = null;
        b.at.forEach((p, i) => {
            const w = weights[i];
            if (!Number.isFinite(w) || (p.err > BAD) || (p.sharp <= 1)) {
                return;
            }
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
    }
    return { moving: blocks.length, weights, off };
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

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return (i < 0) ? fallback : args[i + 1];
};
const dir = args[0];
const from = Number(opt('--from', 0)), to = Number(opt('--to', Infinity));
const saveDir = opt('--save', null);
const verbose = args.includes('--verbose');
if (saveDir) {
    fs.mkdirSync(saveDir, { recursive: true });
}

// Three frames in a row: where each block of the last was in the first, and how far along that way it is in the middle.
let window = [], checked = 0, framesRead = 0, betweenFrames = 0, repeats = 0;
const results = [];
const started = Date.now();
const MAX_GAP = 0.1; // seconds from a triplet's first frame to its last, at most
for (const f of readFrames(dir, from, to)) {
    framesRead++;
    betweenFrames += (f.index < f.count - 1) ? 1 : 0;
    const gw = Math.min(GW, f.w), gh = Math.floor(gw * f.h / f.w);
    f.gw = gw; f.gh = gh;
    f.g = grey(f.rgb, f.w, f.h, gw, gh);
    if (!saveDir) {
        f.rgb = null;
    }
    const last = window[window.length - 1];
    if (last && (last.w === f.w) && (last.h === f.h)) {
        let d = 0;
        for (let i = 0; i < f.g.length; i += 7) {
            d += Math.abs(f.g[i] - last.g[i]);
        }
        if (d / (f.g.length / 7) < 0.05) {
            repeats++;
            continue;
        }
    }
    if (last && ((last.w !== f.w) || (last.h !== f.h))) {
        window = [];
    }
    f.q = shrink(f.g, gw, gh);
    window.push(f);
    if (window.length > 3) {
        window.shift();
    }
    if ((window.length === 3) && (window[2].t - window[0].t <= MAX_GAP)) {
        const [a, b, c] = window;
        const r = checkPresent(a, [b, c], gw, gh);
        r.t = b.t;
        r.kinds = [a, b, c].map((x) => (x.index === x.count - 1) ? 'G' : 'b').join('');
        results.push(r);
        checked++;
        if (verbose) {
            const kinds = {};
            r.off.forEach((o) => (kinds[o.kind] = (kinds[o.kind] ?? 0) + 1));
            console.log(`${b.t.toFixed(2)} ${r.kinds} moving=${r.moving} s*=${r.weights.map((w) => w.toFixed(2)).join(',')} off=${r.off.length} ${JSON.stringify(kinds)}`);
        }
        if (saveDir && (r.off.length >= 4)) {
            save(path.join(saveDir, `${b.t.toFixed(2)}.png`), a, [b, c], r.off, gw);
        }
    }
}
console.log(`${framesRead} frames, ${betweenFrames} between the game's own, ${repeats} repeats, ${checked} triplets checked in ` +
    `${((Date.now() - started) / 1000).toFixed(1)} s`);
// Per second: presents checked, the off blocks by kind.
const bySecond = new Map();
for (const r of results) {
    const s = Math.floor(r.t);
    const e = bySecond.get(s) ?? { n: 0, moving: 0, step: 0, far: 0, off: 0, with4: 0 };
    e.n++;
    e.moving += r.moving;
    r.off.forEach((b) => e[b.kind]++);
    e.with4 += (r.off.length >= 4) ? 1 : 0;
    bySecond.set(s, e);
}
for (const [s, e] of bySecond) {
    console.log(`${s}s: ${e.n} presents, ${(e.moving / e.n).toFixed(0)} moving blocks each, off step ${e.step} far ` +
        `${e.far} other ${e.off}, ${e.with4} presents with 4+`);
}
