// Checks a game's picture by machine, from what RT64 writes with RT64_FRAME_DUMP=<dir> set (rt64-web's
// src/hle/rt64_frame_dump.h): docs/new-recomp.md item 2's flicker and interpolation and item 1's widescreen culling,
// which a person or a model looking at captures missed (Mario Golf's trees put where other trees stood in every frame
// drawn between the game's, and its ground culled at the 4:3 view's sides), and which these find without anyone
// looking.
//
//   node tools/frame_check.mjs <dir> [--wider <dir>] [--from <s>] [--to <s>] [--save <dir>] [--quiet]
//
// <dir> is a dump's: frames.bin, every frame presented, and sides.tsv, where across the view the 3D's triangles lay.
// --wider names a dump of the same plan and seconds in a wider window (32:9 beside 16:9) for the sides. --from and
// --to keep what came between those seconds of the dumps, counted from each one's first frame; --save writes each
// flagged frame with the frames either side of it as one PNG, its flagged blocks outlined, for whoever wants to see
// one. A dump of 20 seconds at 60 a second takes a minute or two.
//
// - Frames unlike both neighbours. Each frame is matched against the frames presented before and after it, block by
//   block (8 pixels of a grey copy about 400 wide), each block to the best place within a few pixels of where the
//   picture as a whole moved or of where the part around it moved (a screen split open from its middle, near and far
//   parts of a scene), and each pixel of a block that matches neither whole to the nearest like it in either (the
//   edge of a wipe that moved, a picture that stretches): a block neither neighbour has anywhere near, where the
//   neighbours match each other there, is something drawn for that frame alone. A frame paired wrongly between the
//   game's own (a model drawn halfway to a look-alike's place, a camera cut stretched, polygons torn), a frame drawn
//   in parts, a frame of garbage or an old picture between two right ones all read so; the game's own motion, a fade,
//   a cut, a wipe, something appearing for good don't. A presented frame equal to the one before (a repeat) is left
//   out. It fails where such frames are more than 1 in 100, or come 3 or more within a second: a one-frame flash a
//   game draws is rare and alone, and a pairing fault shows in every frame drawn between the game's for as long as
//   the scene lasts. Only frames presented between the game's own (Framerate Display, on a display faster than the
//   game) are paired, so a dump without one (Framerate Original, a 60 Hz display under a game of 60) leaves pairing
//   untested and exits 2, whatever else passes.
// - Camera cuts drawn partway. A cut is two of the game's frames in a row far apart (a mean difference of 8 of 255
//   after the best shift of one against the other) where the game's frames before and after them are at least twice as
//   near: the camera jumps in one frame. RT64 interpolates a camera unless the game says it cut, so a cut the game
//   doesn't mark is drawn partway, the whole picture swept or stretched from one shot to the other for a frame or three,
//   which the check above can't see: neither neighbour matches the frames before or after it, as at any cut. Every frame
//   drawn between the two should be the new shot or the old, its parts moved on as they move (a model, an animated
//   texture): block by block, each to its best place in either, one unlike both by 0.3 or more of how unlike the two
//   are to each other fails. A game camera that moves that far in one frame and that little either side is a cut,
//   whatever the game meant by it, if half or more of the new frame's blocks (the picture's edge left out) match nothing
//   near them in the old: a new shot. A near object passing the camera changes the picture as much and only in part,
//   and its frames between are the camera's own, rightly drawn: Turok: Dinosaur Hunter's title fly-over goes through a
//   leaf between two of the game's frames, changing 0.35 of the picture, and the frame drawn between them is the leaf,
//   0.94 unlike both. Turok 2's cinematics' cuts change 0.62-0.80 of theirs where they are lit; a cut
//   between two dark shots, whose blocks differ by less than a block's match allows, reads lower (one of Turok 2's
//   0.18) and goes untested.
// - Culled at the 4:3 view's sides, from two dumps of the same plan: one at 16:9 and one --wider at 32:9. A game
//   that culls its world to the picture draws more of it past the 4:3 view's sides as the picture widens; one that
//   culls to its 4:3 view draws the same whatever the window, so the strip only the wider picture shows holds what
//   reaches over the edge from inside and nothing more (water or sky where the ground goes on). It compares the
//   triangles a workload of 3D (200 triangles or more) has in that strip in both, by where each one's middle lies,
//   and fails where the wider has under 1.2 times as many and the strip is under half as dense as the view: a world
//   drawn that densely past the view isn't culled at its sides at all. A game that culls nothing by the window draws
//   the same whatever the window too, so the two dumps alone read it like one culled to its 4:3 view: San Francisco
//   Rush 2049 culls whole stretches of scenery and draws its world out to the 32:9 picture's edges, and its attract
//   race read x1.16 on a 60 Hz display and x1.00 on a 240 Hz one. The narrower dump tells them apart. A game culled to
//   4:3 thins out past the narrower picture's own edge, where nothing of it shows, and one not culled by the window
//   draws there as it does inside, so the check passes where the strip past that edge (out as far again as the edge
//   lies past the view, 0.17-0.33 of it at 16:9) is 0.65 or more as dense a band as the strip inside the edge: Mario
//   Golf's hole 1 flyover read 0.28 without its patches/cull.c and 0.59 with it, Rayman 2's Woods of Light 0.25-0.54
//   without its v0.1.1, Rush 2049's attract race 0.74 and Practice on its first track 0.81. A scene that draws under
//   50 triangles a workload in the strip at 32:9 can't fail, and exits 2: the fifth more the check asks for is then an
//   object or two, and a game culling to the picture draws an object reaching into the narrower one whole, past its
//   edge too. Rayman 2's Woods of Light opens on a fade-in down a ravine whose walls are a few large triangles, their
//   middles inside the view: its fixed build reads 22 and 25 there (x1.14) and the build without its v0.1.1 11 and 11,
//   where its first 8 s in the Fairy Glade read 102 and 117 (passing on 0.74) and 62 and 61 (failing), and Mario
//   Golf's flyover without its patches/cull.c 197 and 186. A scene of more is no test either where its world is a few
//   large objects that each reach into the narrower picture: a game culling to the picture draws them whole in both
//   windows, so it grows no more than one culled to 4:3, and fails with its world out to the wider picture's edges.
//   Rayman 2's language menu, a backdrop of a few cliffs, reads 78 and 91 (x1.17; 0.46 past the edge) and fails, the
//   shots of its Woods of Light opening after the ravine 33 and 38 (x1.15) and pass on 0.67, and Rayman's first still
//   shot 108 and 111 (x1.02) on 1.03, so a dump of the whole opening passes or fails by how long its plan holds each:
//   one pair read 74 and 79 (x1.06) and passed on 0.85, another 46 and 52 (x1.14) and failed.
//   So a fail is looked at in the wider dump's frames before it is called the game's. Without --wider it only counts
//   them. One dump's own strip
//   against the view tells nothing: Mario Golf's flyover, culled or not, draws a fraction past the edges of what it
//   draws inside, the course being long and narrow. The picture's shape is the
//   picture's box between --from and --to (pictureBox()), not its first frame's: a dump that starts before its plan
//   sizes the window begins at 4:3, and one whose frames come in several sizes has black past the picture in some.
//
// It exits 0 when what it checked passes, 1 when one fails, 2 on a bad dump or arguments or a dump that can't test
// the pairing or the sides. frames.bin is read a frame at a time, three kept: a dump at a 240 Hz display's rate is about 160 MB a
// second.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return (i >= 0) ? args[i + 1] : fallback;
};
const dir = args[0];
if (!dir || dir.startsWith('--')) {
    console.error('usage: node tools/frame_check.mjs <dir> [--wider <dir>] [--from <s>] [--to <s>] [--save <dir>] [--quiet]');
    process.exit(2);
}
const from = Number(opt('--from', 0));
const to = Number(opt('--to', Infinity));
const saveDir = opt('--save', null);
const widerDir = opt('--wider', null);
const quiet = args.includes('--quiet');

