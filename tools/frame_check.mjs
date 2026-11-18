// Checks a game's picture by machine, from what RT64 writes with RT64_FRAME_DUMP=<dir> set (rt64-web's
// src/hle/rt64_frame_dump.h): docs/new-recomp.md item 2's flicker and interpolation and item 1's widescreen culling,
// which a person or a model looking at captures missed (Mario Golf's trees put where other trees stood in every frame
// drawn between the game's, and its ground culled at the 4:3 view's sides), and which these find without anyone
// looking.
//
//   node tools/frame_check.mjs <dir> [--narrower <dir> --wider <dir>] [--from <s>] [--to <s>] [--save <dir>] [--quiet]
//
// <dir> is a dump's: frames.bin, every frame presented, and sides.tsv, where across the view the 3D's triangles lay.
// --narrower and --wider name two dumps of the same plan for the sides, one in a 4:3 window and one at 32:9. --from and
// --to keep what came between those seconds of the dumps, counted from each one's first frame; --save writes each
// flagged frame with the frames either side of it as one PNG, its flagged blocks outlined, for whoever wants to see
// one. It matches the frames on a worker thread a core: 20 s of Turok's 640x360 frames at 120 a second (1025 matched)
// took 88 s on a 12-core host already 100% busy, where one thread took 17 minutes.
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
//   the scene lasts. A frame between two of the game's own that differ over a fifth to a half of the picture (the
//   share of the newer one's blocks with nothing like them near in the older, as the camera cuts' check reads it), where
//   the game's frames before or after differ as much too, isn't counted, nor the game's frame at either end, and they are
//   listed apart: something passing close to the camera, game frame after game frame, moves further from frame to
//   frame than a block's match follows, and the frames between are the camera's own path. Turok: Dinosaur Hunter's
//   title fly-over swoops through plants for a quarter of a second, its game frames 0.23-0.40 apart five in a row, a
//   leaf filling a frame between; 4 of its 5 frames flagged within a third of a second go uncounted, and the last,
//   after a lone jump of 0.35, counts. A cut is a lone jump (Mario Golf's to the tee after hole 1's flyover, 0.30 between
//   game frames 0.00 apart either side), and over half is a new shot: both stay counted. A pairing fault changes only
//   the frames between, never the game's own, so where the game moves little it still fails: Mario Golf's hole 1
//   flyover, whose trees its build without rt64 eda3964 put where other trees stood, has game frames at most 0.09
//   apart, and Turok 2's world missing at the picture's edge as the player turns lies between game frames 0.01-0.05
//   apart. A fault drawn while something passes that close to the camera goes unseen. A frame between the game's own
//   with fewer blocks than 4 counts where 3 others between, within a second either side, have theirs within 4 blocks
//   of its: one small thing paired wrongly, again and again in one place, where the odd small block of a clean game
//   lands anywhere. Mario Party 3's opening without its models' tags (lib/mario-party-engine's model_ids.cpp) draws a
//   small star for a frame where neither neighbour has it, at one place in every frame between for 0.3 s, 1-2 blocks
//   each: 23 of 689 frames flagged, 11 without this; with the tags, 3 of 654 either way. On Rayman 2's, Turok 2's and
//   3's and Rush 2049's dumps it changes no verdict, and adds nothing to the ones that pass.
//   Only frames presented between the game's own (Framerate Display, on a display faster than the
//   game) are paired, so a dump without one (Framerate Original, a 60 Hz display under a game of 60) leaves pairing
//   untested and exits 2, whatever else passes. A game of 60 is dumped with RT64_FRAME_DUMP_RATE=120 set beside
//   RT64_FRAME_DUMP, which presents at 120 with vsync off whatever the display's rate (rt64-web's rt64_frame_dump.h).
// - Camera cuts drawn partway. A cut is two of the game's frames in a row far apart (a mean difference of 8 of 255
//   after the best shift of one against the other) where the game's frames before and after them are at least twice as
//   near: the camera jumps in one frame. RT64 interpolates a camera unless the game says it cut, so a cut the game
//   doesn't mark is drawn partway, the whole picture swept or stretched from one shot to the other for a frame or three,
//   which the check above can't see: neither neighbour matches the frames before or after it, as at any cut. Every frame
//   drawn between the two should be the new shot or the old, its parts moved on as they move (a model, an animated
//   texture): block by block, each to its best place in either, one unlike both by 0.3 or more of how unlike the two
//   are to each other fails. A game camera that moves that far in one frame and that little either side is a cut,
//   whatever the game meant by it, if it is a new shot: half or more of the new frame's blocks (the picture's edge left
//   out) match nothing near them in the old, or a tenth or more where it jumps 3 times as far as the game's frames
//   either side or more. A near object passing the camera changes the picture as much and only in part, and its frames
//   between are the camera's own, rightly drawn: Turok: Dinosaur Hunter's title fly-over goes through a leaf between
//   two of the game's frames, changing 0.35 of the picture, 2.4 times as far as either side, and the frame drawn between
//   them is the leaf, 0.94 unlike both. A cut to a shot that shares much of the old one's picture changes less of it,
//   but alone: Mario Golf's from hole 1's fly-over to the tee changes 0.30, 24 times as far as either side, and two of
//   Turok 2's 0.29 and 0.21, 49 and 58 times. Turok 2's cinematics' cuts change 0.62-0.80 of theirs where they are
//   lit; a cut between two dark shots, whose blocks differ by less than a block's match allows, reads lower, and under a
//   tenth goes untested.
// - Culled at the 4:3 view's sides, from two more dumps of the same plan: one --narrower in a 4:3 window, where
//   nothing past the view shows, and one --wider at 32:9. A game that culls its world to the picture draws more of it
//   past the view's sides at 32:9 than in the 4:3 window; one that culls to its 4:3 view draws the same in both, what
//   reaches over the view's edge from inside and nothing more (water or sky where the ground goes on). Each workload of
//   3D (200 triangles or more) at 32:9 is paired with the 4:3 dump's that draws most nearly the same inside the view
//   (its triangles counted a twentieth of the view at a time, differing by a tenth of them at most), so two runs out
//   of step, or a shot held longer in one, compare the same poses; it compares the triangles the pairs have past the
//   view's sides, out to the 32:9 picture's edges (0.83 of the view either side), by where each one's middle lies, and
//   fails where the 32:9 dump has under 1.1 times as many and draws there under half as densely as inside the view: a
//   world drawn that densely past the view isn't culled at its sides at all. A build culled to 4:3 reads x0.99-1.05 and
//   a fixed one x1.17 or more: Mario Golf's hole 1 flyover x1.02-1.05 without its patches/cull.c (57-367 triangles a
//   workload past the view) and x1.87-1.92 with it, Rayman 2's first 45 s in the Fairy Glade x0.99-1.00 without its
//   v0.1.1 and x1.21-1.22 with it, its Woods of Light opening x1.00 and x1.17, and San Francisco Rush 2049's attract
//   race, which culls whole stretches of scenery and draws its world out to the 32:9 picture's edges, x1.19-1.49. A
//   16:9 window in the 4:3 one's place tells less: it draws past the view itself, so a fixed build grows less against
//   it (Rush 2049's attract race x1.00-1.16, Rayman 2's opening x1.10), and a culled one passed Rayman 2's Fairy Glade
//   on how densely it drew there. A scene drawing under 50 triangles a workload past the view at 32:9 can't fail and
//   exits 2, too few to tell from an object or two reaching over the edge: Rayman 2's ravine down into the Woods of
//   Light, a few large walls whose middles lie inside the view, reads 29 culled and 43 fixed. A shot whose every
//   object reaches into the view draws them whole in both windows and fails whatever the build: Rayman 2's first still
//   shot of Rayman, a few cliffs, x1.00 with its v0.1.1. So a scene is picked where the world goes on past the view (a
//   course, a field, a race), and a fail is looked at in the 32:9 dump's frames before it is called the game's. A 4:3
//   window's target can be a little off 4:3 (Rush 2049's is 640x440): a --narrower dump wider than 1.6:1, a --wider
//   one narrower than 8:3, or a pair of which under 30 or a tenth of the 32:9 workloads find a match (not the same
//   scene), exits 2. Without them it only counts the triangles. One dump's own strip against the view tells nothing:
//   Mario Golf's flyover, culled or not, draws a fraction past the view's edges of what it draws inside, the course
//   being long and narrow. The picture's shape is the picture's box between --from and --to (pictureBox()), not its
//   first frame's: a dump that starts before its plan sizes the window begins at 4:3, and one whose frames come in
//   several sizes has black past the picture in some. Rayman 2's language menu draws its frames at 300x224 for its
//   first 6 s whatever the window, so --from starts a dump of it after that.
// - The picture at the 4:3 view's sides, from each dump's frames alone (pictureAtSides()), every dump given: what the
//   triangles can't read, a world past the view drawn in 2D (Mario Party's boards are a background of tiles, 3-12
//   triangles a workload past the view), and a picture something cuts. Its frames are looked at ten a second. Cut
//   short: the picture fills the view out to its side, then ends in black past it with something drawn on the black,
//   for a second or more in a row: a board whose background is drawn only under 4:3 draws its 3D spaces and characters
//   out past it. A picture that ends where its world does (a board's map reaching no further, a stage built short of a
//   wide window) has nothing on the black past it, and a 4:3 scene or a logo on black doesn't fill the view to its
//   side, so neither counts. Mario Party 3's Chilly Waters at 32:9 with its board's tiles picked under 4:3 alone
//   (lib/mario-party-engine's board_back_area() with no side) is cut short in 339 of 544 frames, 14.5 s in a row, and
//   the game as released in none of 381, though its map ends short of the window in much of them. A straight line: a
//   column within a twentieth of the view's width of its side that steps sharply in 0.3 more of its rows than the
//   columns around it (only rows drawn either side of it, so a picture's own end isn't one), in the same column in a
//   quarter or more of the frames where the scene moves, looked at four a second: something the game cuts a few
//   pixels short of the side, the picture behind it showing. Mario Party 3's opening without mario-party-engine
//   245ec52 draws its 3D grass under a scissor 8 of the console's pixels inside the screen, the background's grass in a
//   band around it: a line 6 pixels in from the view's side (a 640x180 dump at 32:9) in 32 of 56 frames where the
//   scene moves, and none with it. Turok 1's and 2's 16:9 sweeps and Mario Golf's iris wipes have neither. Neither
//   needs two runs to agree, so a board the computer players play differently each time is checked too.
//
// It exits 0 when what it checked passes, 1 when one fails, 2 on a bad dump or arguments or a dump that can't test
// the pairing or the sides. frames.bin is read a frame at a time, those the workers have yet to match kept (a few a
// worker, pool.room()): a dump at a 240 Hz display's rate is about 160 MB a second.
//
// It runs below normal priority, its workers with it: it takes every core but one, and it is run beside plays,
// builds and a person at the desktop, which come first. On an idle host that costs it nothing; on a busy one it
// takes what is left rather than making the host 100% busy for everything else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

