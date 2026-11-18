// Records the sound a recomp's Linux desktop build queues to SDL, for tools/sound_check.mjs: loaded with LD_PRELOAD
// into the program tools/frame_dump.mjs runs (which builds it with the image's cc), it stands in for SDL's
// SDL_OpenAudioDevice and SDL_QueueAudio, the two every recomp's queue_samples calls, notes each buffer and hands it
// on to the real SDL unchanged, so the program plays (into SDL's dummy driver) as it would without it.
//
// SDL_AUDIO_RECORD=<path> names the recording: <path>.raw, every buffer's bytes back to back, as queued, and
// <path>.tsv, a line per buffer: its time in microseconds since 1970 (the clock RT64_FRAME_DUMP's frames carry, so
// the sound lines up with the dump), its bytes, and the bytes SDL held queued before it (SDL_GetQueuedAudioSize: the
// sound still to play, so the buffer is heard that much later). SDL_OpenAudioDevice writes
// "# open <freq> <channels> <format> <us>", what the samples are in (SDL's AUDIO_F32 0x8120 or AUDIO_S16 0x8010).
// A program that queues to no device it opened through SDL_OpenAudioDevice records no "# open" line, which
// sound_check reports.
//
//   cc -shared -fPIC -O2 -o sdl_audio_record.so tools/sdl_audio_record.c -ldl
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct {
    int freq;
    uint16_t format;
    uint8_t channels, silence;
    uint16_t samples, padding;
    uint32_t size;
    void* callback;
    void* userdata;
} AudioSpec;  // SDL_AudioSpec's layout

typedef uint32_t (*OpenAudioDevice)(const char*, int, const AudioSpec*, AudioSpec*, int);
typedef int (*QueueAudio)(uint32_t, const void*, uint32_t);
typedef uint32_t (*GetQueuedAudioSize)(uint32_t);

static OpenAudioDevice real_open;
static QueueAudio real_queue;
static GetQueuedAudioSize real_queued;
static FILE* tsv;
static FILE* raw;
static pthread_once_t once = PTHREAD_ONCE_INIT;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

static long long now_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long long)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}

static void init(void) {
    real_open = (OpenAudioDevice)dlsym(RTLD_NEXT, "SDL_OpenAudioDevice");
    real_queue = (QueueAudio)dlsym(RTLD_NEXT, "SDL_QueueAudio");
    real_queued = (GetQueuedAudioSize)dlsym(RTLD_NEXT, "SDL_GetQueuedAudioSize");
    if (!real_open || !real_queue || !real_queued) {
        fprintf(stderr, "sdl_audio_record: no SDL2 after it to forward to\n");
        abort();
    }
    const char* path = getenv("SDL_AUDIO_RECORD");
    if (path && *path) {
        size_t n = strlen(path) + 5;
        char* name = malloc(n);
        snprintf(name, n, "%s.tsv", path);
        tsv = fopen(name, "w");
        snprintf(name, n, "%s.raw", path);
        raw = fopen(name, "wb");
        free(name);
        if (!tsv || !raw) {
            fprintf(stderr, "sdl_audio_record: can't write %s.tsv and .raw\n", path);
            abort();
        }
    }
}

uint32_t SDL_OpenAudioDevice(const char* device, int iscapture, const AudioSpec* desired, AudioSpec* obtained,
    int allowed_changes) {
    pthread_once(&once, init);
    uint32_t dev = real_open(device, iscapture, desired, obtained, allowed_changes);
    const AudioSpec* spec = obtained ? obtained : desired;
    if (tsv && dev && !iscapture) {
        pthread_mutex_lock(&lock);
        fprintf(tsv, "# open %d %u %u %lld\n", spec->freq, spec->channels, spec->format, now_us());
        fflush(tsv);
        pthread_mutex_unlock(&lock);
    }
    return dev;
}

int SDL_QueueAudio(uint32_t dev, const void* data, uint32_t len) {
    pthread_once(&once, init);
    if (tsv) {
        uint32_t queued = real_queued(dev);
        pthread_mutex_lock(&lock);
        fprintf(tsv, "%lld %u %u\n", now_us(), len, queued);
        fwrite(data, 1, len, raw);
        // The program is ended by a signal, so nothing waits in stdio's buffers.
        fflush(tsv);
        fflush(raw);
        pthread_mutex_unlock(&lock);
    }
    return real_queue(dev, data, len);
}