const MAGIC = 0x44465452; // rt64_frame_dump.h's FrameDump::Magic
const HEADER = 40;
const W = 400; // the grey copy's width
const B = 8; // block size
const R = 3; // a block's search around the picture's own shift, in grey pixels
const G = 8; // the picture's shift searched, in quarter-size pixels (32 grey pixels)
const BAD = 14; // a block's mean difference to its best match that counts as unmatched, of 255
const RATIO = 3; // ... and how much worse than the neighbours match each other there
const MIN_BLOCKS = 4; // blocks a flagged frame has
const CUT = 8; // the mean difference of two of the game's frames in a row, of 255, at the least, that is a cut
const CUT_JUMP = 2; // ... and how many times the game's frames either side of them differ, at the least
const CUT_PARTWAY = 0.3; // a frame between a cut's two as unlike both, against how unlike they are: the camera partway
const CUT_WHOLE = 0.5; // ... and the share of the new frame's blocks the old one has nothing like: a new shot
const P = 2; // a pixel's search about its block's best place, in grey pixels (eitherDiff())
const M = 2; // the quarter pixels around a block that its own shift is found over (placesOf())
const SIDES_GROW = 1.2; // how many times the triangles past the 4:3 view a wider picture has, at the least
const SIDES_DENSE = 0.5; // ... unless the strip is this dense against the view: a world not culled at its sides
const SIDES_OPEN = 0.65; // ... or the narrower picture this dense past its own edge as inside it: not culled by the window
const SIDES_FEW = 50; // triangles a workload in the wider picture's strip under which a scene can't fail: too few to tell

let dumpStartMs = null; // the first frame's time, ms since 1970: the dump's second 0, sides.tsv's too

