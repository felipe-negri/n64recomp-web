// A stand-in pad for a recomp's Linux desktop build, as it was released: preloaded (LD_PRELOAD) into the program, it
// plugs an SDL virtual gamepad into the program's own SDL (a release's libSDL2-2.0.so.0, 2.26 or later) and drives
// it by commands, so a press, a stick held and a pad pulled out and plugged in again reach the game through the same
// SDL events and controller reads a real pad's do, with no pad on the machine and no test build of the game.
// tools/frame_dump.mjs builds it in its container and drives it from a plan's pad, unplug and replug steps (its
// header); the page's stand-in pads are tools/gamepad_probe.js.
//
//   gcc -shared -fPIC -O2 -o stand_in_pad.so stand_in_pad.c -ldl
//   STAND_IN_PAD=<commands file> STAND_IN_PAD_LOG=<log file> LD_PRELOAD=./stand_in_pad.so <program>
//
// <commands file> is read a line at a time as it grows, each line one command:
//   <control> <value>   a button (a b x y back guide start leftstick rightstick leftshoulder rightshoulder dpup dpdown
//                       dpleft dpright, SDL's GameController names) 1 or 0, or an axis (leftx lefty rightx righty
//                       lefttrigger righttrigger) -32768 to 32767, up and left negative
//   unplug              the pad goes away, as one pulled out (SDL_CONTROLLERDEVICEREMOVED)
//   replug              the same pad comes back: same name, vendor and product, so the same GUID
// The pad is plugged in at the program's first SDL_PollEvent with SDL's joystick subsystem up, and every command is
// applied there too, on the thread that polls SDL's events, as SDL's own pads are. The log gets a line for each,
// "<ms since 1970> <command> ok|error <why>", the time it was applied: RT64_FRAME_DUMP's clock, and the one a plan's
// press is timed from.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

// SDL_VirtualJoystickDesc's layout, version 1 (SDL 2.26-2.30).
typedef struct {
    uint16_t version, type, naxes, nbuttons, nhats, vendor_id, product_id, padding;
    uint32_t button_mask, axis_mask;
    const char *name;
    void *userdata, *Update, *SetPlayerIndex, *Rumble, *RumbleTriggers, *SetLED, *SendEffect;
} Desc;

static const char *buttons[] = {"a", "b", "x", "y", "back", "guide", "start", "leftstick", "rightstick",
    "leftshoulder", "rightshoulder", "dpup", "dpdown", "dpleft", "dpright"};
static const char *axes[] = {"leftx", "lefty", "rightx", "righty", "lefttrigger", "righttrigger"};
#define NBUTTONS (sizeof(buttons) / sizeof(*buttons))
#define NAXES (sizeof(axes) / sizeof(*axes))
#define SDL_INIT_JOYSTICK 0x200u
#define NAME "Stand-in pad"

static int (*real_poll)(void *);
static uint32_t (*was_init)(uint32_t);
static int (*attach)(const Desc *);
static int (*detach)(int);
static int (*num_joysticks)(void);
static int (*is_virtual)(int);
static const char *(*name_for_index)(int);
static void *(*joy_open)(int);
static void (*joy_close)(void *);
static int (*set_axis)(void *, int, int16_t);
static int (*set_button)(void *, int, uint8_t);
static const char *(*get_error)(void);

static int cmds = -1;
static FILE *logf;
static void *joy;            // the pad as the shim holds it open, NULL while it is unplugged
static int plugged_once, failed;
static char line[256];
static size_t have;

static void say(const char *cmd, const char *result) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    fprintf(logf, "%lld %s %s\n", (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000, cmd, result);
    fflush(logf);
}

static int find_pad(void) {
    for (int i = num_joysticks() - 1; i >= 0; i--)
        if (is_virtual(i) && name_for_index(i) && !strcmp(name_for_index(i), NAME)) return i;
    return -1;
}