// Before any worker starts, so each is made at it (the header says why). Best effort: a host that refuses keeps normal.
if (isMainThread) try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* runs at normal */ }

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return (i >= 0) ? args[i + 1] : fallback;
};
const dir = args[0];
if (isMainThread && (!dir || dir.startsWith('--'))) {
    console.error('usage: node tools/frame_check.mjs <dir> [--narrower <dir> --wider <dir>] [--from <s>] [--to <s>] [--save <dir>] [--quiet]');
    process.exit(2);
}
const from = Number(opt('--from', 0));
const to = Number(opt('--to', Infinity));
const saveDir = opt('--save', null);
const widerDir = opt('--wider', null);
const narrowerDir = opt('--narrower', null);
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
const NEAR_BLOCKS = 4; // ... or, drawn between the game's own, fewer within this many blocks of where
const NEAR_FRAMES = 3; // ... this many other frames drawn between had theirs
const NEAR_SECONDS = 1; // ... within this many seconds either side
const CUT = 8; // the mean difference of two of the game's frames in a row, of 255, at the least, that is a cut
const CUT_JUMP = 2; // ... and how many times the game's frames either side of them differ, at the least
const CUT_PARTWAY = 0.3; // a frame between a cut's two as unlike both, against how unlike they are: the camera partway
const CUT_WHOLE = 0.5; // ... and the share of the new frame's blocks the old one has nothing like: a new shot
const CUT_LONE = 3; // ... or, where the game's frames either side of them differ this many times less, at the least,
const CUT_PART = 0.1; // ... this share of the new frame's blocks: a new shot much like the old one
const NEAR = 0.2; // the share, at the least, of something passing near the camera: frames between not counted
const P = 2; // a pixel's search about its block's best place, in grey pixels (eitherDiff())
const M = 2; // the quarter pixels around a block that its own shift is found over (placesOf())
const SIDES_GROW = 1.1; // how many times the triangles past the 4:3 view a 32:9 picture has against a 4:3 one, at least
const SIDES_DENSE = 0.5; // ... unless the strip is this dense against the view: a world not culled at its sides
const SIDES_FEW = 50; // triangles a workload past the view in the wider picture under which a scene can't fail: too few to tell

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