// The picture's box in a dump's frames between --from and --to, from their top left corner. RT64 draws a frame into a
// color target that can be larger than the picture (one kept from a larger frame before, the targets of the frames
// drawn between the game's), and the dump reads back the whole target, so one dump's frames can come in several sizes
// with the picture the same size in each and black past it: Rush 2049's at 16:9, 533x301 and 533x275 every two
// frames, a 489x275 picture in both. Matched whole, a frame of another size than the one before starts the matching
// again, and with sizes taking turns every two frames no three in a row are compared: 422 of Rush 2049's 2150 were.
// So every frame is cut to the box before it is matched. The box is the smallest of the sizes at least half as many of
// those frames have as the commonest size does, so a dump that starts before its plan sizes the window (Rayman 2's
// first 129 frames at 300x224, then 533x300) takes the size the plan set, and a frame smaller than it is matched whole,
// starting the matching again.
// Where those sizes differ, the box is less the columns and rows at its right and bottom that are black in each of 64
// frames taken across those seconds; a dump in one size is its own box, so a picture the game itself pillarboxes isn't
// cut on one side only. Its shape is the picture's, which the sides check takes too (sidesOf()).
function pictureBox(d) {
    const fd = fs.openSync(path.join(d, 'frames.bin'), 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(HEADER);
    const at = [];
    const sizes = new Map();
    let startMs = null;
    for (let o = 0; o + HEADER <= size;) {
        fs.readSync(fd, head, 0, HEADER, o);
        const fw = head.readUInt32LE(4), fh = head.readUInt32LE(8);
        if ((head.readUInt32LE(0) !== MAGIC) || (o + HEADER + fw * fh * 3 > size)) {
            break;
        }
        const timeMs = Number(head.readBigUInt64LE(32));
        startMs ??= timeMs;
        const t = (timeMs - startMs) / 1000;
        if (t > to) {
            break;
        }
        if (t >= from) {
            at.push([o + HEADER, fw, fh]);
            sizes.set(`${fw}x${fh}`, (sizes.get(`${fw}x${fh}`) ?? 0) + 1);
        }
        o += HEADER + fw * fh * 3;
    }
    if (!at.length) {
        fs.closeSync(fd);
        return null;
    }
    const most = Math.max(...sizes.values());
    const common = [...sizes].filter(([, c]) => c * 2 >= most).map(([s]) => s.split('x').map(Number));
    const w = Math.min(...common.map(([fw]) => fw)), h = Math.min(...common.map(([, fh]) => fh));
    if (common.length === 1) {
        fs.closeSync(fd);
        return { w, h };
    }
    const fit = at.filter(([, fw, fh]) => (fw >= w) && (fh >= h));
    const cols = new Uint8Array(w), rows = new Uint8Array(h);
    const SAMPLES = 64;
    for (let k = 0; k < SAMPLES; k++) {
        const [o, fw] = fit[Math.floor(k * fit.length / SAMPLES)];
        const rgb = Buffer.alloc(fw * h * 3);
        fs.readSync(fd, rgb, 0, rgb.length, o);
        for (let y = 0; y < h; y++) {
            for (let x = 0, p = y * fw * 3; x < w; x++, p += 3) {
                const v = Math.max(rgb[p], rgb[p + 1], rgb[p + 2]);
                cols[x] = Math.max(cols[x], v);
                rows[y] = Math.max(rows[y], v);
            }
        }
    }
    fs.closeSync(fd);
    let bw = w, bh = h;
    while ((bw > 1) && (cols[bw - 1] <= 8)) {
        bw--;
    }
    while ((bh > 1) && (rows[bh - 1] <= 8)) {
        bh--;
    }
    // A dump dark throughout keeps the smallest common size.
    return ((bw < w / 2) || (bh < h / 2)) ? { w, h } : { w: bw, h: bh };
}
let box = null; // the picture's box in dir's frames: pictureBox(), once readFrames() starts

// The frames between --from and --to, one at a time, each { t (s since the first), n (its place in the dump),
// presentId, index, count, dropped, w, h, rgb }, cut to the picture's box. frames.bin is read a frame at a time, never
// whole: a dump at a 240 Hz display's rate is about 160 MB a second, Node reads no file over 2 GiB at once, and the
// check keeps three frames.
function* readFrames() {
    const file = path.join(dir, 'frames.bin');
    if (!fs.existsSync(file)) {
        return;
    }
    box ??= pictureBox(dir);
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(HEADER);
    for (let o = 0, n = 0; o + HEADER <= size; n++) {
        fs.readSync(fd, head, 0, HEADER, o);
        if (head.readUInt32LE(0) !== MAGIC) {
            console.error(`frames.bin: no frame header at byte ${o}`);
            process.exit(2);
        }
        const w = head.readUInt32LE(4), h = head.readUInt32LE(8);
        const bytes = w * h * 3;
        if (o + HEADER + bytes > size) {
            break; // the last frame, cut off as the game was stopped
        }
        const timeMs = Number(head.readBigUInt64LE(32));
        dumpStartMs ??= timeMs;
        const t = (timeMs - dumpStartMs) / 1000;
        if (t > to) {
            break;
        }
        if (t >= from) {
            // Cut to the picture's box: its rows, then its columns of each. A frame smaller than the box is kept whole.
            const [cw, ch] = ((w >= box.w) && (h >= box.h)) ? [box.w, box.h] : [w, h];
            const whole = Buffer.allocUnsafe(w * ch * 3);
            fs.readSync(fd, whole, 0, whole.length, o + HEADER);
            let rgb = whole;
            if (w !== cw) {
                rgb = Buffer.allocUnsafe(cw * ch * 3);
                for (let y = 0; y < ch; y++) {
                    whole.copy(rgb, y * cw * 3, y * w * 3, (y * w + cw) * 3);
                }
            }
            yield {
                n, t, index: head.readUInt32LE(12), count: head.readUInt32LE(16), dropped: head.readUInt32LE(20),
                presentId: Number(head.readBigUInt64LE(24)), w: cw, h: ch, rgb,
            };
        }
        o += HEADER + bytes;
    }
    fs.closeSync(fd);
}

// A grey copy of a frame, gw x gh, box-filtered.
function grey(f, gw, gh) {
    const out = new Float32Array(gw * gh);
    const sx = f.w / gw, sy = f.h / gh;
    for (let y = 0; y < gh; y++) {
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        for (let x = 0; x < gw; x++) {
            const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
            let sum = 0;
            for (let yy = y0; yy < y1; yy++) {
                let p = (yy * f.w + x0) * 3;
                for (let xx = x0; xx < x1; xx++, p += 3) {
                    sum += 0.299 * f.rgb[p] + 0.587 * f.rgb[p + 1] + 0.114 * f.rgb[p + 2];
                }
            }
            out[y * gw + x] = sum / ((y1 - y0) * (x1 - x0));
        }
    }
    return out;
}

function quarter(g, gw, gh) {
    const qw = gw >> 2, qh = gh >> 2, out = new Float32Array(qw * qh);
    for (let y = 0; y < qh; y++) {
        for (let x = 0; x < qw; x++) {
            let s = 0;
            for (let yy = 0; yy < 4; yy++) {
                for (let xx = 0; xx < 4; xx++) {
                    s += g[(y * 4 + yy) * gw + x * 4 + xx];
                }
            }
            out[y * qw + x] = s / 16;
        }
    }
    return out;
}

// How the picture a moved to become b, in grey pixels: the shift of the quarter-size copies that matches best.
function shiftOf(qa, qb, qw, qh, x0 = 0, x1 = qw, y0 = 0, y1 = qh) {
    let best = Infinity, by = 0, bx = 0;
    const m = G + 1;
    const ya = Math.max(y0, m), yz = Math.min(y1, qh - m), xa = Math.max(x0, m), xz = Math.min(x1, qw - m);
    for (let dy = -G; dy <= G; dy++) {
        for (let dx = -G; dx <= G; dx++) {
            let s = 0;
            for (let y = ya; y < yz; y++) {
                const ra = y * qw, rb = (y + dy) * qw + dx;
                for (let x = xa; x < xz; x++) {
                    s += Math.abs(qa[ra + x] - qb[rb + x]);
                }
            }
            if (s < best) {
                best = s; by = dy; bx = dx;
            }
        }
    }
    return [by * 4, bx * 4];
}

// Where each block of a is looked for in b: where the picture as a whole moved, and where the block itself and what
// lies around it moved (on the quarter-size copies, over the block and M quarter pixels around it), as
// [cy0, cx0, cy1, cx1], each an array of a value a block. A picture whose parts move apart (a screen split open from
// its middle, a scene's near and far parts) has parts the whole's shift misses by more than a block's search reaches.
function placesOf(qa, qb, qw, qh, bw, bh) {
    const [gy, gx] = shiftOf(qa, qb, qw, qh);
    const n = bw * bh;
    const cy0 = new Int16Array(n).fill(gy), cx0 = new Int16Array(n).fill(gx);
    const cy1 = new Int16Array(n), cx1 = new Int16Array(n);
    const q = B / 4; // a block's size in quarter pixels
    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            const y0 = Math.max(by * q - M, 0), y1 = Math.min((by + 1) * q + M, qh);
            const x0 = Math.max(bx * q - M, 0), x1 = Math.min((bx + 1) * q + M, qw);
            let best = Infinity, sy = 0, sx = 0;
            for (let dy = -G; dy <= G; dy++) {
                for (let dx = -G; dx <= G; dx++) {
                    let s = 0;
                    for (let y = y0; y < y1; y++) {
                        const yy = Math.min(Math.max(y + dy, 0), qh - 1);
                        for (let x = x0; x < x1; x++) {
                            s += Math.abs(qa[y * qw + x] - qb[yy * qw + Math.min(Math.max(x + dx, 0), qw - 1)]);
                        }
                    }
                    if (s < best) {
                        best = s; sy = dy; sx = dx;
                    }
                }
            }
            cy1[by * bw + bx] = sy * 4;
            cx1[by * bw + bx] = sx * 4;
        }
    }
    return [cy0, cx0, cy1, cx1];
}

