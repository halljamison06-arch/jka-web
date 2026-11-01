# JEDI:RE modernization status

JEDI:RE is an unofficial browser modification of Star Wars Jedi Knight: Jedi Academy.
Raven/id Software engine credits, Virtastic's port credits, GPL notices, and trademark
notices remain intact. Engine identifiers, asset directories, save locations, and DLL
interfaces retain their existing names.

## Implemented and exercised in the browser

- Cyan/ink identity, responsive launcher, locked page title, favicon, social image,
  metadata, loading presentation, project links, Docker labels, and persistent game badge.
- Original title artwork generated locally at runtime and uploaded through `R_LoadImage`.
  A targeted WebAssembly-only menu shader replaces the retail logo's opaque three-stage
  stack with one transparent stage. Retail/demo archives are not modified or bundled.
- Performance, Balanced, High, and Ultra presets. Their pixel ceilings are 0.92, 2.07,
  3.69, and 8.0 MP respectively; DPR ceilings are 1, 1.5, 2, and 2. These are budgets,
  not promises that the full budget is used or that a particular FPS is achieved.
  Presets tune supported texture filtering, anisotropy, geometry LOD/subdivision,
  texture mip reduction, and the existing shadow modes. Dynamic lighting stays enabled.
- Engine frame instrumentation at `GLimp_EndFrame`, with mean/p95 frame interval,
  CPU submission time, draw/texture-upload counts, optional asynchronous disjoint GPU
  timer queries, resolution, and WASM **capacity** (not live allocated heap usage).
  F8 toggles diagnostics; F9 exports the original engine log. The graphics panel can
  download a performance/network report. A missing GPU timer is reported as unavailable.
- Optional WebGL1 post-processing: adjustable bloom, exposure, saturation, and
  contrast-sensitive edge smoothing. This is an LDR fullscreen pass, **not HDR**, PBR,
  tone mapping of a floating-point scene, or the published FXAA algorithm. It is off
  by default for every preset and remains experimental.
- The post pass copies scene color once per frame, uses an isolated VAO, and restores
  touched GL state. A clean color buffer prevents feedback of the previous graded image.
  GL mutations are tracked after a one-time state snapshot on enabling: synchronous
  state queries are not repeated each frame. Unsupported VAOs disable the effect.
- Initialization and resize use the same quality-capped target dimensions. Previously,
  raw DPR dimensions were compared with capped renderer dimensions, which could
  request a full texture-reloading `vid_restart` for an unchanged effective resolution.
- Python and nginx asset caching now revalidates mutable filenames rather than forcing
  all bytes to download again or keeping unversioned bytes immutable for a year.
  Python serves Last-Modified validators and 304s, with 206/416 and If-Range behavior.
  HTML stays `no-store`; cross-origin isolation headers are preserved.
- Fresh macOS builds work with Bash 3.2 empty-array expansion and BSD sed source-list
  handling. Original engine shell-script bytes are preserved by `.gitattributes`.

Quality changes after launch take effect on the next page launch; save before reloading.
Post controls are live. Pause using the game's menu before adjusting graphics in combat.
Existing gamma controls remain in the game's settings.

## Measurements and practical limits (November 1, 2026)

The automated probe uses installed Opera GX (Chromium/CDP), ANGLE Metal on Apple M3,
1280×720 CSS pixels, DPR 2, hardware rendering, the official demo's `t1_sour` startup
sequence, six-second sampling windows, and the V8 CPU profiler. Other game tabs were
closed for the isolated runs. Scripts explicitly assert CA_ACTIVE, live GL submissions,
nonblack pixels, and no WebGL errors. CA_ACTIVE also includes the in-level introductory
camera: these are **startup-scene measurements**, not a campaign gameplay benchmark.
The camera/animation changes between windows, so the table is not a frozen-scene causal
speedup claim. More devices and repeatable demos are needed for release performance claims.

| Run | Backing resolution | Observed FPS | p95 frame interval |
| --- | --- | ---: | ---: |
| Hosted engine snapshot, original policy | 2560×1440 | 17.3 | 67.1 ms |
| Performance, post off | 1280×720 | 22.7 | 52.7 ms |
| Performance, post on with state cache | 1280×720 | 22.2 | 53.1 ms |
| Balanced, post off | 1920×1080 | 18.7 | 59.4 ms |
| High, post off | 2560×1440 | 16.2 | 68.3 ms |
| Ultra, post off | 2560×1440 | 15.6 | 75.4 ms |

These runs **do not meet the 30/60 FPS goals**. The menu separately reached about 59 FPS;
that is not evidence of 60 FPS combat. Browser RAF cadence in the Performance run was
22.6 FPS while engine submissions were 22.7 FPS, with RAF timing mode 1/divisor 1 and
`document.hidden === false`. Latest sampled GPU time near startup was about 16.8 ms.
No more precise explanation of the remaining browser/compositor/driver pacing gap is
established by those measurements. It would be incorrect to label it solely a WASM,
Ghoul2, or GPU bottleneck.

