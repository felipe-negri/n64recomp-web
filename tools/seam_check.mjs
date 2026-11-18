// Checks a game's picture at a high resolution for seams: straight lines thinner than one of the console's pixels,
// which the game draws at its own resolution nowhere, but which a gap between two of its pieces (terrain blocks a level
// of detail apart, a sliced sprite's strips drawn a pixel apart) shows at a high one, in the colour of what lies behind.
// frame_check (tools/frame_check.mjs) can't see them: a seam that stays with its picture differs from no frame either
// side, and it reads a grey copy about 400 wide, where a seam is a fraction of a pixel.
//
//   node tools/seam_check.mjs <high dump> --low <low dump> [--from <s>] [--to <s>] [--save <dir>] [--quiet]
//
// Both are dumps of one plan (RT64_FRAME_DUMP, rt64-web's src/hle/rt64_frame_dump.h; tools/frame_dump.mjs makes them):
// <high dump> of a picture drawn at 4 times the console's resolution or more (a 1280x960 window at resolution Auto),
// and --low of the same plan drawn at the console's own (a 320x240 window). RT64 box-filters a dump's frames to at most
// 640 wide, so the high dump's are 2 pixels a console pixel, a seam one 4x pixel wide is a line one pixel wide at half
// its contrast, and a 2D screen's line one console pixel wide (a box's frame, a letter's stroke) is two.
//
// - A thin line. A pixel whose row's (or column's) neighbours either side agree within LIKE of 255 in each colour, where
//   it differs from both by STEP or more, lies on a line one pixel thick; such pixels joined across gaps of up to GAP
//   along the line's way (a seam is dashed where what lies behind it shows through in parts) are a line where they span
//   LEN pixels or more, cover COVER of that span, and lie within RMS of a straight line through them. In the high dump
//   that is half a console pixel: Mario Golf's v0.1.10, whose far terrain left wedges of the background between
//   blocks a level of detail apart (its issue 33), draws them across hole 1's rough in its flyover, pale grey-blue
//   dashes over green; its v0.1.11 draws none there.
// - That the low dump lacks. A line one pixel thick at a high resolution can also be the game's own picture: art whose
//   lines are finer than the 2D screen's scaling (Mario Golf's title, the ONE of its main menu's PLAYERS row, which a
//   scaled 2D screen draws a column of the font's texture one pixel wide), drawn the same in the low dump. Each high
//   frame with a line is paired with the low dump's frame most like it (a grey copy PAIR_W wide, the least mean
//   difference), and a line counts only where under HAVE of its pixels have a pixel of a line in the low frame within
//   NEAR of their place there (one pixel thick at the console's resolution, differing from both sides by STEP / 2). The
//   game's own picture comes out the same at any resolution; a seam is a fraction of a pixel on a console.
//
// It fails where frames with a seam come in RUN or more seconds in a row (the dump's own clock), one a second or more:
// a seam belongs to a scene and comes back for as long as the scene is on screen, every frame of a flyover or once a
// bob of a sign that moves, where a lone second's lines are a frame paired with the wrong low one or a flash. Mario
// Golf's builds by one plan, a dump at 1280x960 against one at 320x240 (on Linux or Windows, either):
//   - Through the title, the menus and hole 1's flyover to the first shot (35 s): v0.1.10, with issue 33's cracks,
//     in 9 seconds, 6 in a row (92 of 990 frames); v0.1.11 in 1 (1 of 1103). v0.1.26 and v0.1.27 in 5 and 3, at most
//     2 in a row: this plan leaves the main menu in a second.
//   - Its main menu held 15 s: v0.1.26, whose bobbing MAIN MENU sign showed a line of sky across it in a frame drawn
//     between the game's own (issue 76; rt64-web 0571b69 fixed it), in 12 seconds, all in a row (14 of 886 frames, one
//     a bob); v0.1.27 in 1 (3 of 787, the ONE above, paired with a low frame where it differed).
//
// --from and --to keep the high dump's frames between those seconds, counted from its first; --save writes, for each
// second with a seam, its frame with the most seam pixels as a PNG with its seams marked magenta (<t>-marked.png) and
// as it was (<t>.png). It exits 0 when it passes, 1 when it fails, 2 on a bad dump or arguments, or a pair of dumps
// whose resolutions differ by under 2 dump pixels a console pixel.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// Run beside plays and builds, which come first (frame_check's header says why).
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* runs at normal */ }

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return (i >= 0) ? args[i + 1] : fallback;
};
const highDir = args[0], lowDir = opt('--low', null);
if (!highDir || highDir.startsWith('--') || !lowDir) {
    console.error('usage: node tools/seam_check.mjs <high dump> --low <low dump> [--from <s>] [--to <s>] [--save <dir>] [--quiet]');
    process.exit(2);
}
const from = Number(opt('--from', 0));
const to = Number(opt('--to', Infinity));
const saveDir = opt('--save', null);
const quiet = args.includes('--quiet');