// For each block of a, its mean absolute difference to the best place in b within R of either of its places
// (placesOf()), and that place, as a shift, in best.dy and best.dx.
function explain(a, b, gw, gh, places) {
    const bw = gw / B | 0, bh = gh / B | 0;
    const best = new Float32Array(bw * bh).fill(Infinity);
    best.dy = new Int16Array(bw * bh);
    best.dx = new Int16Array(bw * bh);
    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            const k = by * bw + bx;
            for (let p = 0; p < 2; p++) {
                const sy = places[p * 2][k], sx = places[p * 2 + 1][k];
                if ((p === 1) && (sy === places[0][k]) && (sx === places[1][k])) {
                    continue;
                }
                for (let dy = sy - R; dy <= sy + R; dy++) {
                    for (let dx = sx - R; dx <= sx + R; dx++) {
                        let s = 0;
                        for (let y = 0; y < B; y++) {
                            const ay = by * B + y;
                            const yy = Math.min(Math.max(ay + dy, 0), gh - 1);
                            const ra = ay * gw, rb = yy * gw;
                            for (let x = 0; x < B; x++) {
                                const ax = bx * B + x;
                                const xx = Math.min(Math.max(ax + dx, 0), gw - 1);
                                s += Math.abs(a[ra + ax] - b[rb + xx]);
                            }
                        }
                        s /= B * B;
                        if (s < best[k]) {
                            best[k] = s;
                            best.dy[k] = dy;
                            best.dx[k] = dx;
                        }
                    }
                }
            }
        }
    }
    return best;
}

