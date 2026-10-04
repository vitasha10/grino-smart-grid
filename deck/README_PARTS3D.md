# SunGuard exploded view — `assets/parts3d.js`

Real-time three.js product render of the SunGuard box for one deck screen: a slim 3-module DIN-rail device clipped on a
rail next to two circuit breakers → the breakers fade away, the front ("nose") lifts off, the four modules slide out of
the case and line up in a row with plain-language labels.
Everything is procedural (geometry, PCB artwork, printing) and offline; no textures, no HDRI, no other libraries.

| File | What |
|---|---|
| `assets/parts3d.js` | ES module, sets `window.Parts3D` on load (also `export default`) |
| `parts3d_test.html` | standalone test page: 1920×1080 stage scaled like the deck, buttons, FPS meter |
| `assets/vendor/three/addons/RoomEnvironment.js`, `RoundedBoxGeometry.js` | three.js **0.186.1** addons from jsDelivr, `from 'three'` rewritten to `'../three.module.min.js'` (same as the other addons) |
| `screens/parts3d_*.png` | screenshots 1920×1080 (headless Edge, Intel UHD iGPU) |

Uses the already vendored `assets/vendor/three/three.module.min.js` (r186). `street3d.js` imports the same URL, so the
deck loads three.js once.

## Integration (deck)

Must be served over http(s) (ES modules do not load from `file://`); from `site/deck`:
`python -m http.server 8000 --bind 127.0.0.1`.

```html
<div id="parts3d" style="position:absolute; left:640px; top:150px; right:60px; bottom:90px"></div>
<script type="module">
  import('./assets/parts3d.js').then(async () => {
    const ok = await Parts3D.init(document.getElementById('parts3d'), { theme: 'dark', active: false });
    if (!ok) { /* window.Parts3DFailed === true → keep the current 2D screen */ }
  }).catch(() => { window.Parts3DFailed = true; });
</script>
```

On entering the slide: `Parts3D.setActive(true); Parts3D.explode();` — on leaving: `Parts3D.setActive(false)`
(optionally `assemble(0)` so the next visit starts closed). The container may sit inside the scaled 1920×1080 stage:
sizes are taken from the element (CSS px of the stage), the GPU resolution from its on-screen size.

## API (`window.Parts3D`)

| Call | |
|---|---|
| `init(el, opts) → Promise<boolean>` | renders into `el` (adds `.p3d-root` with a canvas and an HTML overlay). `false` + `window.Parts3DFailed = true` when WebGL2 is missing or anything fails. Second call with the same element returns the same promise; another element disposes the first. |
| `explode(ms = 1800) → Promise<boolean>` | front panel lifts off, modules leave the case front-most first: straight out of the case, then a smooth curve into the row, slight turn towards the camera. Resolves `true` at the end, `false` if interrupted. |
| `assemble(ms = 1500) → Promise<boolean>` | exact reverse, clears the highlight |
| `highlight(i)` | `i` = label index 0…4 (below). The part comes towards the camera (+10 % size), all others dim to ~26 %, its label turns into a pill, the other labels fade. `-1` / `null` clears. On a closed device indices 0–3 explode first. Garbage (`99`, `'x'`, `NaN`) = clear. |
| `setLabels(bool)` | label overlay on/off (fades; framing eases to use the freed space) |
| `setActive(bool)` | `false` stops the render loop completely (0 draw calls); `true` resumes |
| `setCaption(text)` | optional caption slot `.p3d-cap` at the bottom centre (empty by default, nothing hard-coded — e.g. `'≈ $43 of parts'`); the framing makes room for it |
| `state()` | `{ready, failed, active, exploded, target, highlight, labels, fps, cpuMs, pixelRatio, resolutionScale, size, drawCalls, triangles, gpu}` |
| `dispose()` | removes canvas/overlay, frees GPU memory and the WebGL context; `init` can be called again |
| `LABELS` | the five label strings |

Label indices (= highlight indices): `0` Microcontroller with radio · `1` Voltage sensor · `2` Link to the inverter ·
`3` Power supply 230 V → 5 V · `4` DIN-rail case (case + front panel + DIN rail + cable).

Options (`init`): `background` (`'transparent'` default, or any CSS colour), `theme` (`'dark'` = light text for dark
slides, `'light'` = #253B33 text), `labels` (true), `labelPx` (34 — label size in CSS px of the container; ≥ 32 at
1920×1080), `exploded` (start exploded), `active` (true), `idle` (gentle ±10° turntable, 16 s period), `caption`,
`dprCap` (1.5), `floorGlow` (true, faint light pool on the floor), `onFail(reason)`, and for tuning `yaw` (47°),
`elev` (15°), `fov` (22°), `debug` (shader error checks + `window.__p3d`).

Events on the container: `parts3d:ready`, `parts3d:failed` (`detail.reason`).

## The model (1 unit = 10 mm, real proportions)

