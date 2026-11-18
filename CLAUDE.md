# CLAUDE.md

Web support for N64 static recompilations: the game, its menus and RT64 built with Emscripten into one page that draws
through WebGPU (README). Almost all of it is written by AI agents, so this file is what the next one needs: how work
lands, the rules, and where everything else is written, and only what the README, the docs and the code can't say.

## Where things are written down

Each describes main as it is, a PR that makes one wrong fixes it in the same PR, and nothing is written in two places:
a doc points at the other.

- `README.md`, for humans: what this is, the Games table, how a recomp uses it, what each fork adds, what this repo
  adds besides the forks, the layout. It changes when a recomp's porter or a player would notice.
- Comments beside the code, for how and why: each file's header (`frontend/CMakeLists.txt`, `patches/apply.cmake`,
  `frontend/*.js`, every script in `tools/`) and each fork commit's message. Read the header of the file you change
  first, and update it in the same commit.
- A game's own repo, for a finding that explains that game's code.
- `docs/`, read when the task needs it:
  - `docs/porting.md`: what the web needs: WebGPU and the shaders, prebuilt shader lists, Emscripten, mods. Read it
    before a port or a change to a fork.
  - `docs/playing.md`: playing and measuring a page, and what a page says about itself.
  - `docs/forks.md`: every fork commit by its label.
  - `docs/findings.md`: what has been measured.
  - `docs/phones.md`: playing and measuring a page on an Android phone from a computer, and what phones do differently.

This repo, the forks and the game forks are public. Write for a stranger, in the present tense: nothing about a
contributor's machine, servers, host names, paths or accounts, no person's name, no history of renames or "until
<date>", nothing about where ROMs are kept. Beside a measurement, the host is "an idle host" or "a busy host".

Markdown here and in those repos is wrapped by hand, so a wrapped line never starts with `+ `, `- `, `* `, `> `, `#`
or a number and `.` or `)` (`1. `, `15) `): Markdown reads it as a list item, a quote or a heading in the middle of the
sentence. Keep that word on the line above.

## How work lands

A change here is one PR on this repo. It merges once CI is green and what it changes has been played (Changing it).

A check or tool that blocks work for a reason the work didn't cause is fixed in the work it blocks, never routed
around and not handed on by default (CI blaming every PR for a red that another repo's main made is why
`tools/ci_red_on_base.sh` exists).

The forks (`rt64-web`, `plume-web`, `hlslpp-web`, `N64ModernRuntime-web`, `N64Recomp-web`, `RecompFrontend-web`) and
the game forks take no PRs: a change is a commit pushed to the fork's `main` as a fast-forward, pinned by its SHA
(`forks.txt` here, a game fork's submodule).

## Rules

- The web support works for every N64 recomp: a change is game-agnostic and behind `__EMSCRIPTEN__`/`__wasm__` (or an
  option on by default with Emscripten). The games' pages are there to build out and test it, not ports of their own:
  what one game or browser turns up is fixed in the shared support unless it really is that game's, and what one game
  does better (a shader list in sections, the late copy) is tried on the others.
- Every page interpolates to the display's rate and draws at the canvas's size: RT64's Framerate Display and resolution
  Auto, in every game fork and new port, whatever its recomp's desktop build defaults to (README, The recomp's own
  code). A page held to its game's own rate reads that rate uncapped whatever a change costs or saves (DKR-R 29.8-30.0,
  Jet Force Gemini 19-22, on Original), so one that shows its game's own 20 or 30 because of a default is a bug.
- Every web port records a prebuilt shader list and builds it, as part of the port: without one a page is unplayable
  (docs/porting.md, Prebuilt shader lists).