// Block k of c against a and b each about its best place (explain()'s), each pixel against the closest pixel of either
// within P of there: a block half one picture and half the other (the edge of a wipe that moved between them), or
// stretched a little (a wipe that scales), is explained, a model where neither has anything like it nearby isn't.
function eitherDiff(c, a, b, ea, eb, k, gw, gh) {
    const bw = gw / B | 0;
    const by = Math.floor(k / bw), bx = k % bw;
    const ady = ea.dy[k], adx = ea.dx[k], bdy = eb.dy[k], bdx = eb.dx[k];
    const clampY = (y) => Math.min(Math.max(y, 0), gh - 1), clampX = (x) => Math.min(Math.max(x, 0), gw - 1);
    let s = 0;
    for (let y = by * B; y < (by + 1) * B; y++) {
        for (let x = bx * B; x < (bx + 1) * B; x++) {
            const v = c[y * gw + x];
            let m = Infinity;
            for (let py = -P; py <= P; py++) {
                const ya = clampY(y + ady + py) * gw, yb = clampY(y + bdy + py) * gw;
                for (let px = -P; px <= P; px++) {
                    m = Math.min(m, Math.abs(v - a[ya + clampX(x + adx + px)]), Math.abs(v - b[yb + clampX(x + bdx + px)]));
                }
            }
            s += m;
        }
    }
    return s / (B * B);
}

// Block k of c as a blend of a's and b's about their best places (explain()'s): a + t (b - a), the t that fits best
// between 0 and 1, its mean absolute difference. A fade or a dissolve draws a frame between two of the game's that is
// neither, but lies between them pixel by pixel.
function blendDiff(c, a, b, ea, eb, k, gw, gh) {
    const bw = gw / B | 0;
    const by = Math.floor(k / bw), bx = k % bw;
    const clampY = (y) => Math.min(Math.max(y, 0), gh - 1), clampX = (x) => Math.min(Math.max(x, 0), gw - 1);
    const cs = [], as = [], bs = [];
    let num = 0, den = 0;
    for (let y = by * B; y < (by + 1) * B; y++) {
        for (let x = bx * B; x < (bx + 1) * B; x++) {
            const v = c[y * gw + x];
            const va = a[clampY(y + ea.dy[k]) * gw + clampX(x + ea.dx[k])];
            const vb = b[clampY(y + eb.dy[k]) * gw + clampX(x + eb.dx[k])];
            cs.push(v); as.push(va); bs.push(vb);
            num += (v - va) * (vb - va);
            den += (vb - va) * (vb - va);
        }
    }
    const t = den ? Math.min(Math.max(num / den, 0), 1) : 0;
    let s = 0;
    for (let i = 0; i < cs.length; i++) {
        s += Math.abs(cs[i] - as[i] - t * (bs[i] - as[i]));
    }
    return s / cs.length;
}

// The mean absolute difference of a to b moved by (dy, dx) grey pixels, over a's pixels whose place in b lies inside it.
function shiftedDiff(a, b, gw, gh, dy, dx) {
    let s = 0, n = 0;
    for (let y = Math.max(0, -dy); y < Math.min(gh, gh - dy); y++) {
        for (let x = Math.max(0, -dx); x < Math.min(gw, gw - dx); x++) {
            s += Math.abs(a[y * gw + x] - b[(y + dy) * gw + x + dx]);
            n++;
        }
    }
    return s / Math.max(n, 1);
}

function meanDiff(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        s += Math.abs(a[i] - b[i]);
    }
    return s / a.length;
}

// A PNG of rows of RGB, for --save.
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

function saveTriplet(name, fs3, blocks, gw) {
    const f = fs3[1];
    const out = Buffer.alloc(f.w * 3 * f.h * 3);
    fs3.forEach((g, i) => {
        for (let y = 0; y < f.h; y++) {
            g.rgb.copy(out, (y * f.w * 3 + i * f.w) * 3, y * f.w * 3, (y + 1) * f.w * 3);
        }
    });
    const scale = f.w / gw;
    const bw = gw / B | 0;
    for (const k of blocks) {
        const x0 = Math.floor((k % bw) * B * scale) + f.w, y0 = Math.floor(Math.floor(k / bw) * B * scale);
        const s = Math.ceil(B * scale);
        for (let i = 0; i < s; i++) {
            for (const [x, y] of [[x0 + i, y0], [x0 + i, y0 + s - 1], [x0, y0 + i], [x0 + s - 1, y0 + i]]) {
                if (x < f.w * 3 && y < f.h) {
                    const p = (y * f.w * 3 + x) * 3;
                    out[p] = 255; out[p + 1] = 0; out[p + 2] = 255;
                }
            }
        }
    }
    fs.writeFileSync(path.join(saveDir, name), png(f.w * 3, f.h, out));
}