const MAGIC = 0x44465452; // rt64_frame_dump.h's FrameDump::Magic
const HEADER = 40;
const LIKE = 20; // a line's sides agree within this, of 255, in each colour
const STEP = 40; // ... and the line differs from both by this much at the least, in one colour
const GAP = 4; // pixels a line's dashes are joined across
const LEN = 24; // pixels a line spans at the least, along its way (6 console pixels at 4x)
const COVER = 0.3; // the share of its span its pixels cover at the least
const RMS = 0.8; // pixels its pixels lie from a straight line through them, at the most (root mean square)
const PAIR_W = 64; // the grey copy frames are paired by
const NEAR = 1; // pixels around a line's place in the low frame a line of its own is looked for
const HAVE = 0.5; // the share of a line's pixels the low frame has a line beside, from which it is the game's own
const RUN = 4; // seconds in a row, each with a frame with a seam, that fail

// A dump's frames between --from and --to (or all for the low one): each { t, o, w, h }, o its pixels' offset.
function framesOf(d, all) {
    const file = path.join(d, 'frames.bin');
    if (!fs.existsSync(file)) {
        console.error(`${d}: no frames.bin`);
        process.exit(2);
    }
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(HEADER);
    const out = [];
    let startMs = null;
    for (let o = 0; o + HEADER <= size;) {
        fs.readSync(fd, head, 0, HEADER, o);
        const w = head.readUInt32LE(4), h = head.readUInt32LE(8);
        if ((head.readUInt32LE(0) !== MAGIC) || (o + HEADER + w * h * 3 > size)) {
            break;
        }
        const timeMs = Number(head.readBigUInt64LE(32));
        startMs ??= timeMs;
        const t = (timeMs - startMs) / 1000;
        if (!all && (t > to)) {
            break;
        }
        if (all || (t >= from)) {
            out.push({ t, o: o + HEADER, w, h });
        }
        o += HEADER + w * h * 3;
    }
    return { fd, frames: out };
}
const pixels = (fd, f) => {
    const p = Buffer.allocUnsafe(f.w * f.h * 3);
    fs.readSync(fd, p, 0, p.length, f.o);
    return p;
};

