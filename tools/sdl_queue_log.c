#define _CRT_SECURE_NO_WARNINGS
// A stand-in SDL2.dll for item 6c's check (docs/new-recomp.md): it logs every buffer a recomp's desktop build queues
// to SDL with how much was queued already, so a released Windows archive's own build shows whether queue_samples'
// catch-up dropped samples (more than 100 ms queued) or the queue ran dry, on the real sound device, with no test
// build of the game. tools/sound_pace.sh builds it, puts it beside the program in place of the archive's SDL2.dll
// (renamed SDL2_real.dll, to which every other function is forwarded by the .def it generates) and reads the log.
//
// SDL_QUEUE_LOG names the log, a line per SDL_QueueAudio: microseconds since the program opened its device, the
// buffer's bytes, then the bytes queued before it (SDL_GetQueuedAudioSize, what queue_samples' catch-up and
// get_frames_remaining read). SDL_OpenAudioDevice writes "# open <freq> <channels> <format>", what they are in.
// The samples are queued as silence unless SDL_QUEUE_LOG_SOUND is set: the device plays and paces the queue as it
// would the game's sound, and a shared desktop hears nothing.
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    int freq;
    uint16_t format;
    uint8_t channels, silence;
    uint16_t samples, padding;
    uint32_t size;
    void* callback;
    void* userdata;
} AudioSpec;  // SDL_AudioSpec's layout

typedef int (*QueueAudio)(uint32_t, const void*, uint32_t);
typedef uint32_t (*GetQueuedAudioSize)(uint32_t);
typedef uint32_t (*OpenAudioDevice)(const char*, int, const AudioSpec*, AudioSpec*, int);

static HMODULE real;
static QueueAudio real_queue;
static GetQueuedAudioSize real_queued;
static OpenAudioDevice real_open;
static FILE* log_file;
static int keep_sound;
static LARGE_INTEGER start, ticks_per_second;
static void* silence;
static uint32_t silence_bytes;
static CRITICAL_SECTION lock;
static INIT_ONCE once = INIT_ONCE_STATIC_INIT;

static BOOL CALLBACK init(PINIT_ONCE o, void* p, void** c) {
    (void)o; (void)p; (void)c;
    real = LoadLibraryA("SDL2_real.dll");
    if (!real) {
        fprintf(stderr, "sdl_queue_log: no SDL2_real.dll beside the program\n");
        abort();
    }
    real_queue = (QueueAudio)GetProcAddress(real, "SDL_QueueAudio");
    real_queued = (GetQueuedAudioSize)GetProcAddress(real, "SDL_GetQueuedAudioSize");
    real_open = (OpenAudioDevice)GetProcAddress(real, "SDL_OpenAudioDevice");
    const char* path = getenv("SDL_QUEUE_LOG");
    if (path && *path) {
        log_file = fopen(path, "w");
    }
    keep_sound = getenv("SDL_QUEUE_LOG_SOUND") != NULL;
    QueryPerformanceFrequency(&ticks_per_second);
    QueryPerformanceCounter(&start);
    InitializeCriticalSection(&lock);
    return TRUE;
}

__declspec(dllexport) uint32_t SDL_OpenAudioDevice(const char* device, int iscapture, const AudioSpec* desired,
    AudioSpec* obtained, int allowed_changes) {
    InitOnceExecuteOnce(&once, init, NULL, NULL);
    uint32_t dev = real_open(device, iscapture, desired, obtained, allowed_changes);
    const AudioSpec* spec = obtained ? obtained : desired;
    if (log_file && dev && !iscapture) {
        EnterCriticalSection(&lock);
        QueryPerformanceCounter(&start);
        fprintf(log_file, "# open %d %u %u\n", spec->freq, spec->channels, spec->format);
        fflush(log_file);
        LeaveCriticalSection(&lock);
    }
    return dev;
}

__declspec(dllexport) int SDL_QueueAudio(uint32_t dev, const void* data, uint32_t len) {
    InitOnceExecuteOnce(&once, init, NULL, NULL);
    uint32_t queued = real_queued(dev);
    EnterCriticalSection(&lock);
    if (log_file) {
        LARGE_INTEGER now;
        QueryPerformanceCounter(&now);
        long long us = (now.QuadPart - start.QuadPart) * 1000000 / ticks_per_second.QuadPart;
        fprintf(log_file, "%lld %u %u\n", us, len, queued);
        fflush(log_file);
    }
    if (!keep_sound) {
        if (len > silence_bytes) {
            free(silence);
            silence = calloc(len, 1);  // 0 is silence in the float and signed formats the recomps queue
            silence_bytes = silence ? len : 0;
        }
        if (silence) {
            data = silence;
        }
    }
    int ret = real_queue(dev, data, len);
    LeaveCriticalSection(&lock);
    return ret;
}