// The matching runs on worker threads, this same file: each frame's against its neighbours (middleBad()) and each
// present's against the game's frames either side of it (cutParts()) needs only those frames' grey copies, so the main
// thread reads the frames in order, makes their grey copies, leaves repeats out and pairs them as before, and hands the
// matching to a worker a core.
if (!isMainThread) {
    parentPort.on('message', ({ kind, gw, gh, frames }) => {
        parentPort.postMessage((kind === 'middle') ? middleBad(gw, gh, ...frames) : cutParts(gw, gh, ...frames));
    });
    await new Promise(() => {}); // a worker runs no more of the file: the main thread ends it
}
const pool = {
    size: Math.max(os.availableParallelism() - 1, 1), // the main thread reads and greys the frames on the last core
    workers: [], idle: [], queue: [],
    // A job's result, from the first worker free. A job holds its frames' grey copies until it is posted.
    run(kind, gw, gh, entries) {
        if (!this.workers.length) {
            for (let i = 0; i < this.size; i++) {
                const w = new Worker(new URL(import.meta.url));
                w.on('message', (r) => {
                    const job = w.job;
                    w.job = null;
                    this.idle.push(w);
                    this.pump();
                    job.resolve(r);
                });
                w.on('error', (e) => {
                    console.error(e);
                    process.exit(2);
                });
                this.workers.push(w);
                this.idle.push(w);
            }
        }
        return new Promise((resolve) => {
            this.queue.push({ resolve, task: { kind, gw, gh, frames: entries.map(({ g, q }) => ({ g, q })) } });
            this.pump();
        });
    },
    pump() {
        while (this.idle.length && this.queue.length) {
            const w = this.idle.pop(), job = this.queue.shift();
            w.job = job;
            w.postMessage(job.task);
        }
        while (this.waiting.length && (this.queue.length < this.size * 2)) {
            this.waiting.shift()();
        }
    },
    waiting: [],
    // Resolves once few enough jobs wait for a worker: the frames read ahead stay a few per worker, not the whole dump.
    room() {
        return (this.queue.length < this.size * 2) ? null : new Promise((resolve) => this.waiting.push(resolve));
    },
};

