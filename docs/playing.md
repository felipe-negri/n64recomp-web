# Playing and measuring a page

How a page is played and measured. `tools/play_page.mjs`'s and `tools/page_driver.mjs`'s headers have the options;
`docs/findings.md` has what was measured this way.

## The tools

- `tools/play_page.mjs` plays a page by a plan in either browser and prints presents a second, sound frames short, the
  shader waits, the shaders the list missed, WebGPU errors and the GPU's and browser's load. A game's plan is its
  `tools/play_plan.json`; a game fork's shader plan plays with `--section`. `tools/page_driver.mjs` drives the browsers
  for it and for your own scripts: Chrome headless (`--headless=new --enable-unsafe-webgpu`) or `--headed` in a window
  off the desktop, Firefox always in a window off the desktop over WebDriver BiDi (Firefox headless has no WebGPU
  adapter). Such a window has no focus, so keys and clicks come from script, the ROM is sent in pieces, and the
  viewport is one CSS pixel a pixel, or `--scale 2`'s two, a laptop at 200%. `--on-screen` maximizes either browser on
  the desktop at its scale instead, with none of those overrides. A plan's clicks are in 1256x645, moved to the
  viewport the page has (`innerWidth`, `innerHeight`), never to `--size`.
- On Windows play_page reads the GPU from Windows' counters for the adapter the page draws with (by LUID), with
  nvidia-smi's GPU 0 beside it: on a laptop with two GPUs that one is the idle discrete GPU.