static const char *plug(void) {
    static Desc d;
    memset(&d, 0, sizeof d);
    d.version = 1;
    d.type = 1;  // SDL_JOYSTICK_TYPE_GAMECONTROLLER: SDL makes its mapping from the masks, every button and axis here
    d.naxes = NAXES;
    d.nbuttons = NBUTTONS;
    d.vendor_id = 0x045e;  // an Xbox 360 pad's ids, a pad every recomp knows
    d.product_id = 0x028e;
    d.name = NAME;
    int index = attach(&d);
    if (index < 0) return get_error();
    joy = joy_open(index);
    return joy ? NULL : get_error();
}

static const char *unplug(void) {
    if (!joy) return "not plugged in";
    int index = find_pad();
    joy_close(joy);
    joy = NULL;
    if (index < 0) return "SDL lists no stand-in pad";
    return detach(index) == 0 ? NULL : get_error();
}

static const char *apply(char *cmd) {
    char control[32];
    int value;
    if (!strcmp(cmd, "unplug")) return unplug();
    if (!strcmp(cmd, "replug")) return joy ? "already plugged in" : plug();
    if (sscanf(cmd, "%31s %d", control, &value) != 2) return "not a command";
    if (!joy) return "not plugged in";
    for (unsigned i = 0; i < NBUTTONS; i++)
        if (!strcmp(control, buttons[i])) return set_button(joy, i, value != 0) == 0 ? NULL : get_error();
    for (unsigned i = 0; i < NAXES; i++)
        if (!strcmp(control, axes[i]))
            return set_axis(joy, i, value < -32768 ? -32768 : value > 32767 ? 32767 : value) == 0 ? NULL : get_error();
    return "no such button or axis";
}

static void *sdl(const char *name) {
    void *f = dlsym(RTLD_DEFAULT, name);
    if (!f) failed = 1;
    return f;
}

static void step(void) {
    if (failed || !logf) return;
    if (!plugged_once) {
        if (!was_init) {
            was_init = sdl("SDL_WasInit"); attach = sdl("SDL_JoystickAttachVirtualEx"); detach = sdl("SDL_JoystickDetachVirtual");
            num_joysticks = sdl("SDL_NumJoysticks"); is_virtual = sdl("SDL_JoystickIsVirtual");
            name_for_index = sdl("SDL_JoystickNameForIndex"); joy_open = sdl("SDL_JoystickOpen"); joy_close = sdl("SDL_JoystickClose");
            set_axis = sdl("SDL_JoystickSetVirtualAxis"); set_button = sdl("SDL_JoystickSetVirtualButton");
            get_error = sdl("SDL_GetError");
            if (failed) { say("plug", "error this SDL has no virtual joysticks (2.26 or later has)"); return; }
        }
        if (!(was_init(SDL_INIT_JOYSTICK) & SDL_INIT_JOYSTICK)) return;
        plugged_once = 1;
        const char *err = plug();
        char r[200];
        snprintf(r, sizeof r, "%s%s", err ? "error " : "ok", err ? err : "");
        say("plug", r);
    }
    // Every whole line added to the commands file since the last poll.
    for (;;) {
        ssize_t n = read(cmds, line + have, sizeof line - 1 - have);
        if (n <= 0) break;
        have += n;
        char *nl;
        while ((nl = memchr(line, '\n', have))) {
            *nl = 0;
            const char *err = line[0] ? apply(line) : NULL;
            char r[300];
            snprintf(r, sizeof r, "%s%s", err ? "error " : "ok", err ? err : "");
            if (line[0]) say(line, r);
            have -= nl + 1 - line;
            memmove(line, nl + 1, have);
        }
        if (have == sizeof line - 1) have = 0;  // a line too long for any command
    }
}

int SDL_PollEvent(void *event) {
    if (!real_poll) real_poll = dlsym(RTLD_NEXT, "SDL_PollEvent");
    step();
    return real_poll(event);
}

__attribute__((constructor)) static void start(void) {
    const char *c = getenv("STAND_IN_PAD"), *l = getenv("STAND_IN_PAD_LOG");
    if (!c || !l) return;
    cmds = open(c, O_RDONLY | O_CREAT, 0644);
    logf = fopen(l, "a");
    if (cmds < 0 && logf) { say("start", "error cannot open the commands file"); fclose(logf); logf = NULL; }
}
