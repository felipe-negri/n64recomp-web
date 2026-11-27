#!/usr/bin/env python3
"""Acha as funções da libultra (e de outras libs da SDK) num binário MIPS sem símbolos, pelas assinaturas do n64sym
(arquivo .sig: nome, tamanho, CRC32 dos 8 primeiros bytes e de tudo, com os campos relocados zerados).

usage: libultra_sigs.py <builtin_signatures.sig> <binário> <vram do início do binário> [offsets candidatos...]
Imprime "vram tamanho nome" por linha. Sem candidatos, testa todo offset alinhado a 4 (modo completo do n64sym)."""
import sys, zlib
from collections import defaultdict

STRIP = {".hi16": 0xFFFF0000, ".lo16": 0xFFFF0000, ".targ26": 0xFC000000}


def load_sigs(path):
    sigs, cur = [], None
    for line in open(path, encoding="ascii", errors="replace"):
        p = line.split()
        if not p or p[0].startswith("#"):
            continue
        if p[0].startswith("."):
            for off in p[2:]:
                cur["relocs"][int(off, 16)] = STRIP[p[0]]
        else:
            cur = {"name": p[0], "size": int(p[1], 16), "crcA": int(p[2], 16), "crcB": int(p[3], 16), "relocs": {}}
            sigs.append(cur)
    return sigs


def stripped(buf, off, size, relocs):
    out = bytearray(buf[off:off + size])
    for r, mask in relocs.items():
        if r + 4 <= size:
            w = int.from_bytes(out[r:r + 4], "big") & mask
            out[r:r + 4] = w.to_bytes(4, "big")
    return bytes(out)


def scan(sigs, buf, base, offsets):
    # agrupa as assinaturas pelo padrão de relocação dos 8 primeiros bytes: cada offset calcula o crcA uma vez por padrão
    groups = defaultdict(lambda: defaultdict(list))
    for s in sigs:
        head = tuple(sorted((r, m) for r, m in s["relocs"].items() if r < 8))
        groups[head][s["crcA"]].append(s)
    found = {}
    for off in offsets:
        for head, by_crc in groups.items():
            h = bytearray(buf[off:off + 8])
            if len(h) < 8:
                continue
            for r, m in head:
                w = int.from_bytes(h[r:r + 4], "big") & m
                h[r:r + 4] = w.to_bytes(4, "big")
            for s in by_crc.get(zlib.crc32(bytes(h)), []):  # funções < 8 bytes (stubs) ficam de fora
                if s["size"] < 8 or off + s["size"] > len(buf) or base + off in found:
                    continue
                if zlib.crc32(stripped(buf, off, s["size"], s["relocs"])) == s["crcB"]:
                    found[base + off] = (s["size"], s["name"])
                    break
    return found


if __name__ == "__main__":
    sig_path, bin_path, base = sys.argv[1], sys.argv[2], int(sys.argv[3], 16)
    buf = open(bin_path, "rb").read()
    offs = [int(x, 16) - base for x in sys.argv[4:]] or range(0, len(buf) - 8, 4)
    for vram, (size, name) in sorted(scan(load_sigs(sig_path), buf, base, offs).items()):
        print(f"{vram:08X} {size:X} {name}")
