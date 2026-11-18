# Pages on a phone

How a page is played and measured on an Android phone from a computer, what a phone does differently from a desktop,
and what has been measured there. `tools/play_phone.mjs`'s header has its options; docs/playing.md has the rest of
playing a page, and docs/findings.md what was measured on desktops and laptops.

## Connecting

- adb reaches the phone over USB or Wi-Fi. A cable that charges may still not carry data, and a phone that was plugged
  in before USB debugging was on can stay invisible to `adb devices`; wireless debugging (Developer options) avoids
  both: `adb pair <address>:<port> <code>` once with the code the phone shows, then the phone announces itself and adb
  connects on its own (`adb devices` lists it as `adb-<serial>._adb-tls-connect._tcp`).
- `adb forward tcp:<port> localabstract:chrome_devtools_remote` gives the phone's Chrome DevTools on that port of the
  computer: `/json/version`, `/json/list` (the tabs), `PUT /json/new?<url>`, `/json/activate/<id>`. Pick a port no
  local browser uses: a headless Chrome on the computer listening on the same port took the forward's place for
  another tool, which then drove the phone's tab instead of its own.
- Talk to a tab over its own socket, `ws://127.0.0.1:<port>/devtools/page/<id>`: Target.attachToTarget through the
  browser's socket hung on the phone. The tab's own socket gets the console of every frame in it, the hub's game
  frame included, once Runtime is enabled; Chrome first replays the tab's earlier console, so lines from before a run
  are told apart by their time.
- Chrome on Android gives a tab in the back no animation frames, and the game draws nothing there: bring a tab to the
  front (`/json/activate/<id>`) before measuring it, and check nothing covers Chrome (its own Settings, a picker,
  the notification shade): `adb shell dumpsys window | grep mCurrentFocus` names the window in front.
- The phone's clock is not the computer's: the console's timestamps ran 11.1-11.8 s ahead. play_phone.mjs reads the
  lead at the start and takes it off.
- Keep the screen on while a computer drives it: `adb shell svc power stayon true` and a long
  `settings put system screen_off_timeout <ms>`, left so after (Sharing a phone).

## Driving a page

- `Page.addScriptToEvaluateOnNewDocument` puts a script into every frame the tab loads, so a counter of presents
  (`getCurrentTexture` on a WebGPU canvas) counts the hub's game frame too. The game in the hub is `frames[0]` of the
  top document, the same origin, so its `FS` and `Module` are in reach from the top.
- `Input.dispatchTouchEvent` from the protocol is a user gesture: a tap on the hub's tile starts the game in fullscreen
  and landscape as a finger does. `adb shell input tap <x> <y>` taps the screen in its pixels, the protocol's touch the
  top document in CSS pixels (a DPR-3 phone in landscape fullscreen is 800x360 CSS pixels).
- `Input.dispatchKeyEvent` (`rawKeyDown`, `keyUp`) reaches the game once it has been touched: Enter and Space through
  Rush 2049's menus and the gas, as on a desktop.
- `adb exec-out screencap -p` saves the screen and `adb shell uiautomator dump` lists what is on it as text, bounds
  included, which tells what is in front without a picture: a picture of the screen shows the phone owner's
  notifications too whenever the shade is down. The game's canvas is not in the dump. In Git Bash set
  `MSYS_NO_PATHCONV=1`, or `/sdcard/...` becomes a Windows path.
- A ROM gets onto the phone with `adb push <rom> /sdcard/Download/`. The page's Load ROM opens Android's chooser
  (Camera, Camcorder, Photos & videos), since the input asks for no type; Photos & videos opens the system's file
  picker, whose search finds the file. A turn of phone_turn.mjs needs none of it: its preload answers the page's
  picker with the ROM from the computer.
- A fresh origin, with nothing stored and nothing cached (phone_turn.mjs's proxy, emptied with
  `Storage.clearDataForOrigin` before and after a play): serve the site at `http://localhost:<port>` on the computer
  (a proxy of the published hub that also serves its README.md, which the hub reads from its own origin on
  localhost), and `adb reverse tcp:<port> tcp:<port>` makes it the phone's localhost too, a secure context, so WebGPU
  and the service worker work there. The phone's other origins keep their saves and ROMs.
