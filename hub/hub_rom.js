// Linked with --pre-js by scripts/port.sh: a page built for a Recompendium instance finds the player's ROM beside it
// (hub-rom.json names the file and where the runtime keeps a stored ROM, HOME/.config/<program id>/<game id>.z64), so
// the launcher offers Start Game with no Load ROM. A page with no hub-rom.json beside it is the upstream page as is.
// It runs after persistent_home.js has read HOME in from IndexedDB, and fetches the ROM only when HOME has none.
if (typeof document !== 'undefined') {
  Module['preRun'] = [].concat(Module['preRun'] || []);
  Module['preRun'].push(() => {
    addRunDependency('hub-rom');
    (async () => {
      try {
        const res = await fetch('hub-rom.json', { cache: 'no-store' });
        if (!res.ok) return;
        const { rom, dest } = await res.json();
        while (!Module.homeRead) await new Promise((r) => setTimeout(r, 10));
        await Module.homeRead;
        const path = '/home/web_user/' + dest;
        if (FS.analyzePath(path).exists) return;
        Module.setStatus?.('Carregando a ROM…');
        const got = await fetch(rom);
        if (!got.ok) throw new Error('HTTP ' + got.status);
        const data = new Uint8Array(await got.arrayBuffer());
        FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        FS.writeFile(path, data);
        console.log(`hub-rom: ${rom} stored at ${path} (${data.length} bytes)`);
      } catch (e) {
        console.error('hub-rom: ' + e);
      } finally {
        removeRunDependency('hub-rom');
      }
    })();
  });
}