let failed = false;
if (saveDir) {
    fs.mkdirSync(saveDir, { recursive: true });
}
// Each frame matched against the kept frames either side of it as the frames are read, in runs of one size (a resized
// window, a screen the game draws at another size starts a run), repeats left out. Each one's result comes back from
// its worker in its own time: middles keeps them in the frames' order.
const middles = [];
const flagged = [];
let checked = 0, repeats = 0, dropped = 0, presented = 0, between = 0, first = null, last = null, run = null;
let untested = false;
const sizes = new Set();
// The game's frames, each against the one before it, and the frames RT64 drew between the two (a present's frames
// before its last, which is the game's). Gathered until the present's own frame comes, and checked only where the dump
// has the present whole and the game's frame before it.
const cutChecks = [];
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
        const p = { f, D, partway: 0, whole: 0, frames: null };
        if (D >= CUT) {
            const between = run.between;
            p.ready = pool.run('cut', gw, gh, [a, e, ...between]).then(({ partway, whole, worst }) => {
                Object.assign(p, { partway, whole, frames: (worst >= 0) ? [a.f, between[worst].f, f] : null });
            });
        }
        moved.set(f.presentId, p);
        if (p.ready) {
            cutChecks.push(p.ready);
        }
        run.presents.push(p);
        if (run.presents.length === 3) {
            const three = [...run.presents];
            cutChecks.push(Promise.all(three.map((x) => x.ready)).then(() => checkCut(three)));
            run.presents.shift();
        }
    }
    else {
        run.presents = [];
    }
    run.between = [];
    run.game = e;
}

// Part by part (explain()'s blocks, each where it fits best): how unlike the game's frames a and e are, and each frame
// drawn between them unlike both, the worst of them by its place among them (-1 for none). A frame of the new shot
// whose parts move on (a model, an animated texture) fits it part by part; one of a camera partway between the shots
// fits neither anywhere.
function cutParts(gw, gh, a, e, ...between) {
    const qw = gw >> 2, qh = gh >> 2;
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
    const whole = inner(ae.map((x) => +(x > BAD)));
    let partway = 0, worst = -1;
    between.forEach((c, k) => {
        const ea = explain(c.g, a.g, gw, gh, placesOf(c.q, a.q, qw, qh, bw, bh));
        const eb = explain(c.g, e.g, gw, gh, placesOf(c.q, e.q, qw, qh, bw, bh));
        for (let i = 0; i < ea.length; i++) {
            ea[i] = Math.min(ea[i], eb[i]);
        }
        const unlike = inner(ea) / apart;
        if (unlike >= partway) {
            partway = unlike;
            worst = k;
        }
    });
    return { partway, whole, worst };
}

