// A console's picture of a game, for tools/console_check.mjs to hold a recomp's 4:3 picture against: the game's ROM run
// in mupen64plus-next (a libretro core) with Angrylion's RDP, the software renderer that paraLLEl-RDP and the N64 scene
// check their output against, and an LLE RSP (the game's own microcode on an emulated RSP), driven by the same plan as
// tools/frame_dump.mjs and with no window: each VI's picture comes back from the core in memory and RAM is read
// between them. tools/console_ref.mjs builds the core and this, and runs them (in tools/console_ref.Dockerfile's image).
//
//   console_ref <core.so> <rom> <plan> <out dir> [--seconds <from>-<to>] [--watch <addr>[,<addr>...]]
//       [--rsp parallel|cxd4] [--max-seconds <s>]
//
// <out dir> gets frames.bin, in RT64's frame dump format (rt64-web's src/hle/rt64_frame_dump.h: a 40-byte header and
// 8-bit RGB, rows top down), every VI's picture at the game's own size (Angrylion's, with the VI's filters applied, is 640 wide and
// 240 or 480 high: video() says how it is brought down), a frame equal to the one before left out, its presentId the VI's number and its
// timeMs the VI's time since the console started (the core's VI rate); watch.tsv, "<VI time ms>\t<word>..." each time
// a watched 32-bit word changes, read after the VI, the file tools/frame_dump.mjs --watch writes of a recomp; the
// plan's shots, <name>.ppm; and log.txt, what the plan did.
//
// The plan is tools/capture_window.ps1's, as tools/frame_dump.mjs reads it, its times in seconds of the console's VIs
// from power on: key <name> [ms], down, up, until, frames, poke, or, peek, dump, find, shot and end do what they do there,
// an until's wait moving every later step by as long. A key is the recomp's default keyboard binding of an N64 button
// (RecompFrontend's recompinput/src/input_mapping.cpp): Space A, Shift B, Q Z, Enter Start, E L, R R, the arrows the
// C buttons, I J K L the D-pad, W A S D the stick (all the way). size, drag, burst, record and stop have nothing to
// do here and are skipped. A key is held 120 ms, as frame_dump holds one.
//
// Exit 0 at end (or --max-seconds, 600), 3 when an until or find was unmet or the core failed.
#include <dlfcn.h>
#include <execinfo.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>

#include "libretro.h"

static FILE *logFile;
static void say(const char *fmt, ...) {
    va_list a;
    va_start(a, fmt);
    vfprintf(stdout, fmt, a);
    va_end(a);
    va_start(a, fmt);
    if (logFile) vfprintf(logFile, fmt, a), fflush(logFile);
    va_end(a);
    fflush(stdout);
}

// The core's options: Angrylion, an LLE RSP, and the C buttons on their own libretro buttons (the alternate map).
static const char *rspPlugin = "parallel";
static const char *option(const char *key) {
    static const char *pairs[][2] = {
        {"mupen64plus-rdp-plugin", "angrylion"},
        {"mupen64plus-rsp-plugin", NULL},
        {"mupen64plus-cpucore", "cached_interpreter"},
        {"mupen64plus-angrylion-vioverlay", "Filtered"},
        {"mupen64plus-angrylion-multithread", "all threads"},
        {"mupen64plus-angrylion-overscan", "disabled"},
        {"mupen64plus-alt-map", "True"},
        {"mupen64plus-pak1", "none"},
        {"mupen64plus-pak2", "none"},
        {"mupen64plus-pak3", "none"},
        {"mupen64plus-pak4", "none"},
        {"mupen64plus-astick-deadzone", "0"},
        {"mupen64plus-astick-sensitivity", "100"},
    };
    for (size_t i = 0; i < sizeof(pairs) / sizeof(pairs[0]); i++)
        if (!strcmp(pairs[i][0], key)) return pairs[i][1] ? pairs[i][1] : rspPlugin;
    return NULL;
}

static char outDir[1024];
static void logPrint(enum retro_log_level level, const char *fmt, ...) {
    if (level < RETRO_LOG_WARN) return;
    va_list a;
    va_start(a, fmt);
    vfprintf(stderr, fmt, a);
    va_end(a);
}

static bool environment(unsigned cmd, void *data) {
    switch (cmd) {
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
        struct retro_variable *v = data;
        v->value = option(v->key);
        return v->value != NULL;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool *)data = false; return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: return *(enum retro_pixel_format *)data == RETRO_PIXEL_FORMAT_XRGB8888;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY: *(const char **)data = outDir; return true;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE: ((struct retro_log_callback *)data)->log = logPrint; return true;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool *)data = true; return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *(unsigned *)data = 0; return true;
    case RETRO_ENVIRONMENT_GET_JIT_CAPABLE: *(bool *)data = true; return true;
    default: return false;
    }
}