- Chrome's command line on a phone that isn't rooted: chrome://flags `#enable-command-line-on-non-rooted-devices`,
  then `adb shell 'echo "_ <flags>" > /data/local/tmp/chrome-command-line'`, and Chrome stopped and started twice
  (`am force-stop com.android.chrome`, then `monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1`)
  before chrome://version shows them. Delete the file and reset the flag after: Chrome shows a warning bar while it's
  on.

## Measuring

- `tools/play_phone.mjs` plays a page there by steps (or watches a person play) and prints presents a second, the
  longest gap, the animation frames, RT64's and the page's console, and the GPU's load and clock where adb can read
  them (`/sys/kernel/gpu` on an Exynos: `gpu_busy`, `gpu_clock`, `gpu_max_clock`). The CPU's caps are in
  `/sys/devices/system/cpu/cpufreq/policy*/scaling_max_freq`, the temperatures in `adb shell dumpsys thermalservice`.
- **Heat decides the numbers.** A phone caps its clocks as it warms, more while it charges: after half an hour of play
  and measuring (charging, a skin at 39 °C), the Exynos 2100's big cores were held at 1.04 GHz of 2.9, its middle ones
  at 1.04 of 2.8 and its Mali-G78 at 403 MHz of 858, and Rush 2049's race fell from 40-49 presents a second to 11-44.
  So every number from a phone has its clock caps and temperature beside it, the runs it compares are interleaved, and
  the phone rests between them with its tab blank, as a player's phone is cool when the game starts and warm after.
  Neither Power saving (`settings put global low_power 0`, which a Galaxy keeps; `cmd power set-mode` it undoes) nor
  its absence moved those caps: heat set them, and they stayed while the skin was at 39-43 °C.
- `?present-stats` on the game's own page prints plume's presents, how long each took on the GPU, the waits for
  presents in flight and the time spun to a present's slot, and RT64's game frames a second beside the rate the game
  reports and the frames drawn for them. In the hub the game's frame has its own URL, so a `--preload` script that
  adds the query to the game frame's (`history.replaceState` before the page's scripts run) turns it on there.
- A settings file is put in the game's IndexedDB (`/home/web_user /<game>/`, store `FILE_DATA`, the file's path as
  the key, `{ timestamp, mode, contents }`) by an `eval` step before the tile is touched: a file written through
  `FS` once the game has booted is read only at its next start.