// A cut: the game's two frames in a row far apart where the frames before and after them move little, the camera
// jumping in one frame. Every frame drawn between the two should be the new shot (or the old), as the game draws no
// frame between them; one that is neither is the camera drawn partway from one shot to the other, the whole picture
// swept or stretched across for a moment.
function checkCut([before, p, after]) {
    p.jump = p.D / Math.max(before.D, after.D, 0.1);
    if ((p.D < CUT) || (p.jump < CUT_JUMP) || ((p.whole < CUT_WHOLE) && ((p.jump < CUT_LONE) || (p.whole < CUT_PART)))) {
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
// Each present checked (checkPresent()'s, whose whole is the share of its game frame's blocks with nothing like them near
// in the game frame before, 0 where they are less than CUT apart), by its id.
const moved = new Map();
// A flagged frame between two of the game's that something passing close to the camera changes in part, game frame
// after game frame: its present, or for the game's frame that ends one the next too (where its neighbour after lies),
// and a present beside that one, each NEAR to CUT_WHOLE of the picture apart. A cut, a new shot or not, is a jump the
// presents beside it don't share: Mario Golf's to the tee after hole 1's flyover, 0.30 apart between 0.00 and 0.00.
const wholeOf = (id) => moved.get(id)?.whole ?? 0;
const band = (id) => (wholeOf(id) >= NEAR) && (wholeOf(id) < CUT_WHOLE);
const nearPass = ({ f }) => [f.presentId, ...((f.index === f.count - 1) ? [f.presentId + 1] : [])]
    .some((id) => band(id) && (band(id - 1) || band(id + 1)));

// The blocks of c that neither a nor b explains, where a and b match each other.
function middleBad(gw, gh, a, c, b) {
    const qw = gw >> 2, qh = gh >> 2;
    const bw = gw / B | 0, bh = gh / B | 0;
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
    return bad;
}

function checkMiddle({ gw, gh, kept }) {
    const bw = gw / B | 0, bh = gh / B | 0;
    const [a, c, b] = kept;
    checked++;
    middles.push(pool.run('middle', gw, gh, kept).then((bad) => {
        const small = bad.length < MIN_BLOCKS;
        if (small && (!bad.length || (c.f.index === c.f.count - 1))) {
            return null;
        }
        if (saveDir) {
            saveTriplet(`${small ? 'small' : 'unlike'}-${String(c.f.n).padStart(5, '0')}.png`, [a.f, c.f, b.f], bad, gw);
        }
        return { c: { f: { ...c.f, rgb: null } }, bad, bw, bh, small };
    }));
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
    await pool.room();
}
const found = (await Promise.all(middles)).filter(Boolean);
flagged.push(...found.filter((u) => !u.small));
// Small ones drawn between that recur in one place.
const small = found.filter((u) => u.small);
const near = (u, v) => (u.bw === v.bw) && u.bad.some((i) => v.bad.some((k) =>
    (Math.abs(i % u.bw - k % v.bw) <= NEAR_BLOCKS) && (Math.abs(Math.floor(i / u.bw) - Math.floor(k / v.bw)) <= NEAR_BLOCKS)));
for (const u of small) {
    const recur = small.filter((v) => (v !== u) && (Math.abs(v.c.f.t - u.c.f.t) <= NEAR_SECONDS) && near(u, v)).length;
    const name = `-${String(u.c.f.n).padStart(5, '0')}.png`;
    if (recur >= NEAR_FRAMES) {
        flagged.push(u);
        if (saveDir) {
            fs.renameSync(path.join(saveDir, 'small' + name), path.join(saveDir, 'unlike' + name));
        }
    }
    else if (saveDir) {
        fs.rmSync(path.join(saveDir, 'small' + name));
    }
}
flagged.sort((u, v) => u.c.f.t - v.c.f.t);
await Promise.all(cutChecks);
cuts.sort((x, y) => x.f.n - y.f.n);
if (presented >= 3) {
    const passing = flagged.filter(({ c }) => nearPass(c));
    const counted = flagged.filter(({ c }) => !nearPass(c));
    // 3 or more flagged frames within a second, anywhere.
    let burst = 0;
    for (let i = 0, j = 0; i < counted.length; i++) {
        while (counted[i].c.f.t - counted[j].c.f.t > 1) {
            j++;
        }
        burst = Math.max(burst, i - j + 1);
    }
    checked = Math.max(checked, 1);
    const fail = (counted.length * 100 > checked) || (burst >= 3);
    failed ||= fail;
    console.log(`frames: ${presented} presented over ${(last.t - first.t).toFixed(1)} s, ${between} of them between the` +
        ` game's own (${repeats} repeats, ${dropped} dropped by the dump), ${[...sizes].join(', ')}`);
    if (!between) {
        untested = true;
        console.log('frames: none presented between the game\'s own, so nothing tests how they are paired: dump at' +
            ' Framerate Display on a display faster than the game, or with RT64_FRAME_DUMP_RATE=120 set too, which' +
            ' presents at 120 whatever the display\'s rate (a game of 60 on a 60 Hz display)');
    }
    console.log(`unlike both neighbours: ${counted.length} of ${checked} frames, at most ${burst} within a second: ` +
        (fail ? 'FAILS' : 'passes') + (passing.length ? ` (${passing.length} more, not counted, where something passes` +
        ` close to the camera: the game's frames ${NEAR}-${CUT_WHOLE} of the picture apart, two presents running)` : ''));
    if (!quiet) {
        for (const { c, bad, bw, bh } of flagged.slice(0, 40)) {
            const xs = bad.map((i) => i % bw), ys = bad.map((i) => Math.floor(i / bw));
            const ids = [c.f.presentId, ...((c.f.index === c.f.count - 1) ? [c.f.presentId + 1] : [])];
            console.log(`  frame ${c.f.n} at ${c.f.t.toFixed(2)} s (present ${c.f.presentId}, ${c.f.index + 1} of ${c.f.count}):` +
                ` ${bad.length} blocks, x ${(Math.min(...xs) / bw).toFixed(2)}-${((Math.max(...xs) + 1) / bw).toFixed(2)}` +
                ` y ${(Math.min(...ys) / bh).toFixed(2)}-${((Math.max(...ys) + 1) / bh).toFixed(2)} of the picture` +
                (nearPass(c) ? `, not counted: the game's frames ${ids.map((id) => wholeOf(id).toFixed(2)).join(' and ')} apart` :
                    ''));
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
                `${p.jump.toFixed(1)} times either side, ${p.whole.toFixed(2)} of its blocks, between them ${p.partway.toFixed(2)} of that unlike both` + ((p.partway >= CUT_PARTWAY) ? ', PARTWAY' : ''));
        }
    }
}
else {
    console.log('frames: fewer than 3 in frames.bin, nothing to match');
}

// Sides: sides.tsv's bands are a twentieth of the view's width each, from one view left of it to one right, each
// workload's triangles counted by where their middles lie.
const PER = 20;
// A dump's 3D workloads (200 triangles or more) between --from and --to, their counts a band each, and the picture's
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
    const rows = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        // <workload id>\t<ms since 1970>\t<a count a band>...
        const cols = line.split('\t').map(Number);
        const v = cols.slice(2);
        const t = (cols[1] - startMs) / 1000;
        if ((v.length !== PER * 3) || !(t >= from) || !(t <= to) || (v.reduce((a, b) => a + b, 0) < 200)) {
            continue;
        }
        rows.push(v);
    }
    return { n: rows.length, rows, aspect: shape.w / shape.h };
}
// A workload's triangles with their middles past the 4:3 view's sides, out to b view widths on each, and inside it.
const pastOf = (v, b) => {
    let sum = 0;
    for (let i = 0; i < Math.round(b * PER); i++) {
        sum += v[PER - 1 - i] + v[2 * PER + i];
    }
    return sum;
};
const insideOf = (v) => v.slice(PER, 2 * PER).reduce((a, b) => a + b, 0);
const extOf = (aspect) => (aspect / (4 / 3) - 1) / 2; // a picture's strip past each side of the view, in view widths
// Two workloads draw the same shot where their bands inside the view differ by at most this share of their triangles.
const SIDES_MATCH = 0.1;
const sides = sidesOf(dir);
if (widerDir || narrowerDir) {
    if (!widerDir || !narrowerDir) {
        console.error('sides: the culling check takes two dumps, --narrower <a dump of the same plan in a 4:3 window> ' +
            '--wider <one at 32:9>');
        process.exit(2);
    }
    const narrower = sidesOf(narrowerDir), wider = sidesOf(widerDir);
    for (const [d, s] of [[narrowerDir, narrower], [widerDir, wider]]) {
        if (!s || !s.n) {
            console.error(`sides: no 3D in ${d}'s dump between those seconds`);
            process.exit(2);
        }
    }
    // A 4:3 window's frames are the game's own target, which can be a little off 4:3 (Rush 2049's 640x440): a 16:9 one isn't.
    if (narrower.aspect > 1.6) {
        console.error(`sides: ${narrowerDir}'s picture is ${narrower.aspect.toFixed(2)}:1: dump it in a 4:3 window, where ` +
            'a game culling to the picture draws what one culled to its 4:3 view does');
        process.exit(2);
    }
    const b = Math.min(extOf(wider.aspect), 1);
    if (b < 0.5) {
        console.error(`sides: ${widerDir}'s picture (${wider.aspect.toFixed(2)}:1) is too little wider than 4:3: dump it at 32:9`);
        process.exit(2);
    }
    // Each of the wider dump's workloads paired with the 4:3 one's that draws the same inside the view: the same shot,
    // whenever each run came to it, since two runs of a plan don't keep step (Mario Golf's flyover, a race).
    const narrowIn = narrower.rows.map(insideOf);
    let n = 0, pastA = 0, pastB = 0, inB = 0;
    for (const w of wider.rows) {
        const wIn = insideOf(w);
        let best = null, bestD = SIDES_MATCH;
        narrower.rows.forEach((u, k) => {
            const scale = Math.max(wIn, narrowIn[k], 1), limit = bestD * scale;
            let d = 0;
            for (let i = PER; (i < 2 * PER) && (d <= limit); i++) {
                d += Math.abs(w[i] - u[i]);
            }
            d /= scale;
            if (d <= bestD) {
                bestD = d;
                best = u;
            }
        });
        if (best) {
            n++;
            pastA += pastOf(best, b);
            pastB += pastOf(w, b);
            inB += wIn;
        }
    }
    if (n < Math.max(30, 0.1 * wider.n)) {
        console.error(`sides: ${n} of ${widerDir}'s ${wider.n} workloads draw what one of ${narrowerDir}'s does inside the ` +
            '4:3 view: not the same scene, so play the same plan and seconds in both');
        process.exit(2);
    }
    pastA /= n;
    pastB /= n;
    inB /= n;
    const grows = pastB / Math.max(pastA, 1);
    // Drawn as densely past the view as inside it, a world isn't culled at the sides at all: nothing to grow.
    const density = (pastB / (2 * b)) / Math.max(inB, 1);
    const unmet = (grows < SIDES_GROW) && (density < SIDES_DENSE);
    // A scene that draws next to nothing past the view can't show the growth: a tenth of a few dozen triangles is a
    // triangle or two.
    const few = unmet && (pastB < SIDES_FEW);
    const fail = unmet && !few;
    failed ||= fail;
    untested ||= few;
    console.log(`sides: ${pastA.toFixed(0)} triangles a workload past the 4:3 view's sides in the 4:3 window and ` +
        `${pastB.toFixed(0)} in the ${wider.aspect.toFixed(2)}:1 picture, out to ${b.toFixed(2)} of the view ` +
        `(x${grows.toFixed(2)}; ${density.toFixed(2)} of the view's density), over ${n} of its ${wider.n} workloads paired ` +
        `with one of the ${narrower.n} at 4:3 that draws the same inside the view: ` +
        (fail ? 'FAILS, the wider picture draws no more past the 4:3 view than the 4:3 window: culled to the 4:3 view, ' +
            'or a scene whose every object reaches into the view (look at the wider dump\'s frames)' :
            few ? `untested, too little drawn past the view to tell (under ${SIDES_FEW} triangles a workload): a scene ` +
                'that draws more there tests it' : 'passes'));
}
else if (sides && sides.n) {
    const past = sides.rows.reduce((a, v) => a + pastOf(v, extOf(sides.aspect)), 0) / sides.n;
    const inside = sides.rows.reduce((a, v) => a + insideOf(v), 0) / sides.n;
    console.log(`sides: ${past.toFixed(0)} triangles a workload past the 4:3 view's sides in the ${sides.aspect.toFixed(2)}:1 ` +
        `picture, ${inside.toFixed(0)} inside it, over ${sides.n} workloads; --narrower <a dump of the same plan in a 4:3 ` +
        'window> --wider <one at 32:9> checks the culling');
}
else {
    console.log('sides: no workload drew 200 triangles between those seconds');
}
// The picture at the 4:3 view's sides, from each dump's frames alone (pictureAtSides()): what the triangle count above
// can't read, a picture whose world past the view is 2D (a board's background) or that a scissor cuts.
const PIC_EVERY = 0.1; // seconds between the frames looked at
const PIC_LIT = 16; // a pixel brighter than this in any channel, of 255, is drawn
const PIC_FULL = 0.8; // a column with this share of its rows drawn is the picture's
const PIC_SOME = 0.02; // ... the black past where the picture ends has something drawn on it from this share
const PIC_DARK = 0.3; // ... to this (more is the picture going on with a gap in it)
const PIC_ROOM = 0.1; // ... and is this much of the view's width at least
const PIC_RUN = 1; // seconds in a row of frames cut short that fail
const SEAM_EVERY = 0.25; // seconds between the frames a straight line is looked for in
const SEAM_MOVES = 2; // a frame's mean difference to the last one looked at, of 255, from which the scene moves
const SEAM_STEP = 10; // a step between two pixels, of 255, that counts in a column
const SEAM_OVER = 0.3; // the share of a column's rows stepping, over its neighbours', that is a straight line
const SEAM_NEAR = 0.05; // ... within this much of the view's width of its sides
const SEAM_SHARE = 0.25; // ... in this share of the frames where the scene moves: fails

