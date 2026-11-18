// Records the sound a recomp's Linux desktop build queues to SDL, for tools/sound_check.mjs: loaded with LD_PRELOAD
// into the program tools/frame_dump.mjs runs (which builds it with the image's cc), it stands in for SDL's
// SDL_OpenAudioDevice and SDL_QueueAudio, the two every recomp's queue_samples calls, notes each buffer and hands it
// on to the real SDL unchanged. SDL's dummy driver, which a frame dump plays into, takes what is queued faster than
// real time (its wait per buffer is rounded down to whole milliseconds), so a game whose sound runs ahead of the
// device never sees its queue grow there: Mario Golf v0.1.2 made 3.5% more sound than plays, and its dummy device's
// queue held 0-8 ms where a sound card's grew past 100 ms, and queue_samples cut it. So the device's queue the
// program reads (SDL_GetQueuedAudioSize) is this file's own: a device that plays the sound queued to it in real time,
// from when it is unpaused, and goes on time when it has none.
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
typedef void (*PauseAudioDevice)(uint32_t, int);
typedef void (*ClearQueuedAudio)(uint32_t);

static OpenAudioDevice real_open;
static QueueAudio real_queue;
static GetQueuedAudioSize real_queued;
static PauseAudioDevice real_pause;
static ClearQueuedAudio real_clear;
static FILE* tsv;
static FILE* raw;
static pthread_once_t once = PTHREAD_ONCE_INIT;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

// The real-time device: the device opened for output, its bytes a second, and, while it plays, the time its queue
// runs out (seconds since 1970), or, while it is paused (as a device opens), the seconds queued.
static uint32_t device;
static double bytes_per_second;
static int paused = 1;
static double ends, held;

static long long now_us(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long long)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}

// Seconds of sound the device holds at now (seconds); the lock held.
static double queued_at(double now) {
    if (paused) {
        return held;
    }
    return ends > now ? ends - now : 0;
}

static void init(void) {
    real_open = (OpenAudioDevice)dlsym(RTLD_NEXT, "SDL_OpenAudioDevice");
    real_queue = (QueueAudio)dlsym(RTLD_NEXT, "SDL_QueueAudio");
    real_queued = (GetQueuedAudioSize)dlsym(RTLD_NEXT, "SDL_GetQueuedAudioSize");
    real_pause = (PauseAudioDevice)dlsym(RTLD_NEXT, "SDL_PauseAudioDevice");
    real_clear = (ClearQueuedAudio)dlsym(RTLD_NEXT, "SDL_ClearQueuedAudio");
    if (!real_open || !real_queue || !real_queued || !real_pause || !real_clear) {
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

uint32_t SDL_OpenAudioDevice(const char* name, int iscapture, const AudioSpec* desired, AudioSpec* obtained,
    int allowed_changes) {
    pthread_once(&once, init);
    uint32_t dev = real_open(name, iscapture, desired, obtained, allowed_changes);
    const AudioSpec* spec = obtained ? obtained : desired;
    if (dev && !iscapture) {
        pthread_mutex_lock(&lock);
        device = dev;
        bytes_per_second = (double)spec->freq * spec->channels * ((spec->format & 0xff) / 8);
        paused = 1;
        held = 0;
        pthread_mutex_unlock(&lock);
    }
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
    if (dev != device || !bytes_per_second) {
        return real_queue(dev, data, len);
    }
    pthread_mutex_lock(&lock);
    long long us = now_us();
    double now = us / 1e6, before = queued_at(now), seconds = len / bytes_per_second;
    if (paused) {
        held += seconds;
    } else {
        ends = now + before + seconds;
    }
    if (tsv) {
        fprintf(tsv, "%lld %u %u\n", us, len, (uint32_t)(before * bytes_per_second));
        fwrite(data, 1, len, raw);
        // The program is ended by a signal, so nothing waits in stdio's buffers.
        fflush(tsv);
        fflush(raw);
    }
    pthread_mutex_unlock(&lock);
    return real_queue(dev, data, len);
}

uint32_t SDL_GetQueuedAudioSize(uint32_t dev) {
    pthread_once(&once, init);
    if (dev != device || !bytes_per_second) {
        return real_queued(dev);
    }
    pthread_mutex_lock(&lock);
    uint32_t bytes = (uint32_t)(queued_at(now_us() / 1e6) * bytes_per_second);
    pthread_mutex_unlock(&lock);
    return bytes;
}

void SDL_PauseAudioDevice(uint32_t dev, int pause_on) {
    pthread_once(&once, init);
    if (dev == device) {
        pthread_mutex_lock(&lock);
        double now = now_us() / 1e6;
        if (pause_on && !paused) {
            held = queued_at(now);
        } else if (!pause_on && paused) {
            ends = now + held;
        }
        paused = pause_on != 0;
        pthread_mutex_unlock(&lock);
    }
    real_pause(dev, pause_on);
}

void SDL_ClearQueuedAudio(uint32_t dev) {
    pthread_once(&once, init);
    if (dev == device) {
        pthread_mutex_lock(&lock);
        held = 0;
        ends = 0;
        pthread_mutex_unlock(&lock);
    }
    real_clear(dev);
}