// The picture of the last VI at the game's own size: Angrylion's is 640 wide, each pixel of a 320-wide picture twice,
// and 480 high for an interlaced picture or 240 for one of 240 lines, so it is halved across, and down when over 300.
static uint8_t *picture, *lastWritten;
static unsigned pictureW, pictureH;
static bool newPicture;
static void video(const void *data, unsigned w, unsigned h, size_t pitch) {
    if (!data) return; // a dupe: the picture is the last one
    unsigned sy = h > 300 ? 2 : 1, hw = w / 2, hh = h / sy;
    if (hw != pictureW || hh != pictureH) {
        pictureW = hw, pictureH = hh;
        picture = realloc(picture, (size_t)hw * hh * 3);
        lastWritten = realloc(lastWritten, (size_t)hw * hh * 3);
        memset(lastWritten, 0, (size_t)hw * hh * 3);
    }
    for (unsigned y = 0; y < hh; y++) {
        const uint32_t *r0 = (const uint32_t *)((const uint8_t *)data + pitch * (sy * y));
        const uint32_t *r1 = (const uint32_t *)((const uint8_t *)data + pitch * (sy * y + sy - 1));
        uint8_t *o = picture + (size_t)y * hw * 3;
        for (unsigned x = 0; x < hw; x++) {
            uint32_t p[4] = {r0[2 * x], r0[2 * x + 1], r1[2 * x], r1[2 * x + 1]};
            for (int c = 0; c < 3; c++) {
                int shift = 16 - 8 * c, sum = 0;
                for (int i = 0; i < 4; i++) sum += (p[i] >> shift) & 0xFF;
                o[3 * x + c] = (uint8_t)((sum + 2) / 4);
            }
        }
    }
    newPicture = true;
}
static void audioSample(int16_t l, int16_t r) { (void)l, (void)r; }
static size_t audioBatch(const int16_t *d, size_t n) { (void)d; return n; }

// The N64's controller, as libretro buttons of the alternate map, and the stick.
static uint32_t held;
static int stickX, stickY;
static void inputPoll(void) {}
static int16_t inputState(unsigned port, unsigned device, unsigned index, unsigned id) {
    if (port != 0) return 0;
    if (device == RETRO_DEVICE_JOYPAD) return id == RETRO_DEVICE_ID_JOYPAD_MASK ? (int16_t)held : (held >> id) & 1;
    if (device == RETRO_DEVICE_ANALOG && index == RETRO_DEVICE_INDEX_ANALOG_LEFT)
        return id == RETRO_DEVICE_ID_ANALOG_X ? stickX : stickY;
    return 0;
}
static int keyButton(const char *k) {
    static const struct { const char *name; int id; } keys[] = {
        {"Space", RETRO_DEVICE_ID_JOYPAD_B},     {"Shift", RETRO_DEVICE_ID_JOYPAD_Y},
        {"Q", RETRO_DEVICE_ID_JOYPAD_L2},        {"Enter", RETRO_DEVICE_ID_JOYPAD_START},
        {"E", RETRO_DEVICE_ID_JOYPAD_SELECT},    {"R", RETRO_DEVICE_ID_JOYPAD_R2},
        {"Left", RETRO_DEVICE_ID_JOYPAD_L},      {"Right", RETRO_DEVICE_ID_JOYPAD_R},
        {"Up", RETRO_DEVICE_ID_JOYPAD_X},        {"Down", RETRO_DEVICE_ID_JOYPAD_A},
        {"J", RETRO_DEVICE_ID_JOYPAD_LEFT},      {"L", RETRO_DEVICE_ID_JOYPAD_RIGHT},
        {"I", RETRO_DEVICE_ID_JOYPAD_UP},        {"K", RETRO_DEVICE_ID_JOYPAD_DOWN},
    };
    for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++)
        if (!strcasecmp(keys[i].name, k)) return keys[i].id;
    return -1;
}
static bool setKey(const char *k, bool down) {
    int b = keyButton(k);
    if (b >= 0) { held = down ? held | (1u << b) : held & ~(1u << b); return true; }
    int v = down ? 0x7FFF : 0;
    if (!strcasecmp(k, "A")) stickX = -v;
    else if (!strcasecmp(k, "D")) stickX = v;
    else if (!strcasecmp(k, "W")) stickY = -v;
    else if (!strcasecmp(k, "S")) stickY = v;
    else return false;
    return true;
}