// A dump's frames between --from and --to, one every <every> seconds, cut to its picture's box.
function* sampledFrames(d, every) {
    const file = path.join(d, 'frames.bin');
    const shape = fs.existsSync(file) && pictureBox(d);
    if (!shape) {
        return;
    }
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(HEADER);
    let startMs = null, next = from;
    for (let o = 0; o + HEADER <= size;) {
        fs.readSync(fd, head, 0, HEADER, o);
        const w = head.readUInt32LE(4), h = head.readUInt32LE(8);
        if ((head.readUInt32LE(0) !== MAGIC) || (o + HEADER + w * h * 3 > size)) {
            break;
        }
        const timeMs = Number(head.readBigUInt64LE(32));
        startMs ??= timeMs;
        const t = (timeMs - startMs) / 1000;
        if (t > to) {
            break;
        }
        if ((t >= next) && (w >= shape.w) && (h >= shape.h)) {
            const rgb = Buffer.allocUnsafe(shape.w * shape.h * 3);
            const whole = Buffer.allocUnsafe(w * shape.h * 3);
            fs.readSync(fd, whole, 0, whole.length, o + HEADER);
            for (let y = 0; y < shape.h; y++) {
                whole.copy(rgb, y * shape.w * 3, y * w * 3, (y * w + shape.w) * 3);
            }
            yield { t, w: shape.w, h: shape.h, rgb };
            next = t + every;
        }
        o += HEADER + w * h * 3;
    }
    fs.closeSync(fd);
}