let failed = false;
if (saveDir) {
    fs.mkdirSync(saveDir, { recursive: true });
}
// Each frame matched against the kept frames either side of it as the frames are read, in runs of one size (a resized
// window, a screen the game draws at another size starts a run), repeats left out.
const flagged = [];
let checked = 0, repeats = 0, dropped = 0, presented = 0, between = 0, first = null, last = null, run = null;
let untested = false;
const sizes = new Set();
// The game's frames, each against the one before it, and the frames RT64 drew between the two (a present's frames
// before its last, which is the game's). Gathered until the present's own frame comes, and checked only where the dump
// has the present whole and the game's frame before it.
function checkPresent(e, run) {
    const f = e.f;
    if (f.dropped || (f.index === 0)) {
        run.between = [];
    }
    if ((f.count < 2) || (f.index !== run.between.length)) {
        run.between = [];
        run.game = (f.index === f.count - 1) ? e : null;
        return;
    }
    if (f.index < f.count - 1) {
        run.between.push(e);
        return;
    }
    if (run.game && (run.game.f.presentId === f.presentId - 1)) {
        const { gw, gh } = run, qw = gw >> 2, qh = gh >> 2, a = run.game;
        const s = shiftOf(a.q, e.q, qw, qh);
        const D = shiftedDiff(a.g, e.g, gw, gh, s[0], s[1]);
        let partway = 0, worst = null, whole = 0;
        if (D >= CUT) {
            // Part by part (explain()'s blocks, each where it fits best): how unlike the two are, and each frame drawn
            // between them unlike both. A frame of the new shot whose parts move on (a model, an animated texture)
            // fits it part by part; one of a camera partway between the shots fits neither anywhere.
            const bw = gw / B | 0, bh = gh / B | 0;
            const inner = (x) => {
                let m = 0;
                for (let by = 1; by < bh - 1; by++) {
                    for (let bx = 1; bx < bw - 1; bx++) {
                        m += x[by * bw + bx];
                    }
                }
                return m / ((bw - 2) * (bh - 2));
            };
            const ae = explain(e.g, a.g, gw, gh, placesOf(e.q, a.q, qw, qh, bw, bh));
            const apart = Math.max(inner(ae), 1);
            whole = inner(ae.map((x) => +(x > BAD)));
            for (const c of run.between) {
                const ea = explain(c.g, a.g, gw, gh, placesOf(c.q, a.q, qw, qh, bw, bh));
                const eb = explain(c.g, e.g, gw, gh, placesOf(c.q, e.q, qw, qh, bw, bh));
                for (let i = 0; i < ea.length; i++) {
                    ea[i] = Math.min(ea[i], eb[i]);
                }
                const unlike = inner(ea) / apart;
                if (unlike >= partway) {
                    partway = unlike;
                    worst = c;
                }
            }
        }
        run.presents.push({ f, D, partway, whole, frames: worst && [a.f, worst.f, f] });
        if (run.presents.length === 3) {
            checkCut(run.presents);
            run.presents.shift();
        }
    }
    else {
        run.presents = [];
    }
    run.between = [];
    run.game = e;
}

// A cut: the game's two frames in a row far apart where the frames before and after them move little, the camera
// jumping in one frame. Every frame drawn between the two should be the new shot (or the old), as the game draws no
// frame between them; one that is neither is the camera drawn partway from one shot to the other, the whole picture
// swept or stretched across for a moment.
function checkCut([before, p, after]) {
    if ((p.D < CUT) || (p.D < CUT_JUMP * Math.max(before.D, after.D)) || (p.whole < CUT_WHOLE)) {
        return;
    }
    cuts.push(p);
    if (p.partway >= CUT_PARTWAY) {
        cutsPartway.push(p);
        if (saveDir) {
            saveTriplet(`cut-${String(p.frames[1].n).padStart(5, '0')}.png`, p.frames, [], 1);
        }
    }
    p.frames = null;
}
const cuts = [], cutsPartway = [];

