#!/usr/bin/env python3
"""Biblioteca de microcódigos de áudio do RSP para o N64 adaptativo.

  ucode_lib.py build <ucode_lib.json> <toml do RSPRecomp>...   junta os microcódigos que os ports já recompilam
  ucode_lib.py find <ucode_lib.json> <rom.z64> <saída.toml>    acha um microcódigo da biblioteca na ROM e escreve o
                                                              toml do RSPRecomp para ela

Um microcódigo é o mesmo código em qualquer jogo que o usa, só muda onde está na ROM: a biblioteca guarda os bytes
(o hash e os primeiros 64 bytes para achar) e o que o RSPRecomp precisa além do offset (endereço no RSP, alvos de
desvios indiretos)."""
import hashlib, json, re, sys
from pathlib import Path


def parse_toml(path):
    t = Path(path).read_text()
    num = lambda k: int(re.search(rf"^{k}\s*=\s*(0x[0-9A-Fa-f]+|\d+)", t, re.M)[1], 0)
    rom = re.search(r'^rom_file_path\s*=\s*"([^"]+)"', t, re.M)[1]
    targets = re.search(r"extra_indirect_branch_targets\s*=\s*\[(.*?)\]", t, re.S)
    targets = sorted({int(x, 16) for x in re.findall(r"0x[0-9A-Fa-f]+", targets[1])}) if targets else []
    unsupported = re.search(r"unsupported_instructions\s*=\s*\[(.*?)\]", t, re.S)
    return {"rom": str(Path(path).parent / rom), "text_offset": num("text_offset"), "text_size": num("text_size"),
            "text_address": num("text_address"), "targets": targets,
            "unsupported": [int(x, 16) for x in re.findall(r"0x[0-9A-Fa-f]+", unsupported[1])] if unsupported else []}


def build(lib_path, tomls):
    lib = json.loads(Path(lib_path).read_text()) if Path(lib_path).exists() else {}
    for t in tomls:
        try:
            u = parse_toml(t)
            code = Path(u["rom"]).read_bytes()[u["text_offset"]:u["text_offset"] + u["text_size"]]
        except (OSError, TypeError) as e:
            print(f"pulando {t}: {e}")
            continue
        h = hashlib.sha1(code).hexdigest()
        lib[h] = {"head": code[:64].hex(), "text_size": u["text_size"], "text_address": u["text_address"],
                  "targets": u["targets"], "unsupported": u["unsupported"], "from": str(t)}
    Path(lib_path).write_text(json.dumps(lib, indent=1))
    print(f"{len(lib)} microcódigos na biblioteca")


def find(lib_path, rom_path, out):
    lib = json.loads(Path(lib_path).read_text())
    rom = Path(rom_path).read_bytes()
    for h, u in lib.items():
        at = rom.find(bytes.fromhex(u["head"]))
        while at >= 0:
            if hashlib.sha1(rom[at:at + u["text_size"]]).hexdigest() == h:
                lines = [f'rom_file_path = "{Path(rom_path).name}"', f"text_offset = 0x{at:X}",
                         f"text_size = 0x{u['text_size']:X}", f"text_address = 0x{u['text_address']:08X}",
                         'output_file_path = "rsp/aspMain.cpp"', 'output_function_name = "aspMain"',
                         "extra_indirect_branch_targets = [" + ", ".join(f"0x{x:X}" for x in u["targets"]) + "]"]
                if u["unsupported"]:
                    lines.append("unsupported_instructions = [" + ", ".join(f"0x{x:X}" for x in u["unsupported"]) + "]")
                Path(out).write_text("\n".join(lines) + "\n")
                print(f"microcódigo {h[:12]} em 0x{at:X} (de {u['from']})")
                return 0
            at = rom.find(bytes.fromhex(u["head"]), at + 4)
    print("nenhum microcódigo da biblioteca nesta ROM")
    return 1


if __name__ == "__main__":
    cmd, lib = sys.argv[1], sys.argv[2]
    sys.exit(build(lib, sys.argv[3:]) if cmd == "build" else find(lib, sys.argv[3], sys.argv[4]))