// The largest difference of two pixels' colours.
const diff = (p, a, b) => Math.max(Math.abs(p[a] - p[b]), Math.abs(p[a + 1] - p[b + 1]), Math.abs(p[a + 2] - p[b + 2]));
// Pixels one pixel thick across rows (H, a line along a row) and across columns (V): its two neighbours that way agree
// within like and it differs from both by step.
function thin(p, w, h, like, step) {
    const H = new Uint8Array(w * h), V = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 3, up = i - w * 3, dn = i + w * 3, lf = i - 3, rt = i + 3;
            if ((diff(p, up, dn) <= like) && (diff(p, i, up) >= step) && (diff(p, i, dn) >= step)) {
                H[y * w + x] = 1;
            }
            if ((diff(p, lf, rt) <= like) && (diff(p, i, lf) >= step) && (diff(p, i, rt) >= step)) {
                V[y * w + x] = 1;
            }
        }
    }
    return [H, V];
}
// The straight lines of a mask (header, a thin line): each { horiz, px }, px its pixels' indices.
function lines(M, w, h, horiz) {
    const seen = new Uint8Array(w * h), out = [], stack = [];
    for (let s = 0; s < w * h; s++) {
        if (!M[s] || seen[s]) {
            continue;
        }
        const px = [];
        stack.push(s);
        seen[s] = 1;
        while (stack.length) {
            const q = stack.pop(), qx = q % w, qy = (q / w) | 0;
            px.push(q);
            for (let a = -GAP; a <= GAP; a++) {
                for (let c = -1; c <= 1; c++) {
                    const nx = qx + (horiz ? a : c), ny = qy + (horiz ? c : a);
                    const r = ny * w + nx;
                    if ((nx >= 0) && (ny >= 0) && (nx < w) && (ny < h) && M[r] && !seen[r]) {
                        seen[r] = 1;
                        stack.push(r);
                    }
                }
            }
        }
        const n = px.length;
        if (n < LEN * COVER) {
            continue;
        }
        // Along its way u, across it v, and the least-squares line v = k u + b through them.
        const uv = (q) => horiz ? [q % w, (q / w) | 0] : [(q / w) | 0, q % w];
        let u0 = Infinity, u1 = -Infinity, su = 0, sv = 0, suu = 0, suv = 0;
        for (const q of px) {
            const [u, v] = uv(q);
            u0 = Math.min(u0, u);
            u1 = Math.max(u1, u);
            su += u; sv += v; suu += u * u; suv += u * v;
        }
        const span = u1 - u0 + 1;
        if ((span < LEN) || (n < COVER * span)) {
            continue;
        }
        const den = n * suu - su * su;
        const k = den ? (n * suv - su * sv) / den : 0, b = (sv - k * su) / n;
        let e = 0;
        for (const q of px) {
            const [u, v] = uv(q);
            e += (v - k * u - b) ** 2;
        }
        if (Math.sqrt(e / n) <= RMS) {
            out.push({ horiz, px });
        }
    }
    return out;
}
// A frame's grey copy PAIR_W wide, box-filtered.
function grey(p, w, h) {
    const gh = Math.round(PAIR_W * h / w), g = new Float32Array(PAIR_W * gh), n = new Float32Array(PAIR_W * gh);
    for (let y = 0; y < h; y++) {
        const gy = Math.min(Math.floor(y * gh / h), gh - 1);
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 3, gi = gy * PAIR_W + Math.min(Math.floor(x * PAIR_W / w), PAIR_W - 1);
            g[gi] += p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
            n[gi]++;
        }
    }
    return g.map((v, i) => v / (n[i] || 1));
}

const high = framesOf(highDir, false), low = framesOf(lowDir, true);
if (!high.frames.length || !low.frames.length) {
    console.error(`no frames in ${high.frames.length ? lowDir : highDir}${high.frames.length ? '' : ' between --from and --to'}`);
    process.exit(2);
}
// How many of the high dump's pixels a console pixel is, by the low dump's width (the console's own resolution).
const lowW = Math.min(...low.frames.map((f) => f.w)), highW = Math.max(...high.frames.map((f) => f.w));
const scale = highW / lowW;
if (scale < 2) {
    console.error(`the high dump is ${highW} wide and the low one ${lowW}: ${scale.toFixed(2)} of its pixels a console pixel, under 2, so a line one pixel thick can be the game's own (draw the high one at 4 times the console's resolution or more)`);
    process.exit(2);
}
const lowGrey = low.frames.map((f) => grey(pixels(low.fd, f), f.w, f.h));
const lowThin = new Map(); // a low frame's index: its thin pixels, H | V, computed once
function lowLines(j) {
    if (!lowThin.has(j)) {
        const f = low.frames[j];
        const [H, V] = thin(pixels(low.fd, f), f.w, f.h, LIKE, STEP / 2);
        lowThin.set(j, H.map((v, i) => v | V[i]));
        if (lowThin.size > 64) {
            lowThin.delete(lowThin.keys().next().value);
        }
    }
    return lowThin.get(j);
}
// The low frame most like a high one, by their grey copies (same shape: the same plan's 4:3 picture).
function pair(g) {
    let best = -1, bestD = Infinity;
    lowGrey.forEach((lg, j) => {
        if (lg.length !== g.length) {
            return;
        }
        let s = 0;
        for (let i = 0; i < g.length && s < bestD; i++) {
            s += Math.abs(g[i] - lg[i]);
        }
        if (s < bestD) {
            bestD = s;
            best = j;
        }
    });
    return best;
}
// Whether the low frame has a line beside HAVE of a line's pixels.
function lowHas(line, w, h, j) {
    const f = low.frames[j], M = lowLines(j), sx = f.w / w, sy = f.h / h;
    let have = 0;
    for (const q of line.px) {
        const lx = Math.round((q % w) * sx), ly = Math.round(((q / w) | 0) * sy);
        let found = false;
        for (let dy = -NEAR; dy <= NEAR && !found; dy++) {
            for (let dx = -NEAR; dx <= NEAR && !found; dx++) {
                const x = lx + dx, y = ly + dy;
                found = (x >= 0) && (y >= 0) && (x < f.w) && (y < f.h) && (M[y * f.w + x] === 1);
            }
        }
        have += found ? 1 : 0;
    }
    return have >= HAVE * line.px.length;
}