- **DIN-rail case**: modular housing 3 modules wide, 53 × 90 × 60 mm, DIN 43880 stepped profile (shoulders top and
  bottom at 44 mm, 45 mm "nose" in the middle front), RAL 7035 light-grey matte plastic, no vents. Three screw terminals
  on each shoulder as real round holes with the screw ~9 mm deep, wire entries on the top / bottom faces, small printed
  marks (L N ⏚ / A B ⊥), housing rivets on the sides, DIN latch at the back, clipped on a slotted TS35 rail. The
  removable nose carries a small smoked window with 3 LEDs (PWR / RADIO / LIMIT) and a small printed "SunGuard"
  (no logo plaque). 3-core cable stub (brown / blue / green-yellow) into the top terminals.
- **Context (assembled view only)**: two generic 1-module circuit breakers (C16, toggle in ON, red contact indicator,
  no brand) on the same rail to the right; they fade out during the first 30 % of `explode()` and back in at the end of
  `assemble()`. They are not a label / highlight target and are excluded from the exploded framing.
- **Microcontroller with radio**: green 46 × 26 mm carrier with two rows of gold pin headers, black radio module with a
  nickel RF shield can and printed meander antenna, USB-C, two buttons, regulator, USB-UART chip, LEDs, 0805 parts.
- **Voltage sensor**: blue 46 × 19.5 mm board, black voltage transformer, multi-turn trimmer, SOIC-8 op-amp, blue 2-pin
  screw terminal, 4-pin header. (Both boards are 46 mm wide so that they physically pass the 47 mm front opening.)
- **Link to the inverter**: red RS-485 board, SOIC-8 chip, green 2-pin screw terminal, 4-pin header, LED.
- **Power supply 230 V → 5 V**: black potted module with 4 pins and white print.
- PCB artwork is drawn on canvases: solder mask, copper pour and traces under the mask (bump), exposed ENIG/HASL pads
  (metalness/roughness map), vias, plated holes, white silkscreen with pin names. No meaning is carried by small details.

Look: MeshStandard/Physical PBR, RoomEnvironment PMREM reflections, warm key light with soft PCF shadow (1024),
cool fill, two rims, ACES tone mapping, sRGB output, contact shadow under the layout (top-down depth, blurred, rendered
only when parts move), transparent background by default.

## Performance

- Static geometry merged per part and per material; plain colours merged further into 3 vertex-coloured material
  classes → **41 draw calls assembled / 35 exploded** (+ shadow map while parts move), ≈ 29 k triangles.
- Light rig turns with the idle rotation, so the shadow map and contact shadow are re-rendered **only while parts
  move**; the camera fit is cached while nothing moves. Main thread ≈ 4 ms per frame (`state().cpuMs`).
- Pixel ratio ≤ 1.5 and ≤ 1.6 × 1080p pixels, computed from the on-screen size (inside a scaled stage: real pixels).
- Adaptive resolution: 2 s below 40 fps → −15 % per axis (floor 0.6); 5 s at ≥ 58 fps → back up (at most twice).
- Measured (headless Edge, ANGLE D3D11, **Intel UHD Graphics 0xA78B**, 1920×1080, MSAA, 5–6 s windows; the same GPU
  was shared with the Claude app and other agents' headless browsers at 25–30 % 3D load, so numbers are noisy):
  main thread 1.2–2.4 ms per frame; typical runs 60 fps and above (headless is not always vsync-locked: 66–132 fps
  seen), worst windows under contention 42–47 fps, where the adaptive resolution stepped to 0.85 and came back.
  Earlier clean run of the explode/assemble loop: 60 fps, 0 frames > 50 ms. The built-in browser pane throttles hidden
  tabs to 1 fps, so it is not a valid fps measure.
- Start-up: font wait ≤ 0.9 s (async), scene build + PMREM on the main thread, shaders via `compileAsync`.

## Robustness (checked)

No WebGL2 (getContext patched) → `Parts3DFailed = true`, `init` → `false`, all calls no-ops, console clean ·
WebGL context lost → `Parts3DFailed = true` + `parts3d:failed`, canvas removed, re-init works · 12 × dispose/re-init →
one canvas, no context leak warnings · interrupted explode/assemble → promises `false, false, true`, final state
consistent · `setActive(false)` → 0 GL draw calls in 1.2 s · container resize / display:none at init → follows ·
labels: exact words, 34 px, inside the container, no overlaps, caption does not hit labels ·
`prefers-reduced-motion` → no idle turn, transitions ≤ 0.25 s · console clean (no errors, no warnings).

## Test page

`http://127.0.0.1:8000/parts3d_test.html` — buttons and keys: E explode, A assemble, 0–4 highlight, X clear,
L labels, P active, M caption, B deck-like sub-box container, T light theme (re-init), R re-init, D dispose, C clean.
URL: `?clean`, `?e` (start exploded), `?h=2`, `?box`, `?theme=light`, `?cap`, `?still` (no idle turn), `?nolabels`,
`?yaw=47&el=15&fov=22`, `?debug`, `?nowebgl2` (simulates a browser without WebGL2).

## Known limitations

- Needs http(s)/localhost (ES modules); from `file://` the import fails → the deck keeps its 2D screen.
- Interior of the closed case is not modelled beyond the parts themselves (no wiring between modules).
- Text printed on the 3D parts (SunGuard label, PSU print, silkscreen) uses Plus Jakarta Sans if it loads within
  0.9 s, otherwise the system font.
- If the deck hides the container with `display:none`, call `setActive(false)` as well (the loop would otherwise keep
  running on a 0×0 canvas).
