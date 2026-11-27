#!/usr/bin/env python3
"""N64 adaptativo: da ROM ao código C, sem nada escrito à mão para o jogo.

usage: recomp.py <rom.z64> <pasta do jogo> <runner> <N64Recomp> <RSPRecomp> <builtin_signatures.sig> <ucode_lib.json>
1. gen_syms.py: funções (splat) e libultra (assinaturas) → syms.toml, game.toml
2. N64Recomp; cada função que ele não sabe recompilar (cop0, cache, desvio para fora da função) vira stub, de novo
   até passar
3. microcódigo de áudio pela biblioteca → RSPRecomp
4. copia RecompiledFuncs/ para o runner e escreve include/adapt_game.h (hash XXH3 da ROM, nome, id)"""
import re, shutil, subprocess, sys
from pathlib import Path

import xxhash

HERE = Path(__file__).resolve().parent


def run(cmd, cwd, log):
    with open(log, "w") as f:
        return subprocess.run(cmd, cwd=cwd, stdout=f, stderr=subprocess.STDOUT).returncode


def main(rom, game, runner, n64recomp, rsprecomp, sigs, ucode_lib):
    game, runner = Path(game).resolve(), Path(runner).resolve()
    rt = runner / "lib/N64ModernRuntime"
    subprocess.run([sys.executable, str(HERE / "gen_syms.py"), rom, str(game), sigs, str(rt)], check=True)

    cfg = game / "game.toml"
    if __import__("os").environ.get("ADAPT_TRACE"):  # rastreio: primeira entrada de cada função no console (trace.h)
        cfg.write_text(cfg.read_text().replace("[input]\n", "[input]\ntrace_mode = true\n", 1))
    stubs = []
    for _ in range(200):
        if run([n64recomp, "game.toml"], game, game / "recomp.log") == 0:
            break
        log = (game / "recomp.log").read_text(errors="replace")
        bad = re.search(r"Error recompiling (\S+)", log)
        if not bad:
            sys.exit("N64Recomp falhou sem dizer a função:\n" + log[-2000:])
        stubs.append(bad[1])
        text = cfg.read_text()
        cfg.write_text(re.sub(r"stubs = \[.*?\]", "stubs = [" + ", ".join(f'"{s}"' for s in stubs) + "]", text, flags=re.S))
    else:
        sys.exit("stubs demais")
    print(f"recompilado; {len(stubs)} funções viraram stub: {' '.join(stubs)}")

    if subprocess.run([sys.executable, str(HERE / "ucode_lib.py"), "find", ucode_lib, str(game / "rom.z64"),
                       str(game / "aspMain.toml")]).returncode:
        sys.exit("microcódigo de áudio desconhecido (falta na biblioteca)")
    t = (game / "aspMain.toml").read_text()
    t = t.replace('"rsp/aspMain.cpp"', '"RecompiledFuncs/aspMain_rsp.cpp"').replace('"aspMain"', '"aspMain_run"')
    (game / "aspMain.toml").write_text(t)
    if run([rsprecomp, "aspMain.toml"], game, game / "rsp.log"):
        sys.exit("RSPRecomp falhou: " + (game / "rsp.log").read_text()[-1000:])

    # Microcódigos que a execução revelou (ucodes.txt: hash, tamanho, primeiros bytes na ordem do N64): acha na ROM e
    # recompila cada um; alvos de desvio indireto conhecidos em ucode_<hash>.targets.
    rom_bytes = (game / "rom.z64").read_bytes()
    entries = []
    for line in (game / "ucodes.txt").read_text().split("\n") if (game / "ucodes.txt").exists() else []:
        if not line.strip():
            continue
        h, size, head = line.split()
        at = rom_bytes.find(bytes.fromhex(head))
        if at < 0:
            print(f"microcódigo {h} não está na ROM sem compressão; fica sem")
            continue
        targets = (game / f"ucode_{h}.targets").read_text().split() if (game / f"ucode_{h}.targets").exists() else []
        (game / f"ucode_{h}.toml").write_text("\n".join([
            'rom_file_path = "rom.z64"', f"text_offset = 0x{at:X}", f"text_size = {size}", "text_address = 0x04001080",
            f'output_file_path = "RecompiledFuncs/ucode_{h}.cpp"', f'output_function_name = "ucode_{h}"',
            "extra_indirect_branch_targets = [" + ", ".join(targets) + "]", ""]))
        if run([rsprecomp, f"ucode_{h}.toml"], game, game / f"ucode_{h}.log"):
            print(f"RSPRecomp falhou no microcódigo {h}: " + (game / f"ucode_{h}.log").read_text()[-300:])
            continue
        entries.append(h)
    (runner / "include/adapt_ucodes.inc").write_text(
        "// Gerado por adapt/recomp.py.\n" + "".join(f"extern RspUcodeFunc ucode_{h};\n" for h in entries) +
        "static const AdaptUcode adapt_ucodes[] = {\n" + "".join(f"    {{0x{h}ULL, ucode_{h}}},\n" for h in entries) +
        "    {0, nullptr},\n};\n")

    shutil.rmtree(runner / "RecompiledFuncs", ignore_errors=True)
    shutil.copytree(game / "RecompiledFuncs", runner / "RecompiledFuncs")
    data = (game / "rom.z64").read_bytes()
    h = xxhash.xxh3_64_intdigest(data)
    name = data[0x20:0x34].decode("ascii", "replace").strip().replace('"', "'")
    (runner / "include/adapt_game.h").write_text(f"""#pragma once
// Gerado por adapt/recomp.py a partir da ROM (N64 adaptativo).
#define ADAPT_ROM_HASH 0x{h:016x}ULL
#define ADAPT_INTERNAL_NAME "{name}"
#define ADAPT_DISPLAY_NAME "{name.title()}"
#define ADAPT_GAME_ID u8"adapt.{h:016x}"
#define ADAPT_SAVE_TYPE recomp::SaveType::AllowAll
""")
    print(f"pronto para compilar: {name}, XXH3 {h:016x}, rom_dest .config/N64Adaptive/adapt.{h:016x}.z64")


if __name__ == "__main__":
    main(*sys.argv[1:8])