- Where a Linux host with an NVIDIA GPU is at hand, pages are played there and not on the machine that works on the
  game: `tools/remote_play_page.sh` runs play_page.mjs or record_shaders.mjs in Chrome or Firefox in a container there
  (`tools/page_play.Dockerfile`), on a page built there or one at a URL, and brings back only the output, the files
  the play was told to write and the lines it recorded. Both draw WebGPU on the GPU through Vulkan into Xvfb, Chrome
  in a window as Firefox is (headless, NVIDIA's driver gives Chrome no adapter: page_driver.mjs says why). Where the
  host's GPU is shared through a queue each play is a job of it: one that checks (a smoke play, a Firefox play for
  crashes, a recording) shares the GPU with other jobs, and one with `--measure` has it to itself, for a play whose
  numbers are the result (its header and `tools/play_job.mjs`'s say how). A run there records `platform` and the GPU's
  name, and is compared only with runs on Linux: its numbers are that GPU's, so an interleaved pair played there
  compares two builds, and a number alone stands for no laptop (Laptop-like limits on a desktop).
- A page served from a build dir needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp` (threads need SharedArrayBuffer); on Pages `coi_serviceworker.js` sets them after one reload. Look at a
  page with CDP `Page.captureScreenshot` of that page.
- Look at a desktop build with `tools/capture_window.ps1`: it plays a timed plan of keys in the window of the build it
  starts and captures that window alone with PrintWindow, never the screen, in shots or series, and lists the frames
  unlike both of their neighbours. With `RT64_FRAME_LOG` set, RT64 (rt64-web, RT64_GAME_FRAME_WORKLOADS on) prints
  each game frame, why it ended and what each of its workloads drew, and each present and wait; `tools/frame_log.mjs`
  reads that beside the captures' times, to tell a frame drawn in parts from one matched wrongly. Their headers say
  how. A page opened with `?frame-log` prints the same log to its console.
- Check a desktop build's frames by machine with `tools/frame_check.mjs`: a capture comes
  tens of milliseconds after the last, so captures miss a fault in the frames between the game's, and an eye misses
  one that looks plausible. With `RT64_FRAME_DUMP=<dir>` (and `RT64_FRAME_DUMP_SECONDS=<from>-<to>` for a scene's
  worth), RT64 writes into that folder, made if it isn't there, every frame presented and where the 3D's triangles
  lay across the view (rt64-web's `src/hle/rt64_frame_dump.h`); `capture_window.ps1 -Env` passes the variables to
  the build it starts. frame_check reads one dump for frames drawn for themselves alone between two that agree and for
  a picture cut short at the 4:3 view's sides, and a
  dump of the same plan in a 4:3 window with one at 32:9 (`--narrower`, `--wider`) for a world culled at the 4:3
  view's sides. Where a Linux host with an NVIDIA GPU is at hand, the dumps and the check are made there and not on
  the machine that works on the game: `tools/remote_frame_dump.sh` plays the game's Linux build by the same plan in
  all three windows, runs frame_check there and brings back only its text, the logs, the plan's shots and the flagged
  frames (its header and `tools/frame_dump.mjs`'s say how), since a dump is too big to move and the check holds a
  third of a machine's cores for minutes. Its verdicts match a dump made on Windows by `capture_window.ps1`.

## Plans

- A game's `tools/play_plan.json` (DKR-R's, Snap's and Rush 2's in `web/`) is its regular play, 2-3 minutes with
  every timeout counted, and every play of the game is by it unless the work needs more. A change that needs a longer
  play (one to a level or screen only it reaches) is played by the game's `play_plan_extended.json` beside it, which
  the work writes if the game has none: it starts the same and goes on to two or three more levels in 5 minutes or
  less. The shaders an extended play misses go into the game's list, in the same work. Each plan's header says what it
  plays.
- A plan reaches a level as a player does (the menus where quick, the survey's warp or stage start where not; its
  header says which) and plays a minute or more in its levels, the whole run 2-5 minutes. A walk sways out and back by
  as much each way about a spot it was played to and looked at: a blind walk in one direction, or back the way it came,
  carries the character off a ledge, into water or out an exit. Its waits and holds in the level are on the game's own
  clock (a `clock` step, page_driver's header): in ms of the browser's time, uneven frames walked Firefox's runs of one
  plan to other places than Chrome's. So is the wait before a shot of the first screen that draws: Firefox builds the
  list's first section there, the game waiting with its clock stopped, and Rayman 2's menu shot, 3 s of the browser's
  time after the menu came up, caught that wait black in every Firefox run. A plan that ends on black is the plan's
  fault until a direct warp there draws black too: Banjo-Tooie's walks took Banjo off ledges and through exits, and its
  plan ended black where the page draws the place in both browsers.
- The step the rest of a plan stands on (a survey's `play()`, which loads a file) is a `need` (page_driver's header): a
  run that never gets there fails, rather than its warps and walks pressing keys at a menu for minutes, a path no player
  takes. A plan that goes on to more levels in one load makes each level's start one too, checking in RDRAM that the
  level it asked for is the one playing: Pilotwings 64's gyrocopter test didn't end when its results were pressed, so
  the next test's start found a vehicle flying, resolved at once, and the gyrocopter flew on for minutes.
- Load ROM waits for the shader list Chrome builds behind the launcher: a click while it builds can be lost.
  `page_driver.mjs`'s rom step waits for `RT64: all <n> prebuilt shaders built` itself before it presses, in every plan,
  so a plan's own `until` on it (or on Firefox's line that it builds none there) only times its other steps.
- A level the survey starts may crash when it ends: the screens after it read what the menus before it would have set
  up. So a plan that starts one keeps the player alive for as long as it plays (GoldenEye's `setInvincible()`): a
  GoldenEye play of Dam long enough for its guards to kill Bond stopped on the Mission Failed screen in Chrome and
  Firefox (`strcmp` from `fileGetIndex`, given the name of a briefing mission select never chose:
  `load_briefing_text_for_stage` under `init_menu0C_missionfailed`). A thread of the game that throws ends the run
  as a failed one once nothing has presented for 15 s, and a page that refuses the ROM ends it at once, with the line
  it said that in (`play_page.mjs`).
- A page that gives play_page no answer for 15 s ends the run as failed, "the page stopped answering", and says which
  side stopped (Windows): each of the browser's processes' cores, its main thread's and the tab's busiest threads by
  name, and the failure ends `main threads: the tab's <cores>, <state>; the browser's <cores>, <state>`. The tab's at
  a core, running, is the page's script in a loop (or Emscripten's spin on a futex); the tab's waiting with the
  browser's at a core is the browser's driver. Nothing from inside the page tells them apart: a worker's console lines
  stop with the page's main thread in Firefox and don't reach the driver in Chrome (docs/findings.md, A page that stops
  answering). The browser's waiting at no cores while the page goes on is the browser held from outside: on Windows,
  Task Manager open on the desktop holds win32k's lock through a Firefox page's play, and Firefox's driver, on the
  browser's main thread, stops answering for minutes, so a play host keeps it closed.
- After any mouse click (Load ROM's included) recompui is in mouse mode with nothing focused, and the first key only
  brings the focus back (`update_focus` in `ui_state.cpp` runs after the key reached RmlUi): Enter starts the game on
  the second press, or click Start Game. Every RecompFrontend game does it, desktop too.
- Keep `--profile` between runs for a warm one, on its fixed port: IndexedDB belongs to the origin, port included. For
  a cold visit in Chrome, start a new `--user-data-dir` once on the launcher first: a profile's first run stores nothing
  that hits later, and one whose first run built the shaders never hits. Close Chrome with `Browser.close` and wait for
  the process to end, or it loses what it wrote to its caches (page_driver.mjs's close() waits 30 s, then stops a browser
  still running, with its processes). A debugging port another browser on the machine holds is
  refused (`page_driver.mjs`).

## Uncapped, and the browsers' clocks

- On a desktop GPU a page is played uncapped (`--uncapped`): capped, every page and build reads about 60 there.
  `?uncapped` needs the browser's animation frames uncapped too (Chrome `--disable-frame-rate-limit`, Firefox
  `layout.frame_rate` 360, never 0, which spins them at thousands a second: docs/findings.md, Uncapped in Firefox;
  `--uncapped` sets both), and its interpolated frames take turns in 8 color targets of the game's framebuffer at the
  canvas's scale (rt64 8a2c6a7), 0.25-0.55 GB at 3840x2000. A run at the display's rate is for what uncapped switches
  off (RT64's pacing, the presents-in-flight cap, late done callbacks), and so for a laptop's own runs.
- Uncapped measures cost per present (the GPU's, the page's WebGPU calls, the GPU process's), so a higher number on a
  desktop GPU is a cheaper frame everywhere. It can't see done callbacks coming back late (25-45 ms on a laptop's half
  idle Intel UHD, which RT64's pacing takes for a GPU falling behind: Firefox's 20-30 there; a fast GPU's come back
  early) or the compositor on screen, so it doesn't clear a laptop result (docs/findings.md, WebGPU in Chrome and
  Firefox, A laptop, measured).
- Not for a game at 30, though, whose 12 frames drawn a game frame at 360 outrun RT64's 8 colour targets: what it gets
  there turns on when the game's next frame comes, so a change to the game's own timing (render to RAM, a late copy)
  moves its number with the cost the same. Such a change is played at `?uncapped=240` too (`--query "?uncapped=240"`
  beside `--uncapped`), with `?present-stats` for the frames RT64 drew a game frame and the rate it timed the game at
  (docs/findings.md, A game at 30, uncapped).
- Nor for a change that trades interpolated frames for the game's own (one that holds them while the game's list
  waits for the GPU): its A/B reads fewer presents as worse with the game playing faster and its sound whole. Read the
  game's frames a second there too, `?frame-log`'s GF lines (`--query "?frame-log"`), and the sound short beside them
  (docs/findings.md, Interpolated frames and the game's full sync).
- Chrome on Windows times its animation frames by the display's vblank; with no display (a monitor off) it sleeps
  17.9 ms between frames, and every page whose game runs below 60 presents ~55.6 at the display's rate. play_page
  records animation frames a second beside the presents, and leaves presents out of the comparison for a display-rate
  run with fewer than 57 (docs/findings.md, Chrome with no display). Firefox times its frames itself and draws ~60
  either way.
- Firefox on Windows ends every timed wait on a page's thread on the system timer's tick, 15.6 ms by default, but a
  desktop often runs a finer one another program asked for, and plays faster than a laptop. `tools/timer_tick.c` (its
  header) stretches each timed wait to that tick: `?timer-tick=15.625`, `?timer-trace=<n>` for the waits left,
  `?timer-exempt=<name>` for what one costs. A wait a page's speed hangs on is never timed.

## What a page says about itself

- `Module.recompAudioStats()` (frames played, frames short); `?present-stats` (plume 90ef8e5: presents a second, how
  late each onSubmittedWorkDone comes back; rt64 f262d56: at each present RT64 drops, where the present thread's time
  went); `?presents-in-flight=<1-8>` (otherwise 2, raised to 4 at most while it holds presents back); `?uncapped`
  (plume 904b26c, rt64 e408ed4); `?record-shaders`; and the console reports each CPU write render to RAM's late copy
  kept. To see a page's sound as the game writes it, wrap `AudioWorkletNode` in a preload, take
  `processorOptions.ring` and sample its two counters every few ms.
- What its GPU time goes on: `--preload tools/pass_probe.js` (its header) prints each kind of pass, their draws and GPU
  time (timestamp queries, where the browser offers them; counts only elsewhere) and the draws by fragment shader;
  `--query probe-skip=<KB>` leaves one shader's draws out to price them (docs/findings.md, A page's GPU time).
- How long the game's frames are against its presents: `--preload tools/frame_lengths.js --query
  '?present-stats&frame-clock=<hex>'`, the address of a clock the game adds each frame's VIs to (Jet Force Gemini's
  800FD748), logs both at each animation frame, and `node tools/frame_lengths.mjs <the play's output>` counts what
  each guess at a frame's length would hold and cut (docs/findings.md, A game's uneven frames). Read it at 60
  animation frames: headless Chrome runs the screen's rate, 240 on a 240 Hz one (Firefox: `--firefox-pref
  layout.frame_rate=60`).
- Whether timed waits off its thread end on time all through a play: `--preload tools/wait_probe.js` logs, each
  second, a worker's shortest of three 100 us waits (`waitprobe <ms>`), what plume and the VI thread measure once as
  the page starts (docs/findings.md, A host that holds Chrome's presents).
- What holds its GPU work as it boots or reaches somewhere new: `--preload tools/pipeline_probe.js` logs each shader
  module and pipeline the page makes (`pipeprobe <s> render|compute`, with its modules, depth, blend and cull state)
  and each queue round trip of 200 ms or more (`pipeprobe <s> roundtrip <ms>`): a pipeline Firefox's GPU process
  builds in line shows as a long round trip right after its line (docs/findings.md, Compute pipelines built at their
  first dispatch).
- How much of its heap a page has taken, and what ran it out: `--preload tools/heap_probe.js` logs the heap's break
  and length each second (`heap <s> sbrk <MB> len <MB>`) and, before an `Aborted(OOM)`, the request's size and the
  stack that made it (`heapoom`) (docs/findings.md, Memory). With `--query ?heapwalk` it also walks dlmalloc's chunks
  every 20 s (`heapwalk`): the sizes that hold the most and that grew, and what points at the most grown, which names
  the vector or map a leak piles into.
- What a game makes of several controllers, and where its rumble goes: `--preload tools/gamepad_probe.js` gives the
  page stand-in pads, plugged in by a plan's `plugPads()` once SDL runs (before Start Game), pulled out and plugged
  in again by `unplugPad()` and `replugPad()`, and says what reached each pad's vibrationActuator (`padRumbles()`)
  and which pad the page looked for (its header).
- Video memory: read the adapter's `\GPU Adapter Memory(*)\Dedicated Usage` and nvidia-smi, never
  `\GPU Process Memory(*)\Dedicated Usage`, which climbs by a canvas a frame in Firefox (Windows 10 counts every reopen
  of its shared canvas texture, KB4490156). nvidia-smi's is the whole GPU's, so a page filling video memory beside
  another shows as the other page's climb and its "Out of Memory". play_page reads the GPU process's private bytes each
  sample, and in Firefox about:memory's split of them at the play's start and end (`gpuProcessMemory`); each read holds
  Firefox's page and its thread 120-470 ms, its sound too, so a play's gaps and sound start after the first, and a
  fault's after the second (docs/findings.md, Memory, A page in a hidden tab). Which kind of WebGPU
  work grows it: `tools/gpu_growth.mjs` (its header) plays each kind of a page's calls alone, at the rates
  `--preload tools/webgpu_census.js` reads off the page; whose code made what it grows (D3D12's, a driver's, DXC's,
  Firefox's): `tools/memory_scan.ps1`, unelevated, from outside the process.
- Whether its canvas is in CSS pixels, its sound whole, its saves found again and a pad drives it: `--backcheck`
  (play_page's header), in Chrome at 2 device pixels a CSS pixel with a stand-in pad driving the plan, then a hidden
  tab, a reload and the browser closed and opened again (`--fault reopen`) with the saves compared, and in Firefox the
  boot's sound and a hidden tab. `--pad` alone plays a plan with the pad.
- How it comes through what a player's browser does to it: `--fault resize,hidden,audio,device,reload` (play_page's
  header) does each in turn once the play is in its level (a resized window, another tab in front for 30 s, its
  AudioContext suspended, its WebGPU device lost, then a reload over a warm cache and service worker), and records
  whether it presents again after each, and what it said. Play it from Pages, whose cache and service worker a reload
  finds warm (docs/findings.md, Faults), and in Chrome with `--chrome-flag --disable-audio-output`: muted, a hidden
  tab counts as silent and Chrome idles its process, which a player's tab with sound doesn't see (docs/findings.md, A
  page in a hidden tab).
- A thread of the game that traps names only an offset in the wasm on a page linked without `--profiling-funcs`
  (`Game.wasm:8767891: RuntimeError: unreachable executed`); `node tools/wasm_offset.mjs <wasm or URL> <offset>`
  names the function that holds it. `unreachable executed` in the export the page's `.js` calls `___trap` is
  Emscripten's `abort()`, not a bad pointer: it prints `Aborted(<reason>)` just before, play_page puts that line in
  front of the exception in the failure it records, and an empty reason is C's `abort()` (a failed `new`, libc++
  throwing with exceptions off, the runtime's own), which the stderr lines before it say.

## Laptop-like limits on a desktop

A laptop's integrated graphics finds most new flaws. Without one, a desktop takes these stand-ins, each recorded in
the run, so a run is compared only with runs that set the same (numbers: docs/findings.md, The stand-in, measured,
and Laptop-like limits on a desktop, measured):

- `--size 3840x2000 --uncapped`, the stand-in: about 7 times a laptop window's pixels, so a frame's GPU cost
  shows as presents a second. It finds a costly frame and clears none.
- `--size 1920x945`, the laptop window's viewport: what the page lays out and clicks, and the sizes Auto draws at
  (GoldenEye's scene 2682x1320), a target's memory with them. A desktop GPU draws every page at the display's
  rate there, so it is for the other limits and for memory, not for presents.
- `--affinity <n>` holds the browser, every process of it, to n logical processors (4: two cores), in Firefox as in
  Chrome, where `--cpu-throttle` slows only Chrome's page thread. It shows a page short of cores: on 4 Banjo and
  GoldenEye played in Firefox as on 16 at the display's rate, its shader waits ~20% longer.
- `--fallback-adapter` gives the page the browser's software adapter (SwiftShader in Chrome, WARP in Firefox), tens of
  times slower than Intel UHD: GoldenEye's Dam drew 2 presents a second. It checks a page boots and draws with no
  WebGPU errors on a weak adapter's features and limits (no `shader-f16`) and how it behaves far behind (RT64 pacing
  presents to the game's frames, holds overrunning the clock), and is no laptop's speed.

None stands in for Windows composing a laptop's screen on the same GPU (what pacing Firefox to 30 on screen was) or
for the GPU's own speed at a laptop's size; Firefox drawing a list's misses with the ubershader (GoldenEye's Dam
collapse) shows on a desktop as `shader missed:` lines.
