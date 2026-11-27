#!/usr/bin/env python3
"""N64 adaptativo: overlays de código na ROM (código carregado por DMA num vram que a ROM não diz).

Acha blocos com cara de código (densidade de "jr ra") fora do segmento principal e descobre o vram de cada um por votação:
um jal dentro do bloco aponta para o começo de uma função dele (prólogo "addiu sp, sp, -X"), então alvo - offset do
prólogo = base. O runtime liga cada seção ao vram certo quando o jogo faz o DMA daquela região da ROM."""
import struct
from collections import Counter

JR_RA = b"\x03\xe0\x00\x08"


def code_blocks(rom, start, chunk=0x1000, min_jr=3, gap=0x1000):
    blocks = []
    for a in range(start - start % chunk, len(rom), chunk):
        if rom[a:a + chunk].count(JR_RA) >= min_jr:
            if blocks and a - blocks[-1][1] <= gap:
                blocks[-1][1] = a + chunk
            else:
                blocks.append([max(a, start), a + chunk])
    return [(a, min(b, len(rom))) for a, b in blocks]


def infer_vram(rom, a, b, kseg0_limit=0x80800000):
    words = struct.unpack(f">{(b - a) // 4}I", rom[a:a + (b - a) // 4 * 4])
    prologues = [i * 4 for i, w in enumerate(words) if (w & 0xFFFF8000) == 0x27BD8000]  # addiu sp, sp, -X
    targets = [0x80000000 | ((w & 0x03FFFFFF) << 2) for w in words if (w >> 26) == 3]  # jal
    if len(prologues) < 3 or len(targets) < 5:
        return None, 0
    votes = Counter()
    pset = set(prologues)
    span = b - a
    for t in set(targets):
        for p in prologues:
            base = t - p
            if 0x80000000 <= base < kseg0_limit:
                votes[base] += 1
    if not votes:
        return None, 0
    base, n = votes.most_common(1)[0]
    # confere: quantos alvos distintos caem num prólogo com essa base
    hits = sum(1 for t in set(targets) if 0 <= t - base < span and (t - base) in pset)
    return base, hits


def find(rom, main_end, main_vram_range):
    out = []
    for a, b in code_blocks(rom, main_end):
        base, hits = infer_vram(rom, a, b)
        if base is None or hits < 5:
            continue
        lo, hi = main_vram_range
        if lo <= base < hi:  # cairia em cima do principal: não é overlay (ou é ruído)
            continue
        out.append((a, b, base, hits))
    return out


if __name__ == "__main__":
    import sys
    rom = open(sys.argv[1], "rb").read()
    for a, b, base, hits in find(rom, int(sys.argv[2], 16), (int(sys.argv[3], 16), int(sys.argv[4], 16))):
        print(f"rom 0x{a:X}-0x{b:X} vram 0x{base:08X} ({hits} alvos batem)")
