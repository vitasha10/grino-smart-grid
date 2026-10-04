# 3D village (S2 / S5) — `street3d.js` v2.1

Real-time three.js scene: a small Armenian village block seen from ~30° above with a strip of sky and soft hills at the top,
**rotatable** (drag / wheel / pinch).
One pole-mounted 10/0.4 kV transformer at a crossroads feeds a **radial** low-voltage network:

| Line | Direction | Homes | Without SunGuard at 13:00 (MODEL) |
|---|---|---|---|
| A | east, with a branch down a lane | 6 (A1–A4 on the street, A5–A6 on the branch) | 240 … **252 V** (end of the branch) |
| B | west | 4 | 242 … 249 V |
| C | north, short | 3 | 238 … 239.7 V — **OK without SunGuard** |
| D | south, **2.3× more rooftop PV** | 3 | 248 … **255 V** → inverters trip (see below) |

`street3d.js` replaces `window.Street` from `street.js` **in place** (same object, same method names), so `deck.js` keeps working.
If WebGL2 is missing, the import fails, or the fps watchdog gives up, the 2D street stays / comes back and
`window.Street3DFailed = true`.

Files (all new): `street3d.js`, `street3d_test.html`, `README_3D.md`,
`assets/vendor/three/` (three r186: `three.module.min.js` + `three.core.min.js`, `addons/Sky.js`, `addons/BufferGeometryUtils.js`,
`addons/OrbitControls.js` — `from 'three'` rewritten to `'../three.module.min.js'`, no import map needed; `LICENSE`),
`screens/3d_v2_*.png`.

## Integration

Already done in `deck.js` (`try3D()`): `import('./street3d.js').then(m => m.upgrade($('#street'), { active }))`.
`upgrade(el, opts)` options:

