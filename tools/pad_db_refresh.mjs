// Refreshes a recomp's recompcontrollerdb.txt from SDL's community controller database (SDL_GameControllerDB). The
// file sits beside the desktop program, which hands it to SDL (SDL_GameControllerAddMappingsFromFile) so that pads the
// SDL it ships has no mapping for still read as gamepads the Controls tab can bind. It is a copy of that database's N64,
// GameCube and Switch Online pads, and the database goes on gaining pads and fixing mappings, so a recomp refreshes it
// before each desktop release rather than keeping it by hand.
//
//   node tools/pad_db_refresh.mjs <recompcontrollerdb.txt> [--db <gamecontrollerdb.txt>] [--check]
//
// --db reads a copy of the database's gamecontrollerdb.txt instead of fetching its newest commit. --check writes
// nothing and exits 1 if the file would change.
//
// The new file holds, in the database's order, every pad of the database whose name says N64, Nintendo 64, GameCube,
// GC, NSO or Switch Online, and every other pad the file already maps (one a recomp added by hand, or one the database
// has renamed), each with the database's current mapping; then the file's pads the database doesn't list at all, kept
// as they were. A pad is its GUID and platform, as SDL keys a mapping. Nothing is dropped, so a pad mapped before is
// mapped after. The file is rewritten only when a pad's line changes, with its line endings, and its header names the
// database commit it was refreshed from. Prints what was added, updated and kept.
// Exit: 0 unchanged (or written), 1 with --check and a change, 2 nothing to read.
import fs from 'node:fs';

const repo = 'mdqinc/SDL_GameControllerDB';
const scope = /N64|Nintendo 64|GameCube|\bGC\b|NSO|Switch Online/i;

const parse = (line) => {
  const m = line.trim().match(/^([0-9a-f]{32}),([^,]*),(.*)$/);
  if (!m) return null;
  const plat = m[3].match(/(?:^|,)platform:([^,]*)/)?.[1] ?? '';
  return { key: `${m[1]} ${plat}`, plat, name: m[2], line: line.trim() };
};
const entries = (text) => text.split(/\r?\n/).map(parse).filter(Boolean);

async function fetchDb() {
  const get = async (url, accept) => {
    const r = await fetch(url, { headers: accept ? { accept } : {} });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return (await r.text()).trim();
  };
  const commit = await get(`https://api.github.com/repos/${repo}/commits/master`, 'application/vnd.github.sha');
  return { commit, text: await get(`https://raw.githubusercontent.com/${repo}/${commit}/gamecontrollerdb.txt`) };
}

async function main(args) {
  const dbArg = args.indexOf('--db');
  const file = args.find((a, i) => !a.startsWith('--') && (dbArg < 0 || i !== dbArg + 1));
  if (!file) {
    console.error('usage: node tools/pad_db_refresh.mjs <recompcontrollerdb.txt> [--db <gamecontrollerdb.txt>] [--check]');
    return 2;
  }
  const oldText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const old = entries(oldText);

  let dbText, commit;
  try {
    if (dbArg >= 0) dbText = fs.readFileSync(args[dbArg + 1], 'utf8');
    else ({ text: dbText, commit } = await fetchDb());
  } catch (e) { console.error(e.message); return 2; }
  const db = entries(dbText);
  if (!db.length) { console.error('no mappings in the database'); return 2; }

  const oldByKey = new Map(old.map((e) => [e.key, e]));
  const dbKeys = new Set(db.map((e) => e.key));
  const seen = new Set();
  const fromDb = db.filter((e) => (scope.test(e.name) || oldByKey.has(e.key)) && !seen.has(e.key) && seen.add(e.key));
  const kept = old.filter((e) => !dbKeys.has(e.key));

  const added = fromDb.filter((e) => !oldByKey.has(e.key));
  const updated = fromDb.filter((e) => oldByKey.has(e.key) && oldByKey.get(e.key).line !== e.line);
  for (const [what, list] of [['added  ', added], ['updated', updated]])
    for (const e of list) console.log(`${what} ${e.plat} ${e.key.split(' ')[0]} ${e.name}`);
  console.log(`${file}: ${added.length} added, ${updated.length} updated, ` +
    `${fromDb.length - added.length - updated.length} as they were, ${kept.length} kept that the database doesn't list`);

  const next = [...fromDb, ...kept];
  if (next.length === old.length && next.every((e, i) => e.line === old[i].line)) return 0;
  if (args.includes('--check')) return 1;
  const lines = [
    '# Game Controller DB for SDL in 2.0.16 format',
    `# Source: https://github.com/${repo}${commit ? `, commit ${commit}` : ''}`,
    '',
    "# Its N64, GameCube and Switch Online pads, and the others this file maps, refreshed by N64Recomp-browser's",
    '# tools/pad_db_refresh.mjs.',
    '',
    ...fromDb.map((e) => e.line),
    ...(kept.length ? ['', "# Not in the database: kept as they were.", ...kept.map((e) => e.line)] : []),
    '',
  ];
  fs.writeFileSync(file, lines.join(oldText.includes('\r\n') ? '\r\n' : '\n'));
  return 0;
}

// exitCode, not process.exit(): exiting straight after a fetch can trip a libuv assertion on Windows.
process.exitCode = await main(process.argv.slice(2));
