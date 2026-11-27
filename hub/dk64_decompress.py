#!/usr/bin/env python3
"""Donkey Kong 64 (USA): a ROM com os overlays descomprimidos que o recompilador lê, do jeito que o
tools/generate_decompressed_rom.py do decomp (gitlab.com/dk64_decomp/dk64) faz: cada overlay (.code e .data, gzip)
descomprimido e gravado a partir de 0x2000000, alinhado a 0x10.
usage: dk64_decompress.py <rom.z64> <out.z64>"""
import gzip, sys

# nome, ROM do .code, ROM do .data, tamanho comprimido do .data
OVERLAYS = [
    ("global_asm", 0x113F0, 0xC29D4, 0x949C), ("menu", 0xCBE70, 0xD4554, 0x5A2),
    ("multiplayer", 0xD4B00, 0xD69F8, 0xFB), ("minecart", 0xD6B00, 0xD98A0, 0x197),
    ("bonus", 0xD9A40, 0xDF346, 0x2AB), ("race", 0xDF600, 0xE649A, 0x2DB),
    ("critter", 0xE6780, 0xE9D17, 0x38C), ("boss", 0xEA0B0, 0xF388F, 0x90A),
    ("arcade", 0xF41A0, 0xFB42C, 0x1EC4), ("jetpac", 0xFD2F0, 0x1010FD, 0x936),
]


def main(src, dst):
    rom = bytearray(open(src, "rb").read())
    pos = 0x2000000
    for _, code, data, data_size in OVERLAYS:
        for blob in (rom[code:data], rom[data:data + data_size]):
            pos = (pos + 0xF) & ~0xF
            out = gzip.decompress(bytes(blob))
            if len(rom) < pos + len(out):
                rom.extend(b"\0" * (pos + len(out) - len(rom)))
            rom[pos:pos + len(out)] = out
            pos += len(out)
    open(dst, "wb").write(rom)


if __name__ == "__main__":
    main(*sys.argv[1:3])