| opt | default | |
|---|---|---|
| `active` | `body[data-screen]` is a sun screen of `GRINO.SCREENS` | start rendering |
| `watchdog` | `true` | fps watchdog (see below) |
| `autoRotate` | `true` | idle turntable (see `setAutoRotate`) |
| `scrim` | `false` | `'light'` = frosted top-left behind the headline (for the deck's dark `body.r3d` text), `'dark'` = for white text |
| `keepOut` | headline + S5 chips + source line | stage-px rectangles `[x0,y0,x1,y1]` where scene labels never go |
| `home` | `{yaw:4, pitch:27, dist:90, target:[-4,0,19]}` | default view (lens: 53° vertical FOV + 203 px vertical lens shift: village low in the frame, horizon at y≈200, Ararat in the sky strip) |

**Needed in the deck for mouse/touch rotation:** the S2/S5 slide layers lie above `#street`, so they must let the pointer
through (the canvas itself turns `pointer-events:auto` only while the scene is active):

```css
body.r3d .slide.scene{pointer-events:none}
body.r3d .slide.scene a, body.r3d .slide.scene button{pointer-events:auto}
```

Without it everything works except dragging; `orbitBy` / `setView` from the remote still work.
Must be served over http(s) or `127.0.0.1` (ES modules); opened as `file://` the deck stays 2D.

## API

Homes are indexed **A1–A6, B1–B4, C1–C3, D1–D3** (16) in `volts()`, `boxedHouses()`, `state().v / out / homes`.

| Call | Behaviour |
|---|---|
| `init(el)` · `setActive(bool)` | render loop + pointer input only while active |
| `setSun(v, ms)` | v ∈ **[-0.15, 1]**: [-0.15, 0) = before sunrise (05:00–06:00: sun below the horizon, cool blue-hour light, no shadows, wires and labels neutral, no status marks); 0 = sunrise — the sun disc rises right of Ararat with a soft glow; 1 = 13:00. `ms = 0` jumps (scene entry); `ms ≥ 1000` = scripted eased sweep over `ms`; otherwise the sun follows the target with a critically damped spring (no overshoot) capped at 0.38 /s — pre-dawn → noon takes ≥ ~3 s (measured: 90 % in 2.7 s, 99 % in 3.25 s), smooth with targets at 50 Hz. The deck can enter S2 at -0.12 |
| `sweepSun(v, ms = 6000)` · `getSun()` | long eased sweep for the autopilot |
| `setGuard(true)` | SunGuard on lines **A (+branch) and B** → green, ✓ on their homes; **line D stays red**; C needs none |
| `setGuardAll(on)` | `true`: also line D → all green · `false`: back to A+B (or none if `setGuard(false)`) |
| `setGuard(false)` | removes all boxes |
| `setGuardRight(on)` | alias of `setGuardAll` (two-line version compatibility) |
| `addBox()` | next stage: none → A+B → A+B+D (pop + radio burst); returns `boxes()` |
| `setBoxCount(k)` | k ≤ 0 none · 1–10 A+B · > 10 A+B+D |
| `boxes()` · `boxedHouses()` · `cutPercent()` | boxed homes (0 / 10 / 13) · 16 booleans · equal trim of the worst boxed line, % |
| `setBoxes(show)` | S5 mode: switched-off boxes on every home, line captions show "with / no SunGuard" |
| `pulse()` | brief brightening of the boxes' glow (no radio rings — the boxes talk over home Wi-Fi) |
| `highlightPanels(on, ms = 600)` | "panels keep working": `true` plays a bright sweep over the PV panels of the **boxed** lines (and of lines boxed later while on) and shows a chip "panels working · no emergency shutdown" above each boxed line's label; `false` hides the chips. The unboxed over-limit line keeps its OVER label |
| `volts()` | 16 voltages (current, animated) |
| `state()` | `{sun, target, panelsHighlight, inverters[16] (0 = tripped … 1), tripped ['D3'…], stage 0/1/2, boxes, k, kBy{A,B,C,D}, cut, cutBy, v[16], homes[16], out[16], view{yaw,pitch,dist}, autoRotate, quality, fps, renderer:'3d'}` |
| `setView(yawDeg, pitchDeg, ms, dist?)` | yaw = compass bearing the camera looks to (0 = north), pitch = degrees down (clamped 12–78), dist 70–340 m |
| `orbitBy(dYawDeg, dPitchDeg)` | relative move (300 ms) — for the phone remote |
| `resetView(ms = 900)` | back to the home view |
| `setAutoRotate(on)` | idle turntable: 8 s after the last interaction the view swings ±10° (48 s period) around where the user left it — Ararat stays in the sky strip; `false` stops it |

## Model (MODEL, illustrative)

Tree feeder, lines independent, transformer 236 V: rise at home i = c · Σ_j R(i,j) · P_j over homes j **on the same line**,
R(i,j) = length of the common path from the transformer (+ half of the service-drop length for i = j), P_j = sun^1.25.
c is set so the worst home (end of A's branch) is 252 V at full sun (F13). Homes near the transformer stay lower; the short
line C stays ≤ 240 V. A boxed line: volt-var −40 % of each home's voltage effect, plus one equal output factor k ∈ [0.4, 1]
for its homes, the largest that keeps the line ≤ 240 V. At 13:00 with boxes: A k = 0.42 (trim 58 %), B 0.51 (49 %), D 0.82 (18 %);
all lines ≤ 240.0 V. Colours: ≤ 240 V `#009E73`, 240–242 `#E69F00`, > 242 `#D55E00` (Okabe–Ito); over-limit chips are also
**filled** (shape cue) and the end-of-line readouts carry an "OVER" tag; ✓ = has SunGuard (not "voltage OK").

## SunGuard logic: owner mode first, then ENA (v2.4)

- **Owner mode (`setGuard(true)` = boxes on A and B; `setGuardAll(true)` = also D):** a box switches on the inverter's volt-var
  (−40 % of its voltage effect, no energy lost) and trims real power **only** as much as needed to keep its own voltage below the
  inverter trip with margin (**≤ 250 V**). At 13:00 volt-var alone is enough: A 245.6 V, B 243.8 V, D 247.4 V, **cutPercent() = 0 %**
  (stays 0–15 %). Lines may stay **above 242 V (amber, "above legal limit")** but nothing trips and the panels keep working
  (chip "panels working · no emergency shutdown" via `highlightPanels(true)`).
- **ENA (`setTap(on, ms = 1500)`):** the transformer goes one tap step down (−2.5 % ≈ −5.75 V at every house). If that does not bring
  every house ≤ **241 V** at full sun with the current boxes, it uses −5 % (−11.5 V). With A+B+D boxed: −2.5 % would give max 241.7 V,
  so −5 % is used → A 234, B 232, C 228, D 236 V, all green "within the legal limit"; the transformer tag reads "tap −5 %".
  `setTap(false)` restores. The tap also lowers the night baseline (236 → 230.25 / 224.5 V, still inside 198–242).
  To prefer the single −2.5 % step (max 241.7 V, displayed "242 V"), set `TAP_TARGET = 242` in street3d.js.
- **Colours:** green = within the legal band (≤ 242 V); amber "above legal limit" = > 242 V on a line with SunGuard (no trip);
  red **OVER** only for unboxed lines above 242 V or an inverter trip.
- `state().tap = {on, percent (−2.5 / −5), volts (−5.75 / −11.5), progress 0…1}`; `volts()` include the tap.

## Line D: inverters' emergency shutdown (v2.3)

Without SunGuard, line D's far end exceeds **253 V** (EN 50549-1 trip setting, F12) when the sun is high (s ≳ 0.92). Each unboxed
inverter above 253 V for 0.6 s trips: output to 0 in 0.2 s, **its panels go dark**, line D's label shows a red chip
"⚠ emergency shutdown · panels off", the far-end voltage falls to ~245 V (no export); after 5 s it restarts with a 1.2 s soft start →
voltage rises → trips again (cycle ≈ 6.8 s; real inverters wait 60 s — time compressed for the stage). With SunGuard on D
(`setGuardAll(true)`, v2.4 owner mode) the line stays ≤ 250 V (247.4 V at noon, volt-var only), panels work, no cycling.
SunGuard boxes switch on **house by house from the transformer outward** (250 ms apart, 0.6 s ease-in-out); voltages and labels follow
smoothly. Night / dawn baseline is 236 V everywhere.

## Look, labels, performance

- **Labels (v2.1): one per line**, above its last home, 2 rows: "Line A · with SunGuard" (S5) / "Line B" (S2) / "Line C · short line",
  then the worst voltage of the line at 54 px with ✓ / "near limit" / **OVER**; border and number colour by level, blue panel = line has
  SunGuard. Plus a small "transformer" tag. No per-house numbers: each house has a **34 px status mark** at its service connection —
  green disc ✓ (≤ 240 V), amber disc ! (240–242), vermillion triangle ! (> 242) — colour + shape, read as a pattern.
  Labels track the 3D positions every frame, hide behind the camera / off screen / in keep-outs, and never overlap (line labels first,
  marks hide under them). The sun dial keeps only the arc, the clock and a MODEL chip.
- Houses: tuff masonry with 0.72 m courses and dark lime joints (texture repeat 3.6 m, reads at this distance), pink / ochre / grey /
  dark tones, flat roofs with parapets and PV racks or low corrugated roofs (grey / rust) with PV, dark-framed rectangular / arched
  windows, arched doorways on some houses, balconies with thin railings on the two-storey houses, courtyard walls with metal gates,
  2 grape trellises, 16 apricot / walnut trees.
- Ground: darker road shoulders, a muted green kitchen garden with rows behind every house, dirt paths, ~70 fields around the block,
  a low hill ring (~0.6 km) and a hazy mountain ring (~3.5 km), so every orbit direction has a horizon.
- **Mount Ararat** on the horizon, centre-right of the default view (x≈1100–1560 at 1920, behind the village, clear of the title zone and labels):
  (Masis at bearing 16°, Sis at 4.8° from the home view; the sunrise disc at 25°, between Masis and the sun dial)
  broad snow-capped Masis with a long gentle flank towards the sharper Sis on its left, a low saddle, hazy rock, lit by the scene sun
  (warm at dawn). Stylised and larger than life (≈ 900 m at 9 km instead of 5137 m at ~50 km), world-fixed, in the home view's direction
  (readability over the real bearing, which is south of Yerevan). Continuous low hills (no gaps — a gap showed a white horizon blob)
  and a low hazy mountain ring complete the horizon.
- Sun: real Yerevan June sun position drives light, sky and moving soft shadows.
- 21 draw calls, ~57 k triangles (Ararat grid 27 k), brighter ambient / exposure at noon (v2.3), DPR ≤ 1.5, PCF shadows 2048 (re-rendered only when the sun moves), MSAA.
- Measured v2.1, **Intel UHD 0xA78B**, headless Chrome 154 (ANGLE D3D11, not vsync-locked, so > 60 = headroom), 1920×1080, 2 s windows,
  GPU shared with the Claude app (17–43 %) and other processes: S2 noon 63–79 fps, S5 all boxes 64–69 fps, sun sweep 55–75 fps,
  turntable with radio rings 43–62 fps. With Ararat: S2 noon 71–75 fps, S5 all boxes + turntable 71–72 fps. v2.3: S2 noon 79–81 fps, S5 all boxes + turntable 81–83 fps. A run during another agent's GPU-heavy screenshots dropped to 21–34 fps — measure on the stage
  laptop with nothing else running. Start-up long tasks 0.1–0.5 s (once 4 s on a cold profile), on S1.
- Watchdog: 1.5 s < 12 fps → 2D at once; < 30 fps → low quality (0.62 resolution, no shadows); then 3 s < 25 fps → 2D.

## Fallback snapshots (for the deck's 2D crossfade if WebGL fails)

`screens/3d_v2_dawn.png` (06:50), `3d_v2_noon_off.png` (13:00, no boxes), `3d_v2_noon_guard.png` (A+B boxed, D red),
`3d_v2_noon_all.png` (A+B+D boxed) — 1920×1080, home view, labels and sun dial included, no slide text;
`3d_v2_noon_guard_1366.png` — the same S5 state at 1366×768, no slide text (all four line labels in frame).

## Test page

`http://127.0.0.1:8000/street3d_test.html` (serve `site/deck` with `python -m http.server 8000 --bind 127.0.0.1`).
Keys: ←/→ sun, 0–9 sun steps, S sweep, G guard (A+B), R guard all, + next stage, − none, B boxes (S5), P pulse,
[ ] rotate ∓30°, U pitch 30/60°, V reset view, O auto-rotate, A active, H slide text, 5 S2/S5, F force 2D, C clean.
URL: `?sun=1&guard=1&all=1&boxes=1&screen=s5&clean&text=0&auto=0&nowd&scrim=light&view=yaw,pitch,dist&home=yaw,pitch,dist,x,z`.

## Known limitations

- `street.js` (2D) still draws the old street: if 3D is off, the deck should crossfade the `3d_v2_*.png` snapshots.
- The sun dial is a UI element, not a sky object (the camera looks down at 40°; the sky shows only at low pitch).
- Status marks under a line label are hidden (the label wins).
- `prefers-reduced-motion`: no turntable, no dashes/pulses, instant camera moves.