- The DevTools trace (Tracing over the browser's socket) of a race showed the GPU process's main thread ~53% and the
  page's ~49%, both with the trace's own cost; a trace slowed the page to 25-28 presents a second.
- Never scan the wasm heap from a sampler: `page_driver.mjs`'s RDRAM helpers search the whole heap, 13 s of the
  page's thread a call on a phone, so a sample that used them froze the page it was measuring.

## What holds a page back

A page presents short of the display's rate when the GPU falls behind or when the game's own frames do, and on a phone
it is often the second: each game frame is a run of CPU work, on threads that wait for each other, and a phone's cores
(capped by heat) are 2-4 times slower than a desktop's. RT64 interpolates to the display, so presents can stay up
while game frames fall. Telling them apart:

- `?present-stats`'s RT64 line: game frames a second under the rate the game reports is the CPU. plume's line: a
  present done on the GPU more than a display frame after it, and no time waiting for fewer presents in flight, is the
  GPU.
- A `profile` step in play_phone.mjs's steps profiles every thread of the page for a while and prints each one's busy
  share and top functions; the `.cpuprofile` files open in DevTools' Performance panel for the call paths. Build the
  page linked with `--profiling-funcs` for this: without it a profile names a wasm function only by its index. The
  threads a game frame waits on are the ones to cut: the display list thread (RT64's `send_dl`, `State::fullSync`),
  the game's threads (the recompiled `func_` ones) and the scheduler thread that starts each graphics task.
- What costs on a phone that a desktop hides: a clock read (`emscripten_get_now`, `clock_gettime`) leaves wasm for
  JavaScript, and one per texture uploaded took 9.6% of the display list thread; the web build's `memcmp` (musl's)
  compares a byte at a time, and one over 6 MB a frame took 5 ms; a byte-at-a-time copy (RT64's TMEM loads) is slow
  where a word at a time vectorizes; a wait for the page's thread (plume's device thread) waits behind everything
  queued there, which on a phone is milliseconds; and a wait for the GPU that a desktop's has long finished, such as
  render to RAM's late copy landing at the next list's start, which was a quarter of Conker's display list thread
  (Conker's Bad Fur Day on a Galaxy S21); and work that grows as the square of a game's calls, such as RT64's frame
  matching before rt64 9086c93, 18-23 ms of Banjo-Tooie's game frames (Banjo-Tooie on a Galaxy S21).
- A thread a profile shows 100% busy in its own function, with nothing called below it, can be waiting: a wait inlined
  into its loop is put down to the loop (docs/findings.md). `timer_thread` reads so on every game's page, and a build
  that counted its loop's passes printed none in 75 s of 1080° Snowboarding's demo, so the thread sat in one wait all
  through (1080° Snowboarding on a Galaxy S21).
- Presents short of the display with neither the game's frames nor the GPU behind are RT64's interpolated frames:
  with present-stats, frames drawn a second under twice the game frames of a game interpolated at 30 is RT64
  skipping a game frame's later frames, which it does when its workload thread runs past each frame's share of the
  game frame's time. The page's thread and RT64's present thread were each under half busy then.
- A game that runs at 60 where it can (Rush 2049 at its 60 fps, Perfect Dark) and that a phone's CPU holds to 30-50
  mixes frames of one and two VIs. Timed at the shortest of the last three (RT64_UNEVEN_FRAME_RATES before rt64
  7844c07), the display's own 60 leaves RT64 nothing to interpolate, so it drew one frame for each game frame and
  presents fell to about the game's rate. Now, where the shorter is one VI and the longer took 3 of the last 8 frames,
  a frame is timed at the longer and gets two: Rush 2049's race without its own hold presented 53 a second against
  38-42 (below). A game at 30 mixing frames of 2 and 3 VIs or more is timed at the shorter, as before: timed at the
  longer, each frame was set three or more, and RT64 skipped them (Other games on a Galaxy S21). The same
  game held to 30 gets two for each frame and drops none, and still presents a few more, so such a game's own code
  holds it to 30 on a page while it can't keep 60 up (Rush 2049 and Perfect Dark below).
- A GPU's load says little on a phone: its clock follows the load, so a lighter frame (resolution Original) ran the
  Mali-G78 at 130 MHz, still 60-80% busy, and presented no more.
- Nor does the time from a present to its end on the GPU: the Mali-G78's governor (Interactive, in
  `/sys/kernel/gpu/gpu_governor`) keeps the GPU at its lowest clock while a frame leaves it time to spare, so a
  present takes 18-23 ms there with the GPU waiting on nothing. plume's waits for fewer presents in flight
  (present-stats) say whether the GPU holds presents back: none is no. The GPU's time at each clock over a run is
  in `/sys/devices/platform/18500000.mali/time_in_state` on an Exynos 2100, read before and after it.

## What a phone does differently

- The canvas is in CSS pixels, not device pixels: on a DPR-3 phone the game frame's canvas was 726x280 in the hub's
  frame (800x360 fullscreen) while the screen is 2400x1080, so Chrome scales the picture up three times. RT64's Auto
  rounds the canvas's lines up to a whole multiple of the game's 240: 2x at 280-480 lines, so it draws 480 lines for a
  280-line canvas, about 2.9 times the canvas's pixels.
- The ROM picker offers the camera and photos first (above).
- Memory is set as on a desktop: every page reserves a 1536 MB heap (`frontend/CMakeLists.txt`) and only what it touches
  is resident. Jet Force Gemini's page from Pages, a minute into its game on a Galaxy S21 (7.2 GB): the page's process
  1.23 GB (PSS), Chrome's GPU process 450 MB and the browser 320 MB, 1.8 GB still available.