// RDRAM, each 32-bit word in the host's order, as a recomp's runtime holds it.
static uint32_t *ram;
static size_t ramSize;
static uint32_t *word(uint32_t addr) {
    uint32_t o = addr & 0x1FFFFFFF;
    return ram && o + 4 <= ramSize ? &ram[o >> 2] : NULL;
}
static uint32_t peek(uint32_t addr) { uint32_t *w = word(addr); return w ? *w : 0; }

struct Step { double t; char *f[8]; int n; };

static void crashed(int sig) {
    void *frames[64];
    int n = backtrace(frames, 64);
    fprintf(stderr, "console_ref: signal %d\n", sig);
    backtrace_symbols_fd(frames, n, 2);
    _exit(3);
}

int main(int argc, char **argv) {
    if (argc < 5) { fprintf(stderr, "usage: console_ref <core.so> <rom> <plan> <out dir> [options] (the header says)\n"); return 3; }
    const char *corePath = argv[1], *romPath = argv[2], *planPath = argv[3];
    snprintf(outDir, sizeof(outDir), "%s", argv[4]);
    double from = 0, to = 1e30, maxSeconds = 600;
    uint32_t watch[16];
    int watches = 0;
    for (int i = 5; i + 1 < argc; i += 2) {
        if (!strcmp(argv[i], "--seconds")) sscanf(argv[i + 1], "%lf-%lf", &from, &to);
        else if (!strcmp(argv[i], "--rsp")) rspPlugin = argv[i + 1];
        else if (!strcmp(argv[i], "--max-seconds")) maxSeconds = atof(argv[i + 1]);
        else if (!strcmp(argv[i], "--watch"))
            for (char *s = strtok(argv[i + 1], ","); s && watches < 16; s = strtok(NULL, ",")) watch[watches++] = strtoul(s, NULL, 0);
    }
    signal(SIGSEGV, crashed);
    signal(SIGBUS, crashed);
    signal(SIGILL, crashed);
    signal(SIGFPE, crashed);
    mkdir(outDir, 0777);
    char path[1200];
    snprintf(path, sizeof(path), "%s/log.txt", outDir);
    logFile = fopen(path, "w");

    // The plan.
    struct Step steps[1024];
    int stepCount = 0;
    FILE *pf = fopen(planPath, "r");
    if (!pf) { say("no plan %s\n", planPath); return 3; }
    char line[512];
    while (fgets(line, sizeof(line), pf) && stepCount < 1024) {
        char *s = line;
        while (*s == ' ' || *s == '\t') s++;
        if (*s == '#' || *s == '\n' || *s == '\r' || !*s) continue;
        struct Step *st = &steps[stepCount];
        st->n = 0;
        for (char *tok = strtok(strdup(s), " \t\r\n"); tok && st->n < 8; tok = strtok(NULL, " \t\r\n")) st->f[st->n++] = tok;
        if (st->n < 2) continue;
        st->t = atof(st->f[0]);
        stepCount++;
    }
    fclose(pf);

    // The core.
    void *core = dlopen(corePath, RTLD_NOW);
    if (!core) { say("dlopen: %s\n", dlerror()); return 3; }
#define SYM(name) typeof(&name) p_##name = (typeof(&name))dlsym(core, #name)
    SYM(retro_set_environment); SYM(retro_set_video_refresh); SYM(retro_set_audio_sample);
    SYM(retro_set_audio_sample_batch); SYM(retro_set_input_poll); SYM(retro_set_input_state); SYM(retro_init);
    SYM(retro_load_game); SYM(retro_run); SYM(retro_get_memory_data); SYM(retro_get_memory_size);
    SYM(retro_get_system_av_info); SYM(retro_set_controller_port_device);
    p_retro_set_environment(environment);
    p_retro_set_video_refresh(video);
    p_retro_set_audio_sample(audioSample);
    p_retro_set_audio_sample_batch(audioBatch);
    p_retro_set_input_poll(inputPoll);
    p_retro_set_input_state(inputState);
    p_retro_init();
    FILE *rf = fopen(romPath, "rb");
    if (!rf) { say("no ROM %s\n", romPath); return 3; }
    fseek(rf, 0, SEEK_END);
    size_t romSize = ftell(rf);
    fseek(rf, 0, SEEK_SET);
    void *romData = malloc(romSize);
    if (fread(romData, 1, romSize, rf) != romSize) return 3;
    fclose(rf);
    struct retro_game_info game = {romPath, romData, romSize, NULL};
    if (!p_retro_load_game(&game)) { say("the core refused the ROM\n"); return 3; }
    p_retro_set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
    struct retro_system_av_info av;
    p_retro_get_system_av_info(&av);
    double fps = av.timing.fps > 0 ? av.timing.fps : 60.0;
    ram = p_retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
    ramSize = p_retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
    say("core loaded: %.3f VIs a second, RDRAM %zu MB, RSP %s\n", fps, ramSize >> 20, rspPlugin);

    snprintf(path, sizeof(path), "%s/frames.bin", outDir);
    FILE *frames = fopen(path, "wb");
    snprintf(path, sizeof(path), "%s/watch.tsv", outDir);
    FILE *watchFile = fopen(path, "w");
    uint32_t lastWatch[16];
    memset(lastWatch, 0xFF, sizeof(lastWatch));

    int step = 0;
    double shift = 0, waitBegan = -1, lastPress = -10, keyUpAt = -1;
    uint32_t framesFrom = 0;
    char keyHeld[32] = "";
    int code = 0;
    uint64_t written = 0;
    double lastNow = 0;
    struct timespec began;
    clock_gettime(CLOCK_MONOTONIC, &began);
    for (uint64_t vi = 0;; vi++) {
        double now = vi / fps;
        lastNow = now;
        if (now > maxSeconds) { say("%.2f stopped at --max-seconds\n", now); break; }
        if (keyUpAt >= 0 && now >= keyUpAt) { setKey(keyHeld, false); keyUpAt = -1; }
        // The plan's steps due by now.
        bool ended = false;
        while (step < stepCount && keyUpAt < 0 && now >= steps[step].t + shift) {
            struct Step *st = &steps[step];
            const char *c = st->f[1];
            if (!strcmp(c, "key") && st->n >= 3) {
                if (!setKey(st->f[2], true)) say("%.2f no key %s: skipped\n", now, st->f[2]);
                snprintf(keyHeld, sizeof(keyHeld), "%s", st->f[2]);
                keyUpAt = now + (st->n >= 4 ? atof(st->f[3]) : 120) / 1000.0;
                say("%.2f key %s\n", now, st->f[2]);
            } else if (!strcmp(c, "down") && st->n >= 3) { setKey(st->f[2], true); say("%.2f down %s\n", now, st->f[2]); }
            else if (!strcmp(c, "up") && st->n >= 3) { setKey(st->f[2], false); say("%.2f up %s\n", now, st->f[2]); }
            else if (!strcmp(c, "until") && st->n >= 6) {
                uint32_t a = strtoul(st->f[2], NULL, 0), m = strtoul(st->f[3], NULL, 0), v = strtoul(st->f[4], NULL, 0);
                if (waitBegan < 0) waitBegan = now;
                if ((peek(a) & m) != v) {
                    if (now - waitBegan > atof(st->f[5])) { say("%.2f until %s NOT met\n", now, st->f[2]); code = 3; ended = true; break; }
                    if (st->n >= 7 && now - lastPress >= 1.5) {
                        lastPress = now;
                        setKey(st->f[6], true);
                        snprintf(keyHeld, sizeof(keyHeld), "%s", st->f[6]);
                        keyUpAt = now + 0.12;
                    }
                    break; // wait for the next VI
                }
                say("%.2f until %s met after %.1fs\n", now, st->f[2], now - waitBegan);
                shift += now - waitBegan;
                waitBegan = -1;
            } else if (!strcmp(c, "frames") && st->n >= 5) {
                uint32_t now32 = peek(strtoul(st->f[2], NULL, 0));
                if (waitBegan < 0) waitBegan = now, framesFrom = now32;
                if (now32 - framesFrom < strtoul(st->f[3], NULL, 0)) {
                    if (now - waitBegan > atof(st->f[4])) { say("%.2f frames %s NOT met\n", now, st->f[2]); code = 3; ended = true; break; }
                    break;
                }
                say("%.2f frames %s %s met\n", now, st->f[2], st->f[3]);
                shift += now - waitBegan;
                waitBegan = -1;
            } else if (!strcmp(c, "poke") && st->n >= 4) {
                uint32_t *w = word(strtoul(st->f[2], NULL, 0));
                if (w) *w = strtoul(st->f[3], NULL, 0);
                say("%.2f poke %s %s\n", now, st->f[2], st->f[3]);
            } else if (!strcmp(c, "or") && st->n >= 4) {
                uint32_t *w = word(strtoul(st->f[2], NULL, 0));
                if (w) *w |= strtoul(st->f[3], NULL, 0);
                say("%.2f or %s %s\n", now, st->f[2], st->f[3]);
            } else if (!strcmp(c, "peek") && st->n >= 3) {
                say("%.2f peek", now);
                char tmp[256];
                snprintf(tmp, sizeof(tmp), "%s", st->f[2]);
                for (char *s = strtok(tmp, ","); s; s = strtok(NULL, ",")) say(" %s=%08X", s, peek(strtoul(s, NULL, 0)));
                say("\n");
            } else if (!strcmp(c, "dump") && st->n >= 5) {
                uint32_t a = strtoul(st->f[2], NULL, 0) & 0x1FFFFFFF, n = strtoul(st->f[3], NULL, 0);
                snprintf(path, sizeof(path), "%s/%s.bin", outDir, st->f[4]);
                FILE *df = fopen(path, "wb");
                if (df && ram && a + n <= ramSize) fwrite((uint8_t *)ram + a, 1, n, df);
                if (df) fclose(df);
                say("%.2f dump %s\n", now, st->f[4]);
            } else if (!strcmp(c, "find") && st->n >= 5) {
                uint32_t w0 = strtoul(st->f[3], NULL, 0), w1 = strtoul(strchr(st->f[3], ',') + 1, NULL, 0);
                if (waitBegan < 0) waitBegan = now;
                size_t at = 0;
                for (size_t o = 0; ram && o + 8 <= ramSize && o < (32u << 20); o += 4)
                    if (ram[o >> 2] == w0 && ram[(o >> 2) + 1] == w1) { at = o + 1; break; }
                if (!at) {
                    if (now - waitBegan > atof(st->f[4])) { say("%.2f find %s NOT found\n", now, st->f[2]); code = 3; ended = true; break; }
                    break;
                }
                say("%.2f find %s at 0x%08zX\n", now, st->f[2], 0x80000000 + at - 1);
                shift += now - waitBegan;
                waitBegan = -1;
            } else if (!strcmp(c, "shot") && st->n >= 3 && picture) {
                snprintf(path, sizeof(path), "%s/%s.ppm", outDir, st->f[2]);
                FILE *sf = fopen(path, "wb");
                if (sf) { fprintf(sf, "P6\n%u %u\n255\n", pictureW, pictureH); fwrite(picture, 3, (size_t)pictureW * pictureH, sf); fclose(sf); }
                say("%.2f shot %s\n", now, st->f[2]);
            } else if (!strcmp(c, "end")) { say("%.2f end\n", now); ended = true; step++; break; }
            else say("%.2f %s: skipped\n", now, c);
            step++;
        }
        if (ended) break;
        if (step >= stepCount && keyUpAt < 0) { say("%.2f the plan ran out\n", now); break; }

        newPicture = false;
        p_retro_run();
        ram = p_retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM); // set once the core's thread has started
        double t = (vi + 1) / fps;
        // What the game holds after this VI, and its picture.
        if (watches) {
            bool changed = false;
            for (int i = 0; i < watches; i++) if (peek(watch[i]) != lastWatch[i]) changed = true;
            if (changed) {
                fprintf(watchFile, "%.1f", t * 1000);
                for (int i = 0; i < watches; i++) fprintf(watchFile, "\t%08X", lastWatch[i] = peek(watch[i]));
                fprintf(watchFile, "\n");
            }
        }
        if (newPicture && t >= from && t <= to && memcmp(picture, lastWritten, (size_t)pictureW * pictureH * 3)) {
            struct { uint32_t magic, width, height, index, count, dropped; uint64_t presentId, timeMs; } h =
                {0x44465452, pictureW, pictureH, 0, 1, 0, vi, (uint64_t)(t * 1000)};
            fwrite(&h, sizeof(h), 1, frames);
            fwrite(picture, 3, (size_t)pictureW * pictureH, frames);
            memcpy(lastWritten, picture, (size_t)pictureW * pictureH * 3);
            written++;
        }
    }
    fclose(frames);
    fclose(watchFile);
    struct timespec ended;
    clock_gettime(CLOCK_MONOTONIC, &ended);
    say("%llu frames written, %.0f s of the console's in %.0f s\n", (unsigned long long)written, lastNow,
        (ended.tv_sec - began.tv_sec) + (ended.tv_nsec - began.tv_nsec) / 1e9);
    if (logFile) fclose(logFile);
    _exit(code); // the core's threads are not torn down
}
