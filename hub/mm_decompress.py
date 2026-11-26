#!/usr/bin/env python3
"""Decompress a Majora's Mask (USA) ROM the way zeldaret/mm's fixbaserom.py does, without libyaz0.
usage: mm_decompress.py <rom.z64> <out.z64>   (checks the decomp's md5 of the result)"""
import hashlib, struct, sys

DMADATA = 0x1A500
SIZE = 0x2F00000
WANT_MD5 = "f46493eaa0628827dbd6ad3ecd8d65d6"


def yaz0(src):
    assert src[:4] == b"Yaz0"
    size = struct.unpack(">I", src[4:8])[0]
    dst = bytearray(size)
    s, d = 16, 0
    while d < size:
        code = src[s]; s += 1
        for bit in range(8):
            if d >= size:
                break
            if code & (0x80 >> bit):
                dst[d] = src[s]; d += 1; s += 1
            else:
                b1, b2 = src[s], src[s + 1]; s += 2
                back = d - (((b1 & 0x0F) << 8) | b2) - 1
                n = b1 >> 4
                if n == 0:
                    n = src[s] + 0x12; s += 1
                else:
                    n += 2
                for _ in range(n):  # overlapping copy, byte by byte
                    dst[d] = dst[back]; d += 1; back += 1
    return dst


def crc_6105(rom):
    m = 0xFFFFFFFF
    rol = lambda i, b: ((i << b) & m) | (i >> (-b & 0x1F))
    t1 = t2 = t3 = t4 = t5 = t6 = 0xDF26F436
    for pos in range(0x1000, 0x101000, 4):
        d = struct.unpack_from(">I", rom, pos)[0]
        r = rol(d, d & 0x1F)
        t6d = (t6 + d) & m
        if t6d < t6:
            t4 = (t4 + 1) & m
        t6 = t6d
        t3 ^= d
        t5 = (t5 + r) & m
        t2 = t2 ^ r if t2 > d else t2 ^ t6 ^ d
        t1 = (t1 + (struct.unpack_from(">I", rom, 0x750 + (pos & 0xFF))[0] ^ d)) & m
    return struct.pack(">II", t6 ^ t4 ^ t3, t5 ^ t2 ^ t1)


def main(src_path, out_path):
    rom = open(src_path, "rb").read()
    out = bytearray(SIZE)
    table = bytearray()
    addr = DMADATA
    while True:
        e = struct.unpack_from(">IIII", rom, addr); addr += 16
        if not any(e):
            break
        vs, ve, ps, pe = e
        if ps == 0xFFFFFFFF and pe == 0xFFFFFFFF:
            table += struct.pack(">IIII", *e); continue
        data = rom[ps:ps + ve - vs] if pe == 0 else yaz0(rom[ps:pe])
        out[vs:vs + len(data)] = data
        table += struct.pack(">IIII", vs, ve, vs, 0)
    out[DMADATA:DMADATA + len(table)] = table
    out[0x10:0x18] = crc_6105(out)
    out[0x2EE8000:SIZE] = b"\xff" * (SIZE - 0x2EE8000)  # fixbaserom.py pads the tail with FF
    md5 = hashlib.md5(out).hexdigest()
    if md5 != WANT_MD5:
        sys.exit(f"md5 {md5} != {WANT_MD5}: not the USA ROM, or a bug here")
    open(out_path, "wb").write(out)
    print("ok", md5)


if __name__ == "__main__":
    main(*sys.argv[1:3])