function checkMiddle({ gw, gh, kept }) {
    const qw = gw >> 2, qh = gh >> 2;
    const bw = gw / B | 0, bh = gh / B | 0;
    const [a, c, b] = kept;
    checked++;
    const ea = explain(c.g, a.g, gw, gh, placesOf(c.q, a.q, qw, qh, bw, bh));
    const eb = explain(c.g, b.g, gw, gh, placesOf(c.q, b.q, qw, qh, bw, bh));
    // Where the neighbours match each other: a's blocks against b.
    const eab = explain(a.g, b.g, gw, gh, placesOf(a.q, b.q, qw, qh, bw, bh));
    const bad = [];
    for (let by = 1; by < bh - 1; by++) {
        for (let bx = 1; bx < bw - 1; bx++) {
            const i = by * bw + bx;
            let e = Math.min(ea[i], eb[i]);
            if (e > BAD) {
                e = eitherDiff(c.g, a.g, b.g, ea, eb, i, gw, gh);
            }
            if (e > BAD) {
                e = Math.min(e, blendDiff(c.g, a.g, b.g, ea, eb, i, gw, gh));
            }
            // a's block that c's block i matched, roughly: i shifted by its match in a, in blocks
            const ay = Math.min(Math.max(by + Math.round(ea.dy[i] / B), 0), bh - 1);
            const ax = Math.min(Math.max(bx + Math.round(ea.dx[i] / B), 0), bw - 1);
            const base = eab[ay * bw + ax];
            if ((e > BAD) && (e > RATIO * base + 4)) {
                bad.push(i);
            }
        }
    }
    if (process.env.FC_DEBUG) {
        let ab = 0, u = 0, n = 0;
        for (let by = 1; by < bh - 1; by++) {
            for (let bx = 1; bx < bw - 1; bx++) {
                const i = by * bw + bx;
                ab += +(eab[i] > BAD); u += +(Math.min(ea[i], eb[i]) > BAD); n++;
            }
        }
        console.log(`DEBUG${(bad.length >= MIN_BLOCKS) ? "!" : " "} frame ${c.f.n} ${c.f.t.toFixed(2)} idx ${c.f.index}/${c.f.count} bad ${bad.length} apart ${(ab / n).toFixed(2)} unlike ${(u / n).toFixed(2)}`);
    }
    if (bad.length >= MIN_BLOCKS) {
        flagged.push({ c: { f: { ...c.f, rgb: null } }, bad, bw, bh });
        if (saveDir) {
            saveTriplet(`unlike-${String(c.f.n).padStart(5, '0')}.png`, [a.f, c.f, b.f], bad, gw);
        }
    }
}
for (const f of readFrames()) {
    presented++;
    first ??= f;
    last = f;
    dropped += f.dropped;
    between += (f.index > 0) ? 1 : 0;
    sizes.add(`${f.w}x${f.h}`);
    if (!run || (run.w !== f.w) || (run.h !== f.h)) {
        run = { w: f.w, h: f.h, gw: Math.floor(W / B) * B, gh: Math.floor(W * f.h / f.w / B) * B, kept: [], game: null,
            between: [], presents: [] };
    }
    const g = grey(f, run.gw, run.gh);
    const entry = { f, g, q: quarter(g, run.gw, run.gh) };
    checkPresent(entry, run);
    if (run.kept.length && (meanDiff(g, run.kept[run.kept.length - 1].g) < 0.05)) {
        repeats++;
        continue;
    }
    run.kept.push(entry);
    if (run.kept.length === 3) {
        checkMiddle(run);
        run.kept.shift();
    }
}
if (presented >= 3) {
    // 3 or more flagged frames within a second, anywhere.
    let burst = 0;
    for (let i = 0, j = 0; i < flagged.length; i++) {
        while (flagged[i].c.f.t - flagged[j].c.f.t > 1) {
            j++;
        }
        burst = Math.max(burst, i - j + 1);
    }
    checked = Math.max(checked, 1);
    const fail = (flagged.length * 100 > checked) || (burst >= 3);
    failed ||= fail;
    console.log(`frames: ${presented} presented over ${(last.t - first.t).toFixed(1)} s, ${between} of them between the` +
        ` game's own (${repeats} repeats, ${dropped} dropped by the dump), ${[...sizes].join(', ')}`);
    if (!between) {
        untested = true;
        console.log('frames: none presented between the game\'s own, so nothing tests how they are paired: dump at' +
            ' Framerate Display on a display faster than the game');
    }
    console.log(`unlike both neighbours: ${flagged.length} of ${checked} frames, at most ${burst} within a second: ` +
        (fail ? 'FAILS' : 'passes'));
    if (!quiet) {
        for (const { c, bad, bw, bh } of flagged.slice(0, 40)) {
            const xs = bad.map((i) => i % bw), ys = bad.map((i) => Math.floor(i / bw));
            console.log(`  frame ${c.f.n} at ${c.f.t.toFixed(2)} s (present ${c.f.presentId}, ${c.f.index + 1} of ${c.f.count}):` +
                ` ${bad.length} blocks, x ${(Math.min(...xs) / bw).toFixed(2)}-${((Math.max(...xs) + 1) / bw).toFixed(2)}` +
                ` y ${(Math.min(...ys) / bh).toFixed(2)}-${((Math.max(...ys) + 1) / bh).toFixed(2)} of the picture`);
        }
        if (flagged.length > 40) {
            console.log(`  ... and ${flagged.length - 40} more`);
        }
    }
    const cutFail = cutsPartway.length > 0;
    failed ||= cutFail;
    console.log(`camera cuts: ${cuts.length} among the game's frames, ${cutsPartway.length} with a frame between drawn ` +
        `partway from one shot to the other: ` + (cutFail ? 'FAILS' : (cuts.length ? 'passes' : 'none to test')));
    if (!quiet) {
        for (const p of cuts) {
            console.log(`  present ${p.f.presentId} at ${p.f.t.toFixed(2)} s (frame ${p.f.n}): ${p.D.toFixed(1)} apart, ` +
                `${p.whole.toFixed(2)} of its blocks, between them ${p.partway.toFixed(2)} of that unlike both` + ((p.partway >= CUT_PARTWAY) ? ', PARTWAY' : ''));
        }
    }
}
else {
    console.log('frames: fewer than 3 in frames.bin, nothing to match');
}

