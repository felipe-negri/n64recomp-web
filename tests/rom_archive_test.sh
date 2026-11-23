#!/usr/bin/env bash
# Makes three small ROMs (one in each byte order) and archives of them in every form Load ROM reads, damaged and
# unrelated ones too, and runs tests/rom_archive_test.cpp on them, natively and, with em++ on PATH, in node. Run by CI
# (the rom-archives job):
#
#   bash tests/rom_archive_test.sh <N64ModernRuntime>
#
# Needs python3 (or $PYTHON), gcc and g++ (or $CC and $CXX), and 7z or 7zz for the .7z archives (CI installs
# p7zip-full).
set -euo pipefail
rt="$(cd "$1" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
sevenz="$(command -v 7z || command -v 7zz)"

"${PYTHON:-python3}" - <<'PY'
import gzip, lzma, random, tarfile, zipfile
random.seed(7)
def rom(name, order):
    # Compressible like a real ROM, so every decoder does work: a repeated table with noise in it.
    body = bytearray((bytes(range(256)) * 16 + random.randbytes(512)) * 256)
    body[:4] = b'\x80\x37\x12\x40'
    if order == 'v64':
        for i in range(0, len(body), 2): body[i], body[i + 1] = body[i + 1], body[i]
    if order == 'n64':
        for i in range(0, len(body), 4): body[i:i + 4] = body[i:i + 4][::-1]
    open(name, 'wb').write(body)
rom('a.z64', 'z64'); rom('b.v64', 'v64'); rom('c.n64', 'n64')
open('readme.txt', 'w').write('not a ROM\n' * 1000)
open('big.bin', 'wb').write(random.randbytes(3 << 20))
with zipfile.ZipFile('roms.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for n in ('readme.txt', 'big.bin', 'a.z64', 'b.v64'): z.write(n)
with zipfile.ZipFile('stored.zip', 'w', zipfile.ZIP_STORED) as z: z.write('c.n64')
with zipfile.ZipFile('none.zip', 'w', zipfile.ZIP_DEFLATED) as z: z.write('readme.txt'); z.write('big.bin')
with zipfile.ZipFile('bzip2.zip', 'w', zipfile.ZIP_BZIP2) as z: z.write('a.z64')  # not a method miniz reads
for mode, name in (('w', 'roms.tar'), ('w:gz', 'roms.tar.gz'), ('w:xz', 'roms.tar.xz')):
    with tarfile.open(name, mode, format=tarfile.GNU_FORMAT) as t:
        for n in ('readme.txt', 'a.z64', 'c.n64'): t.add(n)
with tarfile.open('long.tar.gz', 'w:gz', format=tarfile.PAX_FORMAT) as t:
    t.add('b.v64', arcname='a folder with a name long enough for a pax header of its own ' * 2 + '/b.v64')
open('a.z64.gz', 'wb').write(gzip.compress(open('a.z64', 'rb').read()))
open('b.v64.xz', 'wb').write(lzma.compress(open('b.v64', 'rb').read()))
open('c.n64.xz', 'wb').write(lzma.compress(open('c.n64', 'rb').read(), check=lzma.CHECK_SHA256))
open('readme.txt.gz', 'wb').write(gzip.compress(open('readme.txt', 'rb').read()))
data = open('roms.tar.xz', 'rb').read(); open('cut.tar.xz', 'wb').write(data[:len(data) // 2])
data = bytearray(open('a.z64.gz', 'rb').read()); data[len(data) // 2] ^= 0xFF; open('bad.gz', 'wb').write(data)
PY
"$sevenz" a -bd -t7z roms.7z readme.txt big.bin a.z64 b.v64 > /dev/null
"$sevenz" a -bd -t7z -m0=PPMd ppmd.7z c.n64 > /dev/null
"$sevenz" a -bd -t7z -mf=BCJ2 bcj2.7z a.z64 > /dev/null
"$sevenz" a -bd -t7z -mhe=on -psecret locked.7z a.z64 > /dev/null
head -c 20000 roms.7z > cut.7z

cases=(roms.zip "A:z64,v64," stored.zip "A:n64," none.zip "A:" bzip2.zip "A:"
       roms.tar "A:z64,n64," roms.tar.gz "A:z64,n64," roms.tar.xz "A:z64,n64," long.tar.gz "A:v64,"
       a.z64.gz "A:z64," b.v64.xz "A:v64," c.n64.xz "A:n64," readme.txt.gz "A:" cut.tar.xz "A:" bad.gz "A:"
       roms.7z "A:z64,v64," ppmd.7z "A:n64," bcj2.7z "A:z64," locked.7z "A:" cut.7z "A:"
       a.z64 "N" readme.txt "N")

lzma="$rt/thirdparty/lzma-sdk"
miniz="$rt/thirdparty/miniz"
echo '#define MINIZ_EXPORT' > miniz_export.h
csrc=()
for f in 7zArcIn 7zBuf 7zCrc 7zCrcOpt 7zDec 7zStream Alloc Bcj2 Bra Bra86 BraIA64 CpuArch Delta Lzma2Dec LzmaDec Ppmd7 \
         Ppmd7Dec Sha256 Sha256Opt Xz XzCrc64 XzCrc64Opt XzDec; do csrc+=("$lzma/$f.c"); done
csrc+=("$miniz/miniz.c" "$miniz/miniz_tdef.c" "$miniz/miniz_tinfl.c" "$miniz/miniz_zip.c")
inc=(-I. -I"$lzma" -I"$miniz" -I"$rt/librecomp/src")
build() { # <cc> <cxx> <out> <flags>...
    local cc="$1" cxx="$2" out="$3"; shift 3
    local objs=()
    for c in "${csrc[@]}"; do
        "$cc" -O2 -DZ7_ST -DZ7_PPMD_SUPPORT "${inc[@]}" "$@" -c "$c" -o "$(basename "$c").$out.o"
        objs+=("$(basename "$c").$out.o")
    done
    "$cxx" -std=c++20 -O2 -Wall "${inc[@]}" "$@" "$here/rom_archive_test.cpp" "$rt/librecomp/src/rom_archive.cpp" \
        "${objs[@]}" -o "$out"
}
build "${CC:-gcc}" "${CXX:-g++}" native
./native "${cases[@]}"
if command -v em++ > /dev/null; then
    build emcc em++ wasm.js -sALLOW_MEMORY_GROWTH -sNODERAWFS
    node wasm.js "${cases[@]}"
fi
