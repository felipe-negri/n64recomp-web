// Posto inline no fim do <body> da página por hub/port.py: a página montada para uma instância do Recompendium acha a
// ROM do jogador ao lado dela (hub-rom.json diz o arquivo e onde o runtime guarda uma ROM, HOME/.config/<program id>/
// <game id>.z64), e o launcher já abre com Start Game. Sem hub-rom.json ao lado, a página fica como a original.
// Roda depois que persistent_home.js leu o HOME do IndexedDB, e só baixa a ROM quando o HOME não tem uma. FS e
// add/removeRunDependency são globais do .js do Emscripten (build sem MODULARIZE), já definidos quando o preRun roda.
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
