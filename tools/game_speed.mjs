// The game's speed against real time, from a counter the game keeps in RDRAM read every so often: what a plan's clock
// step names, in tools/frame_dump.mjs (the desktop build) and tools/page_driver.mjs (the page). A console runs a game's
// frames at its own pace, and a recomp that runs them faster than that (a clock that counts the launcher's time,
// interpolated frames counted as the game's, a VI that comes too often) plays its demos, timers and music too fast;
// one that runs them slower, on a machine fast enough to draw them, plays in slow motion.
//
//   judge(samples, perSecond) gives { lines, fails }, from samples [[ms, value], ...] in the order they were read: ms
//   of real time, value the counter's 32-bit word, perSecond what the counter counts a second on a console (a frame
//   counter 60, 30 or 20, a clock in VIs 60).
//
// The samples are cut into windows of 5 s of real time, each read as ticks a second. One the counter stood still
// through is a load or a pause the game counts no time in (DK64's clock, Donald Duck's in a level's load), left out;
// one where it went back (a level that restarts it) is cut there, and a step larger than three times the rate between
// two samples (a counter the game sets, not counts) is too, and said. A window 5% faster than the console fails: at
// 30 a second, 5 s is 150 ticks, and a tick either side at its ends is under 1.5%. One slower than 90% of the
// console's is said, and fails only where the caller says the machine draws the game at its own pace (slow: true):
// a load the counter goes on through, a dump that writes every frame, a host that can't keep up, a page under Xvfb,
// all read slower than a console without the build being at fault.
const windowMs = 5000;

export function judge(samples, perSecond, { slow = false } = {}) {
  const windows = [];
  let jumps = 0, backs = 0, from = null;
  for (let i = 1; i < samples.length; i++) {
    const [t0, v0] = samples[i - 1], [t1, v1] = samples[i];
    from ??= samples[i - 1];
    const step = v1 - v0;
    const cut = step < 0 || step > 3 * perSecond * (t1 - t0) / 1000 + 3;
    if (cut) { if (step < 0) backs++; else jumps++; }
    // A window ends at a cut, or once it holds 5 s; a cut's window ends at the sample before it.
    const end = cut ? samples[i - 1] : t1 - from[0] >= windowMs ? samples[i] : null;
    if (end && end[0] - from[0] >= windowMs * 0.4) windows.push({ at: from[0], ms: end[0] - from[0], ticks: end[1] - from[1] });
    if (end) from = cut ? samples[i] : end;
  }
  if (from && samples.length) {
    const end = samples[samples.length - 1];
    if (end[0] - from[0] >= windowMs * 0.4) windows.push({ at: from[0], ms: end[0] - from[0], ticks: end[1] - from[1] });
  }
  const t0 = samples.length ? samples[0][0] : 0;
  const rate = (w) => w.ticks * 1000 / w.ms;
  const s = (w) => `${Math.round((w.at - t0) / 1000)} s`;
  const moving = windows.filter((w) => w.ticks > 0);
  const fast = moving.filter((w) => rate(w) > perSecond * 1.05);
  const slower = moving.filter((w) => rate(w) < perSecond * 0.9);
  const rates = moving.map(rate).sort((a, b) => a - b);
  const median = rates.length ? rates[rates.length >> 1] : null;
  const f1 = (x) => x.toFixed(1);
  const lines = [`game speed: ${samples.length} reads over ${Math.round((samples.at(-1)?.[0] - t0 || 0) / 1000)} s, ` +
    `${windows.length} windows of 5 s, ${windows.length - moving.length} with the counter still` +
    (jumps ? `, ${jumps} jumps cut out` : '') + (backs ? `, ${backs} times back` : '')];
  if (!moving.length) {
    lines.push('game speed: the counter never moved: a wrong address, or a game that never ran');
    return { lines, fails: true, windows, median };
  }
  lines.push(`game speed: ${f1(median)} a second (median), ${f1(rates[0])}-${f1(rates.at(-1))}, ` +
    `against the console's ${perSecond}: ${moving.length - fast.length - slower.length} windows at its pace, ` +
    `${fast.length} faster, ${slower.length} slower`);
  const list = (ws) => ws.slice(0, 6).map((w) => `${s(w)} ${f1(rate(w))}`).join(', ') + (ws.length > 6 ? ', ...' : '');
  if (fast.length) lines.push(`game speed: FAILS, faster than the console's ${perSecond} a second at ${list(fast)}`);
  if (slower.length) lines.push(`game speed: ${slow ? 'FAILS, ' : ''}slower than 90% of the console's at ${list(slower)}` +
    (slow ? '' : ' (said, not failed: this machine is not known to draw it at its pace)'));
  const fails = fast.length > 0 || (slow && slower.length > 0);
  if (!fails) lines.push('game speed: passes');
  return { lines, fails, windows, median };
}