- Never open a PR, issue or discussion upstream at rt64, plume, N64Recomp, N64ModernRuntime, RecompFrontend,
  BanjoRecomp, Zelda64Recomp or Donkey-Kong-64-Recompiled: their CONTRIBUTING.md asks for no LLM-written code (plume's,
  no AI-made contribution and no AI talking to its maintainers). Nor at dino-recomp or dinomod-enhanced-recompiled, or in
  their Discord: dino-recomp bans AI-made contributions and asks its forks to keep the ban, and Dinomod Enhanced is made
  with no AI and consents to no AI fork bundling it, so neither is forked here. Each fork's README opens with a banner,
  and its GitHub description with "AI-written fork:", saying it is AI-written, not upstream's, and offered to nobody
  upstream (hlslpp-web's says only the first two: hlslpp has no ban). Keep that true of a new fork and of a game fork's
  README. A game's own repo is decided case by case: a game fork offers it only what it takes, said to be AI-written
  (GoldenEye64Recomp-web: to podulator's, which takes fixes, features and build work, each a PR of its own from a
  `fix/<topic>` branch of the fork cut from its `main`, played on its desktop build, without the web code;
  the game fork's README).
- No ROMs, ROM-derived assets or extracted game data in git, CI, PRs or pages. A page holds the recompiled code, so it
  is built where the ROM is, never in CI, and its `.data` holds only what it preloads.
- Nothing here names a game, includes from a game's repo or needs its ROM: the web side gets what it needs through the
  runtime's own interfaces, as every recomp does.
- CI (`.github/workflows/ci.yml`, each job's comment says what it checks) builds every library of a page with Emscripten
  from the forks and checks the shaders, and that `patches/` match the forks and apply to every recomp and game fork
  it is built over (red only where the change made it red: a game's check already red over the PR's base warns,
  `tools/ci_red_on_base.sh`). It builds no page (that needs a game), so anything that changes what a page runs is built and
  played before it lands.
  A change to only `*.md` and the tools that play and read pages runs only the `changes` job.

## The forks

Each fork's `main` is the commit upstream pins plus the web support, one commit per change (README, The forks; each
commit's message says what and why). rt64-web's `src/contrib/plume` is plume-web and its `src/contrib/hlslpp`
hlslpp-web; N64ModernRuntime-web's `N64Recomp` is N64Recomp-web. Notes name a change by a label (`plume-0003`,
`rt64-0010`) or by fork and commit (`rt64 c89ced0`): `docs/forks.md` has every one, a line each, and a change pushed to
a fork gets its row there in the PR that moves `forks.txt` onto it.

Twenty-five options are off on a desktop build, on with Emscripten, and settable natively: docs/forks.md lists them
(Options off on a desktop build).

## Changing it

A game's checkouts hold the web support as uncommitted changes (`patches/apply.cmake`, or the game's own patch script),
so commit to a fork from a separate clone of it:

1. `git clone https://github.com/n64hub/<fork>` (its `main`), make the change, and commit it saying what and why.
   Try it in a game first by applying the same diff to that game's patched checkout (plume is
   `<rt64>/src/contrib/plume`).
2. Push it to `main` as a fast-forward, never a force-push: `forks.txt`, its tags and the recomps pin those commits. A
   change to plume-web, hlslpp-web or N64Recomp-web also moves the submodule in rt64-web or N64ModernRuntime-web: push
   that too. A commit that changes no code (a README) moves no pin, so a fork's `main` may be ahead of `forks.txt`. To
   move a fork to a newer upstream commit, merge it into `main` (never rebase), say in the merge what upstream brought,
   and move its upstream commit in `patches/patches.txt`.
3. Here, on the task's branch: bump `forks.txt`, run `tools/export_patches.sh`, commit `patches/` with it, and open the
   PR. A patch that stops applying to a commit in `patches/pins.txt` means the fork has to change.
4. Before it merges, build pages on the branch and play them by what the change can break (docs/playing.md): a game
   fork's checkout with its N64Recomp-browser at the branch's commit. After the merge, CI's `tag` job
   tags main `v0.<n+1>.0` when its jobs pass, for a merge that changes `forks.txt`, `patches/`, `frontend/` or
   `renderer/`; check it came (`git ls-remote --tags origin`). A tag is a release: a recomp checks this repo out at
   one, and moves onto a newer one when it updates.

Read docs/porting.md before a fork change, and docs/findings.md (WebGPU in Chrome and Firefox) before changing plume's
backend or how RT64 builds pipelines or presents on the web.

## Playing a page

- Chrome measures, in interleaved pairs. Firefox with its default prefs is played for crashes, traps, WebGPU errors and
  exceptions, not presents: on Windows' integrated graphics its compositor caps every page at 30-45. Firefox's
  performance is measured only for a change that could move it, with `gfx.webrender.compositor` false.