// Two faults of the picture at the view's sides, each read from one dump's frames. Cut short: the picture fills the
// view out to its side and ends in black past it, with something drawn on the black, as a board whose background is
// drawn to 4:3 draws its 3D spaces out past the map. A picture that ends where its world does (a board's map reaching
// no further, a stage built short of a wide window) has nothing on the black past it, and a 4:3 scene, or a logo on
// black, doesn't fill the view to its side. A straight line inside the picture along the view's side, in the same
// column while the scene moves: something the game cuts a few pixels short of the side, the picture behind it showing.
function pictureAtSides(d) {
    let looked = 0, cutShort = 0, longest = 0, runFrom = null, runAt = null, moving = 0, prev = null, nextSeam = from;
    let vw = 0, v0 = 0, v1 = 0, aspect = 0;
    const seams = new Map();
    for (const f of sampledFrames(d, PIC_EVERY)) {
        const { w, h, rgb } = f;
        aspect = w / h;
        vw = h * 4 / 3;
        v0 = Math.round((w - vw) / 2);
        v1 = Math.round((w + vw) / 2);
        const drawn = new Uint8Array(w * h);
        const lit = new Float32Array(w);
        for (let i = 0, p = 0; i < w * h; i++, p += 3) {
            drawn[i] = (Math.max(rgb[p], rgb[p + 1], rgb[p + 2]) > PIC_LIT) ? 1 : 0;
            lit[i % w] += drawn[i] / h;
        }
        looked++;
        let cut = false;
        if (aspect > 4 / 3 * 1.1) {
            for (const [first, step, last] of [[v0 - 1, -1, 0], [v1, 1, w - 1]]) {
                const within = (x) => ((step < 0) ? (x >= last) : (x <= last));
                // The view drawn out to its side: the twentieth of it inside the side.
                let full = true;
                for (let k = 1; k <= Math.ceil(vw / 20); k++) {
                    full &&= lit[first - step * k] >= PIC_FULL;
                }
                let reach = first - step;
                for (let x = first; within(x) && (lit[x] >= PIC_FULL); x += step) {
                    reach = x;
                }
                const n = Math.abs(last - reach);
                let beyond = 0;
                for (let x = reach + step; within(x); x += step) {
                    beyond += lit[x];
                }
                beyond /= Math.max(n, 1);
                cut ||= full && (n >= PIC_ROOM * vw) && (beyond >= PIC_SOME) && (beyond <= PIC_DARK);
            }
        }
        if (cut) {
            runFrom = ((runAt !== null) && (f.t - runAt <= 2.5 * PIC_EVERY)) ? runFrom : f.t;
            runAt = f.t;
            cutShort++;
            longest = Math.max(longest, runAt - runFrom + PIC_EVERY);
        }
        if (f.t < nextSeam) {
            continue;
        }
        nextSeam = f.t + SEAM_EVERY;
        const g = grey(f, w, h);
        const moved = (prev && (prev.length === g.length)) ? meanDiff(g, prev) : Infinity;
        prev = g;
        if (moved < SEAM_MOVES) {
            continue;
        }
        moving++;
        // Each column's share of the rows drawn two pixels either side of it that step to the next column.
        const share = new Float32Array(w);
        for (let x = 1; x < w - 2; x++) {
            let rows = 0, steps = 0;
            for (let i = x; i < w * h; i += w) {
                if (drawn[i - 1] && drawn[i] && drawn[i + 1] && drawn[i + 2]) {
                    rows++;
                    steps += (Math.abs(g[i + 1] - g[i]) > SEAM_STEP) ? 1 : 0;
                }
            }
            share[x] = (rows >= h / 2) ? steps / rows : 0;
        }
        const near = Math.ceil(SEAM_NEAR * vw);
        for (const side of [v0, v1 - 1]) {
            for (let x = Math.max(side - near, 7); x <= Math.min(side + near, w - 9); x++) {
                const around = [];
                for (let k = 2; k <= 6; k++) {
                    around.push(share[x - k], share[x + k]);
                }
                around.sort((a, b) => a - b);
                if ((share[x] - around[around.length >> 1] >= SEAM_OVER) && (share[x] >= share[x - 1]) &&
                    (share[x] >= share[x + 1])) {
                    seams.set(x, (seams.get(x) ?? 0) + 1);
                }
            }
        }
    }
    const seam = [...seams].sort((a, b) => b[1] - a[1])[0];
    return { looked, cutShort, longest, moving, seam, vw, v0, v1, aspect };
}
for (const d of [dir, narrowerDir, widerDir].filter(Boolean)) {
    const p = pictureAtSides(d);
    if (!p.looked) {
        continue;
    }
    const wide = p.aspect > 4 / 3 * 1.1;
    const cutFails = p.longest >= PIC_RUN;
    const seamFails = !!p.seam && (p.seam[1] >= SEAM_SHARE * p.moving);
    failed ||= cutFails || seamFails;
    // Where the line lies from the view's side it is nearer, in the dump's pixels: in toward the middle or out from it.
    const off = p.seam && ((p.seam[0] < p.v0 + p.vw / 2) ? (p.seam[0] + 1 - p.v0) : (p.v1 - 1 - p.seam[0]));
    console.log(`picture at the sides (${d}, ${p.aspect.toFixed(2)}:1): ` +
        (wide ? `${p.cutShort} of ${p.looked} frames cut short past the 4:3 view (something drawn on black past where ` +
            `the picture ends), at most ${p.longest.toFixed(1)} s in a row` +
            (cutFails ? ': FAILS, the picture stops where the world goes on' : '') : 'no room past the 4:3 view') + '; ' +
        (p.seam ? `a straight line ${Math.abs(off)} pixels ${(off < 0) ? 'out' : 'in'} from the view's side in ` +
            `${p.seam[1]} of ${p.moving} frames where the scene moves` +
            (seamFails ? ': FAILS, something cut short of the picture\'s side' : '') :
            `no straight line along the view's sides in ${p.moving} frames where the scene moves`));
}
process.exit(failed ? 1 : (untested ? 2 : 0));