const seconds = new Map(); // a second: { frames, seamed, best: { t, n, f, seams } }
let seamPixels = 0, ownLines = 0;
for (const f of high.frames) {
    const p = pixels(high.fd, f);
    const [H, V] = thin(p, f.w, f.h, LIKE, STEP);
    const found = [...lines(H, f.w, f.h, true), ...lines(V, f.w, f.h, false)];
    let seams = [];
    if (found.length) {
        const j = pair(grey(p, f.w, f.h));
        seams = found.filter((l) => (j < 0) || !lowHas(l, f.w, f.h, j));
        ownLines += found.length - seams.length;
    }
    const n = seams.reduce((s, l) => s + l.px.length, 0);
    seamPixels += n;
    const sec = Math.floor(f.t);
    const s = seconds.get(sec) ?? { frames: 0, seamed: 0, best: null };
    s.frames++;
    if (seams.length) {
        s.seamed++;
        if (!s.best || (n > s.best.n)) {
            s.best = { t: f.t, n, f, seams };
        }
    }
    seconds.set(sec, s);
}

const seamSeconds = [...seconds].filter(([, s]) => s.seamed).map(([sec]) => sec).sort((a, b) => a - b);
let run = 0, longest = 0, prev = null;
for (const sec of seamSeconds) {
    run = (prev === sec - 1) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = sec;
}
const fails = longest >= RUN;
const seamed = [...seconds.values()].reduce((s, v) => s + v.seamed, 0);
if (!quiet) {
    for (const [sec, s] of [...seconds].sort((a, b) => a[0] - b[0])) {
        if (s.seamed) {
            console.log(`  ${String(sec).padStart(4)} s: ${s.seamed} of ${s.frames} frames with a seam`);
        }
    }
}
console.log(`seams: ${seamed} of ${high.frames.length} frames (${seamPixels} pixels; ${ownLines} lines the low dump has too, the game's own), ` +
    `in ${seamSeconds.length} seconds, ${longest} in a row` +
    (fails ? `: FAILS, a seam comes back for ${longest} s` : ''));

if (saveDir && seamed) {
    fs.mkdirSync(saveDir, { recursive: true });
    for (const [, { best }] of [...seconds].filter(([, v]) => v.best)) {
        const { t, f, seams } = best;
        const p = pixels(high.fd, f), m = Buffer.from(p);
        for (const l of seams) {
            for (const q of l.px) {
                m[q * 3] = 255; m[q * 3 + 1] = 0; m[q * 3 + 2] = 255;
            }
        }
        fs.writeFileSync(path.join(saveDir, `${t.toFixed(2)}.png`), png(f.w, f.h, p));
        fs.writeFileSync(path.join(saveDir, `${t.toFixed(2)}-marked.png`), png(f.w, f.h, m));
    }
}
process.exit(fails ? 1 : 0);

// An 8-bit RGB PNG.
function png(width, height, rgb) {
    const table = new Int32Array(256).map((_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        return c;
    });
    const crc = (bytes) => {
        let c = -1;
        for (const v of bytes) {
            c = table[(c ^ v) & 0xFF] ^ (c >>> 8);
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
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