- On a desktop GPU a page is measured uncapped (`--uncapped`): capped, every page and build reads about 60 there.
- One page plays at a time on a machine, in any browser (docs/findings.md, Two pages at once).
- A desktop GPU's clock wanders, and a contended host reads exactly like a slow page: write down what else was running
  beside a number. The page a build is compared with, played in the same minutes, interleaved (`--note` them, a second
  pair where the first isn't clearly within the noise), tells the host from the build; one pair before and after
  doesn't.
- A plan reaches a level as a player does and plays a minute or more in its levels, its holds on the game's own clock;
  a plan that ends on black is the plan's fault until a direct warp there draws black too (docs/playing.md, Plans).
- A game's desktop build never runs on the GPU from inside WSL2 (Mesa's Dozen over `/dev/dxg`): a device lost there
  wedged the Windows host's GPU driver and froze the whole machine until a restart (docs/findings.md, A desktop build
  on WSL's GPU). Under WSL or Docker it runs on lavapipe, on the CPU; on the GPU only natively, or as its page.

## Ruled out, so don't retry

What each was and what it measured is in docs/findings.md (Ruled out, measured).

- Presents waiting for the animation frame in every browser: on a laptop's Intel UHD Chrome drew as many, with the GPU
  and the browser working harder and twice the long gaps.
- One of plume's WebGPU calls as what grows Firefox's GPU process: none grew it on a test page that submits.
- coi_serviceworker.js's reload missed because its worker got further than register()'s promise: ~100 cold Firefox
  visits always reloaded (shell.html says what a first visit that never started was).
- A cheaper render-to-RAM readback: the time per list stayed, since Chrome paces the readback itself.
- Pilotwings 64's 85-180 ms gaps as its screens change, and Perfect Dark's 133 ms frames in its opening cutscenes, as
  the page's: both are the game's own, on a console and natively too.
- Holding back the list Chrome builds behind the game: the build costs the page little or nothing.
- Building Firefox's pipelines in parallel from the page: its GPU process runs every WebGPU call on one thread, so it
  is slower, and the driver's shader cache spares no rebuild.
- Shorter web builds by ccache behind emcc (it goes in front), configure checks without linking, `RecompiledFuncs/` at
  -O2, or precompiled headers (off for a page: ccache can't cache a file that includes one).
- A fixed heap in place of memory growth (no faster), and `-sGROWABLE_ARRAYBUFFERS=2` (Chrome refuses WebGPU views of a
  growable heap).
- A cheaper GPU frame for Rush 2049's, Majora's Mask's and Conker's pages in the web's own parts: what costs is RT64's
  pixel shaders and Auto's resolution, as on the desktop, and on a phone's Mali too (docs/phones.md).
- A DirectComposition overlay for a WebGPU canvas in Chrome on Windows: Chromium makes one only of video and
  low-latency canvases.
- Building Firefox's shader misses later (where the game sends no frames, or with a later section's wait): a recomp's
  loads are too short, and they come after the list's last section.
- As what paces a page to 30 on a laptop's screen in Firefox: a present's wait() trips to the page's thread, late timed
  waits, the present thread's wait() before its slot sleep, a try's first 0.5 s left out of pace()'s count, 3 presents
  in flight. Each paced the same: what each present costs the GPU in Firefox's compositing decides it.
- The most common of the last frames' VIs as RT64_UNEVEN_FRAME_RATES's frame length: it judders more than the fastest
  of three.
- A list started with the last one's late copy pending, for Perfect Dark at 30 in its levels: its main thread waits for
  a controller sample (`joy_debug_joy`), not the copy.
- Judging a page's timed waits both ways as it plays: it turned several times a second, and the tries cost a sixth.
- A missed shader built in line in Firefox as what stops Perfect Dark's page answering at Defection: the page kept
  drawing, and Firefox's own process answered BiDi late.
- A timed wait to just before a present's slot in Chrome: a tenth end 4-16 ms late, on the system timer's tick.
- wasm SIMD for RT64's TMEM loads and CI4 hashes: up to 9 times as fast alone, and no page drew faster.
- RT64 waiting once for a frame drawn in many workloads, after its last: the game ran at half its rate.
- In Firefox, a section's prebuilt shaders wanted as the game submits them, so its first frame draws none with the
  ubershader: the round trips and sound loss there stayed, since only the ubershader's first build costs Firefox.
- Skipping or batching the device thread's round trips to keep a hidden page's game running in Chrome: Chrome idles a
  silent hidden tab's process, and the trips were a small part of what it lost.
- Waking plume's present wait from visibilitychange for the 5-35 ms of sound Chrome loses as a tab goes hidden:
  Chrome's own work at the hide holds the page's thread first, and a test build lost as much as Pages.
