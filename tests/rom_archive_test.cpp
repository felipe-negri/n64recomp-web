// recomp::for_each_rom_in_archive and is_rom_archive (N64ModernRuntime-web's librecomp/src/rom_archive.cpp,
// RECOMP_ROM_ARCHIVES): what Load ROM finds in each archive tests/rom_archive_test.sh makes, and that a file's first
// 512 bytes say it is an archive exactly when it is searched as one. Each argument pair is a file and what it should
// give: "N" for a file that isn't an archive, else "A:" and the byte order of every ROM found, in order ("A:z64,v64;"
// and "A:" for an archive with none).

#include <algorithm>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>

#include "rom_archive.hpp"

int main(int argc, char** argv) {
    int failures = 0;
    for (int i = 1; i + 1 < argc; i += 2) {
        std::ifstream file(argv[i], std::ios::binary);
        std::vector<uint8_t> data((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        std::string got;
        bool archive = recomp::for_each_rom_in_archive(data, [&](std::vector<uint8_t>&& rom) {
            got += rom[0] == 0x80 ? "z64" : rom[0] == 0x37 ? "v64" : "n64";
            got += ",";
            return false;
        });
        got = archive ? "A:" + got : "N";
        bool start_says = recomp::is_rom_archive(std::span<const uint8_t>(data.data(), std::min<size_t>(data.size(), 512)));
        if (start_says != archive) {
            got += start_says ? " (but its start says archive)" : " (but its start says not one)";
        }
        bool ok = got == argv[i + 1];
        failures += !ok;
        printf("%s %s: %s%s%s\n", ok ? "ok  " : "FAIL", argv[i], got.c_str(), ok ? "" : ", expected ", ok ? "" : argv[i + 1]);
    }
    // The search stops where found says.
    std::ifstream file(argv[1], std::ios::binary);
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    int calls = 0;
    recomp::for_each_rom_in_archive(data, [&](std::vector<uint8_t>&&) { calls++; return true; });
    if (calls != 1) {
        printf("FAIL: %s: found called %d times after returning true\n", argv[1], calls);
        failures++;
    }
    printf("%d failure(s)\n", failures);
    return failures != 0;
}