// Sides: sides.tsv's bands are a twentieth of the view's width each, from one view left of it to one right, each
// workload's triangles counted by where their middles lie.
const PER = 20;
// A dump's 3D workloads (200 triangles or more) between --from and --to: their mean count a band, and the picture's
// shape: its picture's box between those seconds (pictureBox()), so a dump that starts before its plan sizes the window
// (Rayman 2's first 2 s of frames at 4:3 in a 16:9 window) reads the size the plan set, and one whose frames come in
// several sizes (Rush 2049's) reads its picture's, not its color target's.
function sidesOf(d) {
    const file = path.join(d, 'sides.tsv');
    const framesFile = path.join(d, 'frames.bin');
    if (!fs.existsSync(file) || !fs.existsSync(framesFile)) {
        return null;
    }
    const shape = pictureBox(d);
    if (!shape) {
        return null;
    }
    const head = Buffer.alloc(HEADER);
    const fd = fs.openSync(framesFile, 'r');
    fs.readSync(fd, head, 0, HEADER, 0);
    fs.closeSync(fd);
    const startMs = Number(head.readBigUInt64LE(32)); // the dump's second 0
    const mean = new Array(PER * 3).fill(0);
    let n = 0;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        // <workload id>\t<ms since 1970>\t<a count a band>...
        const cols = line.split('\t').map(Number);
        const v = cols.slice(2);
        const t = (cols[1] - startMs) / 1000;
        if ((v.length !== PER * 3) || !(t >= from) || !(t <= to) || (v.reduce((a, b) => a + b, 0) < 200)) {
            continue;
        }
        v.forEach((c, i) => { mean[i] += c; });
        n++;
    }
    return { n, mean: mean.map((c) => c / Math.max(n, 1)), aspect: shape.w / shape.h };
}
// The mean triangles a workload with their middles past the 4:3 view's sides, from a to b view widths out on each.
const pastSides = (s, a, b) => {
    let sum = 0;
    for (let i = Math.round(a * PER); i < Math.round(b * PER); i++) {
        sum += s.mean[PER - 1 - i] + s.mean[2 * PER + i];
    }
    return sum;
};
// ... and a band's mean of them there, both sides together.
const perBand = (s, a, b) => pastSides(s, a, b) / Math.max(Math.round(b * PER) - Math.round(a * PER), 1);
const insideView = (s) => s.mean.slice(PER, 2 * PER).reduce((a, b) => a + b, 0);
const sides = sidesOf(dir);
if (sides && sides.n && widerDir) {
    const wider = sidesOf(widerDir);
    const extOf = (aspect) => (aspect / (4 / 3) - 1) / 2; // a picture's strip past each side of the view, in view widths
    if (!wider || !wider.n) {
        console.error(`sides: no 3D in ${widerDir}'s dump between those seconds`);
        process.exit(2);
    }
    const a = extOf(sides.aspect), b = Math.min(extOf(wider.aspect), 1);
    const inA = insideView(sides), inB = insideView(wider);
    if (b - a < 0.2) {
        console.error(`sides: ${widerDir}'s picture (${wider.aspect.toFixed(2)}:1) is too little wider than ${dir}'s ` +
            `(${sides.aspect.toFixed(2)}:1): dump it at 32:9`);
        process.exit(2);
    }
    if (Math.abs(inA - inB) > 0.1 * Math.max(inA, inB)) {
        console.error(`sides: the two dumps draw ${inA.toFixed(0)} and ${inB.toFixed(0)} triangles a workload inside the 4:3 ` +
            'view: not the same scene, so play the same plan and seconds in both');
        process.exit(2);
    }
    // Between the narrower picture's edge and the wider one's, where only the wider picture shows the world.
    const pastA = pastSides(sides, a, b), pastB = pastSides(wider, a, b);
    const grows = pastB / Math.max(pastA, 1);
    // Drawn as densely there as inside the view, a world isn't culled at the sides at all: nothing to grow.
    const density = (pastB / (2 * (b - a))) / Math.max(inB, 1);
    // Drawn past the narrower picture's own edge (as far out again as the edge is) as densely as just inside it, a world
    // isn't culled by the window: it draws the same whatever the window, so it doesn't grow, and isn't culled to 4:3.
    const open = perBand(sides, a, 2 * a) / Math.max(perBand(sides, 0, a), 1);
    const unmet = (grows < SIDES_GROW) && (density < SIDES_DENSE) && (open < SIDES_OPEN);
    // A scene that draws next to nothing past the view can't show the growth: a fifth of a few dozen triangles is an
    // object or two, whose triangles a game culling to the picture draws whole in both windows once it reaches into the
    // narrower one.
    const few = unmet && (pastB < SIDES_FEW);
    const fail = unmet && !few;
    failed ||= fail;
    untested ||= few;
    console.log(`sides: ${a.toFixed(2)}-${b.toFixed(2)} of the view past the 4:3 view's sides, ${pastA.toFixed(0)} triangles` +
        ` a workload at ${sides.aspect.toFixed(2)}:1 and ${pastB.toFixed(0)} at ${wider.aspect.toFixed(2)}:1` +
        ` (x${grows.toFixed(2)}; ${density.toFixed(2)} of the view's density; ${open.toFixed(2)} as dense past the` +
        ` ${sides.aspect.toFixed(2)}:1 picture's edge as inside it), over ${sides.n} and ${wider.n} workloads: ` +
        (fail ? 'FAILS, the world past the 4:3 view doesn\'t grow with the picture: culled to the 4:3 view' :
            few ? `untested, too little drawn past the view to tell (under ${SIDES_FEW} triangles a workload): a scene ` +
                'that draws more there tests it' : 'passes'));
}
else if (sides && sides.n) {
    const ext = (sides.aspect / (4 / 3) - 1) / 2;
    console.log(`sides: ${pastSides(sides, 0, ext).toFixed(0)} triangles a workload past the 4:3 view's sides in the` +
        ` ${sides.aspect.toFixed(2)}:1 picture, ${insideView(sides).toFixed(0)} inside it, over ${sides.n} workloads;` +
        ' --wider <a dump of the same plan at 32:9> checks the culling');
}
else {
    console.log('sides: no workload drew 200 triangles between those seconds');
}
process.exit(failed ? 1 : (untested ? 2 : 0));
