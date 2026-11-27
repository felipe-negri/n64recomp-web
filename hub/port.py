#!/usr/bin/env python3
"""Recompendium: monta a página web de um jogo de N64 a partir da ROM (chamado por scripts/port.sh).

usage: port.py <nome> <rom>
Acha o port pela SHA-1 da ROM em hub/games.json, faz checkout do repo do port no commit fixado, prepara a ROM,
aplica os patches do N64Recomp-browser, recompila o código e compila com Emscripten, e publica em build/web-<nome>/.
Ambiente: EMSDK (padrão tools/emsdk), NAGA (padrão tools/cargo/bin/naga), N64_WORK (padrão work/, checkouts e builds
por jogo; ficam para o próximo build do mesmo jogo ser incremental)."""
import hashlib, json, os, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STEPS = 6


def step(k, msg):
    print(f"== [{k}/{STEPS}] {msg}", flush=True)


def run(cmd, cwd=None, env=None, quiet=False):
    out = subprocess.DEVNULL if quiet else None
    subprocess.run(cmd, cwd=cwd, env=env, check=True, stdout=out)


def to_z64(data):
    """A ROM em qualquer ordem de bytes (.z64/.v64/.n64) como .z64 (big-endian)."""
    head = data[:4]
    if head == b"\x80\x37\x12\x40":
        return data
    b = bytearray(data)
    if head == b"\x37\x80\x40\x12":  # .v64: pares trocados
        b[0::2], b[1::2] = data[1::2], data[0::2]
    elif head == b"\x40\x12\x37\x80":  # .n64: palavras little-endian
        b[0::4], b[1::4], b[2::4], b[3::4] = data[3::4], data[2::4], data[1::4], data[0::4]
    else:
        sys.exit("isso não parece uma ROM de N64 (cabeçalho desconhecido)")
    return bytes(b)


def emsdk_env(emsdk):
    """O ambiente do emsdk_env.sh, sem depender do shell de quem chamou."""
    out = subprocess.run(["bash", "-c", f'source "{emsdk}/emsdk_env.sh" >/dev/null 2>&1 && env -0'],
                         check=True, capture_output=True).stdout
    return dict(line.split("=", 1) for line in out.decode().split("\0") if "=" in line)


def main(name, rom_path):
    games = json.loads((ROOT / "hub/games.json").read_text())["games"]
    emsdk = Path(os.environ.get("EMSDK", ROOT / "tools/emsdk"))
    naga = Path(os.environ.get("NAGA", ROOT / "tools/cargo/bin/naga"))
    work = Path(os.environ.get("N64_WORK", ROOT / "work"))
    out = ROOT / "build" / f"web-{name}"
    for p in (emsdk / "emsdk_env.sh", naga):
        if not p.exists():
            sys.exit(f"falta {p}: rode scripts/setup.sh")

    step(1, "identificando a ROM")
    rom = to_z64(Path(rom_path).read_bytes())
    sha1 = hashlib.sha1(rom).hexdigest()
    game = games.get(sha1)
    if not game:
        sys.exit(f"nenhum port conhecido para esta ROM (sha1 {sha1})")
    print(f"{game['title']} (sha1 {sha1})", flush=True)

    step(2, "baixando o port " + game["repo"].rsplit("/", 1)[1])
    src = work / f"{game['repo'].rsplit('/', 1)[1]}-{game['commit'][:12]}"
    if not (src / ".git").exists():
        shutil.rmtree(src, ignore_errors=True)
        src.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "-q", game["repo"], str(src)])
        run(["git", "checkout", "-q", game["commit"]], cwd=src)
        run(["git", "submodule", "update", "-q", "--init", "--recursive", "--jobs", "8"], cwd=src)

    step(3, "preparando a ROM")
    for kind, dest in game.get("prep", {}).items():
        if kind == "mm_decompress":
            (src / ".rom.z64").write_bytes(rom)
            run([sys.executable, str(ROOT / "hub/mm_decompress.py"), str(src / ".rom.z64"), str(src / dest)], quiet=True)
        elif kind == "copy":
            (src / dest).parent.mkdir(parents=True, exist_ok=True)
            (src / dest).write_bytes(rom)
        else:
            sys.exit(f"prep desconhecido: {kind}")
    (src / ".rom.z64").unlink(missing_ok=True)
    if game.get("browser_patches"):
        run(["cmake", "-P", "lib/N64Recomp-browser/patches/apply.cmake", "lib"], cwd=src, quiet=True)

    step(4, "recompilando o código do jogo (N64Recomp)")
    if game.get("tools"):  # N64Recomp/RSPRecomp/OfflineModRecomp do runtime já com patch, na raiz do checkout
        tools_dir = src / "lib/N64ModernRuntime/N64Recomp"
        tools_build = tools_dir / "build"
        if not (tools_build / "N64Recomp").exists():
            run(["cmake", "-S", str(tools_dir), "-B", str(tools_build), "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
                 "-DCMAKE_C_COMPILER=clang", "-DCMAKE_CXX_COMPILER=clang++"], quiet=True)
            run(["cmake", "--build", str(tools_build), "--target", "N64Recomp", "RSPRecomp", "OfflineModRecomp"], quiet=True)
        for tool in ("N64Recomp", "RSPRecomp", "OfflineModRecomp"):
            shutil.copy2(tools_build / tool, src / tool)
    for cmd in game["recomp"]:
        run(cmd, cwd=src, quiet=True)

    step(5, "compilando para WebAssembly (demora: ~30-60 min no primeiro build)")
    env = emsdk_env(emsdk)
    build = src / "build-web"
    if not (build / "build.ninja").exists():
        run(["embuilder", "build", "sdl2-mt", "freetype-legacysjlj"], env=env, quiet=True)
        run(["emcmake", "cmake", "-S", ".", "-B", "build-web", "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
             f"-DRT64_NAGA_EXECUTABLE={naga}", f"-DCMAKE_EXE_LINKER_FLAGS=--pre-js={ROOT / 'hub/hub_rom.js'}",
             *game.get("cmake", [])], cwd=src, env=env, quiet=True)
    run(["cmake", "--build", "build-web", "--target", game["target"]], cwd=src, env=env, quiet=True)

    step(6, "publicando")
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    t = game["target"]
    shutil.copy2(build / f"{t}.html", out / "index.html")
    for f in (f"{t}.js", f"{t}.wasm", f"{t}.data", "coi_serviceworker.js"):
        if (build / f).exists():
            shutil.copy2(build / f, out / f)
    (out / "rom.z64").write_bytes(rom)  # a página guarda a ROM no IndexedDB na 1ª visita (hub_rom.js)
    (out / "hub-rom.json").write_text(json.dumps({"rom": "rom.z64", "dest": game["rom_dest"], "sha1": sha1}))
    print(f"pronto: {out}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