V8 profiling found the initial post implementation's synchronous `getParameter` calls
consuming most sampled CPU time (4,445 samples in one window). After state caching,
that hot spot disappeared; idle time dominated again. CPU task duration dropped from
approximately 6.2 seconds per six-second window to well under one second. Scene timings
and browser scheduling vary, so retain profiles when reproducing this observation.

During steady startup rendering, submissions were about 212–219 draws/frame and texture
uploads were effectively zero after loading. WASM capacity remained 768 MiB. This does
not establish absence of leaks across level transitions, nor texture-resident VRAM use.
There is no evidence here that new Ghoul2 caching or geometry rebatching would be the
highest-value change; the original renderer already caches texture and GL state.

A direct hosted HTTP probe returned a correct 206 response for bytes 0–65535 of the
3,475,726-byte engine WASM, but `Cache-Control: no-store`, with approximately 0.83 s
first-byte time and 0.93 s total time. One sample is not a latency distribution. The
hosted demo downloads roughly 179 MiB before boot; warm-load revalidation is therefore
material. Local HTTP tests verify 304 reuse. The existing public deployment has not
been replaced by this branch.

## Verification

Build engine and game module with Emscripten 6.0.1:

```sh
export EMSDK=/path/to/emsdk
bash shared/wasm-build/build-jka.sh
bash shared/wasm-build/build-jka-modules.sh
python3 shared/web/server.py jka
```

Both compiler error files were empty, and engine/game WASM artifacts were rebuilt.
The demo pak used for local tests is ignored and is not committed or included in outputs.
Retail data was unavailable; the full campaign, retail-only assets, save round trips,
mobile browsers, WebGL context restoration, and full device matrix were not revalidated.

```sh
npm ci --ignore-scripts
npm run test:quality
npm run test:http
CHROME=/path/to/chromium node shared/wasm-build/verify-jk-play.mjs jka 8794 "+set sv_pure 0 +devmap t1_sour"
CHROME=/path/to/chromium node shared/wasm-build/verify-menu.mjs 8794 t1_sour
CHROME=/path/to/chromium node shared/wasm-build/profile-jedi-re.mjs \
  'http://localhost:8794/?diag=1&quality=performance&args=%2Bset%20sv_pure%200%20%2Bdevmap%20t1_sour' /tmp/jedi-re-profile
```

Quality policy tests and real HTTP tests pass. All four presets reached CA_ACTIVE and
rendered nonblack framebuffers without GL errors. The full post test verifies shader
rendering, toggling off, subsequent normal rendering, and unchanged-viewport resize.
The existing menu test passes main-menu rendering, engine key delivery, pause opening
and closing, camera refusal/restoration, and explicit menu commands. A separate menu
capture asserts that the authored title texture was uploaded by the engine.

The probe emits JSON measurements, CPU profiles, and screenshots. `--smoke` checks one
standard rendering window; `--menu` verifies the title texture in the actual main menu.
A positive engine-frame/readback control is required; RAF alone does not prove rendering.

## Remaining engine work

This branch is a verified first modernization increment, not the complete directive.
There is no WebGL2 material renderer, normal/specular/PBR material pipeline, shadow
mapping, AO, true HDR, new saber/Force particle assets, atmospheric scattering, or
seamless dynamic resolution controller. The existing classic lighting, fog, particles,
and stencil/blob shadows remain the gameplay renderer. Post bloom affects bright
pixels generally; it is not a new saber-lighting implementation.

Legacy GL emulation requires WebGL1 in this port; switching context version alone was
already documented to fail. A WebGL2 migration needs explicit vertex formats, shaders,
material/lightmap passes, skinned-character validation, and a compatible WebGL1 path.
Runtime dynamic resolution must avoid `vid_restart` texture reloads and synchronize
renderer/UI/cgame dimensions. Automatically triggering those restarts in combat is
not an acceptable substitute. GPU/compositor tracing, fixed-camera A/B runs, and a
retail campaign regression suite should guide that next stage.

## Resources and licensing review

No new third-party runtime code, shaders, fonts, textures, or models were adopted.
The title artwork, favicon, social layout, post shaders, and browser policy are authored
for this GPL project. System fonts are referenced/rendered; font binaries are not bundled.
The existing dependency/license notices remain in `THIRD-PARTY-LICENSES.md` and `NOTICE.md`.

Primary references consulted:

- [Khronos WebGL registry](https://registry.khronos.org/webgl/) for context, VAO,
  texture-copy, and timer-query API contracts.
- [Emscripten OpenGL support](https://emscripten.org/docs/porting/multimedia_and_graphics/OpenGL-support.html)
  and [WebGL optimization](https://emscripten.org/docs/optimizing/Optimizing-WebGL.html)
  for legacy-emulation constraints. No external engine code was copied.
- [Poly Haven asset license](https://polyhaven.com/license): individual assets are CC0,
  while API code/access has separate terms. No assets or API code were imported; no
  compatibility or performance claim is made for an untested asset pack.

CC0 texture candidates still need exact item provenance, size budgets, shader mapping,
and real scene benchmarks before adoption. Large PBR maps do not create a PBR renderer
in this fixed-function engine. Commercial game data remains separate and user-supplied.
