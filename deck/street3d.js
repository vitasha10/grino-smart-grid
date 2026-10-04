/* street3d.js v2 — real-time 3D Armenian village block for S2 ("Street at noon") and S5 ("SunGuard"). Rotatable (OrbitControls).
 * A pole-mounted 10/0.4 kV transformer (TP) at a crossroads feeds a RADIAL low-voltage network:
 *   Line A — east, long, with a branch down a lane (6 homes) · Line B — west, long (4) · Line C — north, short (3) · Line D — south (3).
 * Drop-in for window.Street (same names as street.js):
 *   init(el) · setActive(bool) · setSun(v, ms) · sweepSun(v, ms) · getSun() · setGuard(on) · setGuardAll(on) · setGuardRight(on)
 *   setBoxes(show) · setBoxCount(k) · addBox() · boxes() · boxedHouses() · cutPercent() · pulse() · volts() · state()
 *   camera: setView(yawDeg, pitchDeg, ms, dist?) · orbitBy(dYawDeg, dPitchDeg) · resetView(ms) · setAutoRotate(on)
 *   setGuard(true) = SunGuard on lines A (+branch) and B; line D stays red; setGuardAll(true) = also D; setGuard(false) = none.
 *   Line C is short and stays <= 240 V without boxes ("not every line needs SunGuard").
 *
 * Voltage model (MODEL, illustrative; tree feeder, each line independent, transformer 236 V):
 *   rise_i = c · Σ_j R(i,j) · P_j over homes j on the same line; R(i,j) = length of the common path from the TP
 *   (+ half of the service-drop length for i = j); P_j = sun^1.25; c so the worst home (end of A's branch) is 252 V at full sun.
 *   Boxed line: volt-var takes 40 % off each home's voltage effect, plus ONE equal output factor k ∈ [0.4, 1] for the boxed
 *   homes of that line, the largest that keeps the line <= 240 V. cutPercent() = 100·(1 - k), worst boxed line.
 * Colour only for data (Okabe–Ito): bars / readouts / wires by voltage, the sun dial, SunGuard boxes and radio, ✓ = has SunGuard.
 * three.js r186 vendored in assets/vendor/three (offline; needs http(s)/localhost, not file://). See README_3D.md.
 */
import * as THREE from './assets/vendor/three/three.module.min.js';
import { Sky } from './assets/vendor/three/addons/Sky.js';
import { OrbitControls } from './assets/vendor/three/addons/OrbitControls.js';
import { mergeGeometries, mergeVertices } from './assets/vendor/three/addons/BufferGeometryUtils.js';

/* ======================= network + model ======================= */
const V0 = 236, RISE = 16, LIMIT = 242, SAFE = 240;
export const VV_CUT = 0.4, MAX_CUT = 0.66;
export const TRIP_V = 253;
export const BOX_TARGET = 250;       /* owner mode: a box trims real power only to stay below the inverter trip with margin */
export const TAP_STEP_V = 5.75;
const TAP_TARGET = 241;      /* ENA: one transformer tap step = -2.5 % of 230 V at every house */           /* EN 50549-1 default: inverter disconnects above 253 V (F12; time compressed for the stage) */
const DROP_W = 0.5;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/* poles: name -> [parent, x, z]  (metres; +x east, -z north; roads along z = 0 and x = 0) */
const TPX = 5.5, TPZ = -8;
const NODES = {
  tp: [null, TPX, TPZ],
  a1: ['tp', 14, -5], a2: ['a1', 28, -5], a3: ['a2', 42, -5], a4: ['a3', 58, -5], ab1: ['a3', 38.8, 14], ab2: ['ab1', 38.8, 30],
  b1: ['tp', -16, -5], b2: ['b1', -32, -5], b3: ['b2', -48, -5], b4: ['b3', -64, -5],
  c1: ['tp', 4.5, -15], c2: ['c1', 4.5, -24], c3: ['c2', 4.5, -31],
  d1: ['tp', 4.5, 14], d2: ['d1', 4.5, 30], d3: ['d2', 4.5, 46]
};
/* homes: line, pole, centre, size, storeys, roof, tuff tone, the road side they face, arched windows */
const TONES = { pink: '#C39A8E', rose: '#BE8E7C', ochre: '#C8A672', grey: '#A39C94', dark: '#6F6A66', cream: '#CFC0A8' };
const HOMES = [
  { id: 'A1', node: 'a1', x: 18, z: -17, w: 9.5, d: 9, fl: 1, roof: 'flat', tone: 'pink', face: 'S' },
  { id: 'A2', node: 'a2', x: 32, z: -17, w: 10, d: 9, fl: 2, roof: 'gable', metal: 'rust', tone: 'ochre', face: 'S', arch: true },
  { id: 'A3', node: 'a3', x: 47, z: -17, w: 9.5, d: 9, fl: 1, roof: 'gable', metal: 'grey', tone: 'grey', face: 'S' },
  { id: 'A4', node: 'a4', x: 62, z: -17, w: 10, d: 9.5, fl: 2, roof: 'flat', tone: 'rose', face: 'S', arch: true },
  { id: 'A5', node: 'ab1', x: 31, z: 24, w: 9.5, d: 9, fl: 1, roof: 'gable', metal: 'grey', tone: 'cream', face: 'E' },
  { id: 'A6', node: 'ab2', x: 48, z: 33, w: 10, d: 9, fl: 2, roof: 'flat', tone: 'pink', face: 'W', arch: true },
  { id: 'B1', node: 'b1', x: -20, z: -17, w: 10, d: 9, fl: 2, roof: 'gable', metal: 'grey', tone: 'rose', face: 'S' },
  { id: 'B2', node: 'b2', x: -36, z: 17, w: 9.5, d: 9, fl: 1, roof: 'flat', tone: 'ochre', face: 'N' },
  { id: 'B3', node: 'b3', x: -52, z: -17, w: 10, d: 9, fl: 1, roof: 'gable', metal: 'rust', tone: 'dark', face: 'S', arch: true },
  { id: 'B4', node: 'b4', x: -68, z: 17, w: 10, d: 9.5, fl: 2, roof: 'flat', tone: 'pink', face: 'N' },
  { id: 'C1', node: 'c1', x: -12, z: -26, w: 9, d: 9, fl: 1, roof: 'flat', tone: 'grey', face: 'E' },
  { id: 'C2', node: 'c2', x: 15, z: -29, w: 9.5, d: 9, fl: 2, roof: 'gable', metal: 'rust', tone: 'cream', face: 'W', arch: true },
  { id: 'C3', node: 'c3', x: -12, z: -38, w: 9, d: 8.5, fl: 1, roof: 'gable', metal: 'grey', tone: 'rose', face: 'E' },
  { id: 'D1', node: 'd1', x: -12, z: 19, w: 9.5, d: 9, fl: 1, roof: 'gable', metal: 'grey', tone: 'ochre', face: 'E' },
  { id: 'D2', node: 'd2', x: 15, z: 33, w: 9.5, d: 9, fl: 2, roof: 'flat', tone: 'grey', face: 'W' },
  { id: 'D3', node: 'd3', x: -12, z: 47, w: 10, d: 9, fl: 1, roof: 'gable', metal: 'rust', tone: 'pink', face: 'E', arch: true }
];
const N = HOMES.length;
const LINES = ['A', 'B', 'C', 'D'];
const lineOf = (i) => HOMES[i].id[0];
/* worst home of each line gets the big readout */
const nodePath = (n) => { const p = []; while (n) { p.push(n); n = NODES[n][0]; } return p.reverse(); };
const segLen = (n) => { const p = NODES[n][0]; return p ? Math.hypot(NODES[n][1] - NODES[p][1], NODES[n][2] - NODES[p][2]) : 0; };
const commonLen = (a, b) => { const pa = nodePath(a), pb = nodePath(b); let s = 0; for (let k = 0; k < Math.min(pa.length, pb.length) && pa[k] === pb[k]; k++) s += segLen(pa[k]); return s; };
const dropLen = (h) => Math.hypot(h.x - NODES[h.node][1], h.z - NODES[h.node][2]);
const RHH = HOMES.map((hi, i) => HOMES.map((hj, j) => (lineOf(i) !== lineOf(j) ? 0 : commonLen(hi.node, hj.node) + (i === j ? DROP_W * dropLen(hi) : 0))));
const NODE_KEYS = Object.keys(NODES).filter((k) => k !== 'tp');
const RNH = NODE_KEYS.map((n) => HOMES.map((hj, j) => (n[0].toUpperCase() !== lineOf(j) ? 0 : commonLen(n, hj.node))));
const C_RISE = RISE / Math.max(...RHH.map((r) => r.reduce((a, b) => a + b, 0)));
/** act[j] ∈ [0,1] = how far home j's box is switched on. Returns home + pole voltages. */
/* line D has much more rooftop PV: its far end reaches 255 V at full sun without SunGuard (> 253 V -> inverters trip) */
const PV_D = (255 - V0) / (C_RISE * RHH[HOMES.findIndex((h) => h.id === 'D3')].reduce((a, b) => a + b, 0));
const PV = HOMES.map((h) => (h.id[0] === 'D' ? PV_D : 1));
/** act[j] ∈ [0,1] = how far home j's SunGuard box is on; inv[j] ∈ [0,1] = inverter output (0 = tripped). */
export function computeVillage(s, act, inv, tapV = 0) {
  const f = Math.pow(clamp(+s || 0, 0, 1), 1.25), k = {}, cut = {}, I = (j) => (inv ? inv[j] : 1) * PV[j];
  for (const L of LINES) {
    let kn = Infinity, any = 0;
    for (let i = 0; i < N; i++) {
      if (lineOf(i) !== L) continue;
      any = Math.max(any, act[i]);
      let A = 0, B = 0;
      for (let j = 0; j < N; j++) { A += RHH[i][j] * I(j) * (1 - act[j]); B += RHH[i][j] * I(j) * (1 - VV_CUT) * act[j]; }
      if (B > 1e-9 && f > 1e-6) kn = Math.min(kn, ((BOX_TARGET - (V0 - tapV)) / (C_RISE * f) - A) / B);
    }
    k[L] = any > 1e-4 && isFinite(kn) ? clamp(kn, 1 - MAX_CUT, 1) : 1;
    cut[L] = any > 1e-4 ? (1 - k[L]) * Math.min(1, any) : 0;
  }
  const P = (j) => I(j) * ((1 - act[j]) + (1 - VV_CUT) * act[j] * k[lineOf(j)]);
  const v = HOMES.map((h, i) => V0 - tapV + C_RISE * f * RHH[i].reduce((a, r, j) => a + r * P(j), 0));
  const nv = RNH.map((row) => V0 - tapV + C_RISE * f * row.reduce((a, r, j) => a + r * P(j), 0));
  const out = HOMES.map((h, i) => f * (inv ? inv[i] : 1) * (1 - act[i] * (1 - k[lineOf(i)])));
  return { v, nv, out, f, k, cut: Math.max(...Object.values(cut)), cutBy: cut };
}
/* order of the boxes along each line: from the transformer outward (path length, then service drop) */
const RANK = HOMES.map((h, i) => {
  const key = (j) => commonLen(HOMES[j].node, HOMES[j].node) + 0.01 * dropLen(HOMES[j]);
  return HOMES.filter((x, j) => lineOf(j) === lineOf(i) && key(j) < key(i)).length;
});
const level = (v, boxed) => (v > LIMIT + 0.05 ? (boxed ? 1 : 2) : 0);
const LCOL = ['#009E73', '#E69F00', '#D55E00'];
const LTXT = ['#57D9AE', '#FFC24D', '#FF8A57'];
const SG = '#56B4E9', SOLAR = '#F0E442';
const NEUTRAL = new THREE.Vector3(0.55, 0.58, 0.62);
const WORST = LINES.map((L) => { let b = -1, bv = -1; HOMES.forEach((h, i) => { if (lineOf(i) === L) { const r = RHH[i].reduce((a, x) => a + x, 0); if (r > bv) { bv = r; b = i; } } }); return b; });

export function webgl2Available() {
  try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')); }
  catch (e) { return false; }
}

/* ======================= scene constants ======================= */
const WIRE_Y = 7.6, POLE_H = 8.8;
const HOME_VIEW = { yaw: 4, pitch: 27, dist: 90, target: new THREE.Vector3(-4, 0, 19) };
/* lens: vertical field of view of the 1080-px stage, and a vertical lens shift (px at 1080) that keeps the village low
   in the frame so a strip of sky and the soft ridge stay visible at the top, like a shift lens in architecture photos */
const LENS = { fov: 53, shift: 203 };
/* Ararat (stylised, larger than life for readability): bearings relative to the home view, metres */
const ARARAT = { dist: 9000, masis: { bear: 16, h: 880, r: 1650 }, sis: { bear: 4.8, dist: 9400, h: 545, r: 800 } };
const TUFF_TILE = 3.6;            /* tuff texture repeat in metres: 5 courses of 0.72 m (blocks read at this distance) */
const SUN_VMAX = 1.2;              /* deck v8: sun units per second (dawn -> noon ~0.8 s); scripted sweeps keep their slow eased ramp */
const SUN_W = 18;                  /* deck v8: critically damped spring, lag behind a moving target 2/w ~ 110 ms */
/* stage-px rectangles where scene labels must not go: deck headline (top-left), S5 chips (bottom corners), source line (bottom) */
const KEEP_OUT = [[0, 0, 1010, 325], [90, 930, 530, 1035], [1440, 925, 1840, 1055], [300, 1028, 1660, 1075]];

/* ======================= helpers ======================= */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function rawRGB(hex) { const c = parseInt(hex.slice(1), 16); return new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255); }
function paint(g, hex, mul = 1) {
  const col = new THREE.Color(hex).multiplyScalar(mul), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function wbox(w, h, d, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]], uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3(1, 1, 1);
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) { E.set(rx, ry, rz); Q.setFromEuler(E); M4.compose(V3.set(x, y, z), Q, S3); return g.applyMatrix4(M4); }
function stripTo(g, keep = ['position', 'normal', 'uv', 'color']) { for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k); return g; }
class Bucket {
  constructor() { this.list = []; }
  add(g, hex, mul) { if (!g.index) g = mergeVertices(g); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); paint(g, hex, mul); this.list.push(stripTo(g)); return g; }
  mesh(mat, { cast = true, receive = true } = {}) {
    const g = mergeGeometries(this.list, false); this.list.forEach((x) => x.dispose());
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = receive; return m;
  }
}
function gableGeo(d, rise, tile = 4) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, d / 2, 0, 0, -d / 2, 0, rise, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([d / tile, 0, 0, 0, d / 2 / tile, rise / tile], 2));
  g.setIndex([0, 1, 2]); g.computeVertexNormals();
  return g;
}
class SagCurve extends THREE.Curve {
  constructor(a, b, sag) { super(); this.a = a; this.b = b; this.sag = sag; }
  getPoint(t, out = new THREE.Vector3()) { out.lerpVectors(this.a, this.b, t); out.y -= this.sag * 4 * t * (1 - t); return out; }
}
/* the sun over Yerevan (40.18 N, UTC+4) in mid-June: s = 0 -> 06:00, s = 1 -> 13:00 */
export const SUN_MIN = -0.15;      /* s < 0 = before sunrise (the deck enters S2 at -0.12 and the operator raises the sun) */
const sunClock = (s) => 6 + 7 * clamp(s, SUN_MIN, 1);
function sunPos(s) {
  const lat = 40.18 * Math.PI / 180, dec = 23.3 * Math.PI / 180, H = 15 * (sunClock(s) - 13.03) * Math.PI / 180;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H));
  return { el, az, dir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)) };
}
const EL_NOON = sunPos(1).el;
/* elevation used for light / sky / the visible disc: exactly 0 at s = 0 (sunrise), below the horizon for s < 0,
   blending into the real Yerevan curve by s = 0.12 (06:50), so the look for s >= 0.12 is unchanged */
function sunElev(s) {
  if (s < 0) return THREE.MathUtils.degToRad(lerp(-8, 0, (s - SUN_MIN) / -SUN_MIN));
  return sunPos(s).el * smooth(0, 0.12, s);
}
const SUN_DISC_BEAR = 25;   /* the visible disc rises in the sky strip, right of Ararat (bearing from the home view, degrees) */
/* house faces: outward normal, tangent (local +x of a plane turned to that face), rotation */
const FACES = { S: { n: [0, 1], t: [1, 0], ry: 0 }, N: { n: [0, -1], t: [-1, 0], ry: Math.PI }, E: { n: [1, 0], t: [0, -1], ry: Math.PI / 2 }, W: { n: [-1, 0], t: [0, 1], ry: -Math.PI / 2 } };
const faceHalf = (h, F) => (F === 'S' || F === 'N' ? h.d / 2 : h.w / 2);
const faceLen = (h, F) => (F === 'S' || F === 'N' ? h.w : h.d);
function facePt(h, F, u, off) { const f = FACES[F], hf = faceHalf(h, F) + off; return [h.x + f.n[0] * hf + f.t[0] * u, h.z + f.n[1] * hf + f.t[1] * u]; }

/* ======================= textures ======================= */
function makeTextures() {
  const r = rng(146);
  const noise = (x, w, h, amp) => { const img = x.getImageData(0, 0, w, h), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(img, 0, 0); };
  /* tuff masonry: 4 m tile, 8 courses of 0.5 m, blocks 0.6–1.1 m, light lime joints, per-block shade */
  const tuff = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#857b70'; x.fillRect(0, 0, w, h);                         /* dark lime mortar */
    const rows = 5, rh = h / rows, j = 7;
    for (let row = 0; row < rows; row++) {
      let pos = -r() * 120;
      while (pos < w) {
        const bw = 120 + r() * 110, sh = 186 + r() * 52, warm = (r() - 0.5) * 16;
        for (const off of [0, w]) {
          const g = x.createLinearGradient(0, row * rh, 0, (row + 1) * rh);
          g.addColorStop(0, `rgb(${sh + 10 + warm | 0},${sh + 10 | 0},${sh + 10 - warm | 0})`); g.addColorStop(1, `rgb(${sh - 12 + warm | 0},${sh - 12 | 0},${sh - 12 - warm | 0})`);
          x.fillStyle = g; x.fillRect(pos + j - off, row * rh + j, bw - 2 * j, rh - 2 * j);
        }
        pos += bw;
      }
    }
    noise(x, w, h, 16);
    for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(60,52,48,${0.06 + r() * 0.1})`; x.beginPath(); x.arc(r() * w, r() * h, 0.8 + r() * 2.4, 0, 7); x.fill(); }
  });
  const metal = canvasTex(256, 256, (x, w, h) => {
    for (let i = 0; i < w; i++) { const s = 205 + 38 * Math.sin(i / w * Math.PI * 2 * 10); x.fillStyle = `rgb(${s | 0},${s | 0},${s | 0})`; x.fillRect(i, 0, 1, h); }
    noise(x, w, h, 10);
  });
  const panel = canvasTex(128, 210, (x, w, h) => {
    x.fillStyle = '#C3C7CB'; x.fillRect(0, 0, w, h); x.fillStyle = '#2B3647'; x.fillRect(5, 5, w - 10, h - 10);
    const cols = 6, rows = 10, cw = (w - 10) / cols, ch = (h - 10) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { x.fillStyle = '#18253A'; x.fillRect(5 + i * cw + 1, 5 + j * ch + 1, cw - 2, ch - 2); }
  }, { repeat: false });
  const asphalt = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#7b7b7a'; x.fillRect(0, 0, w, h); noise(x, w, h, 18); });
  const ground = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#b3ad8f'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { x.fillStyle = r() < 0.55 ? 'rgba(140,146,110,.20)' : 'rgba(190,178,148,.22)'; x.beginPath(); x.ellipse(r() * w, r() * h, 4 + r() * 26, 3 + r() * 14, r() * 3, 0, 7); x.fill(); }
    noise(x, w, h, 10);
  });
  const ao = canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, { repeat: false, srgb: false });
  return { tuff, metal, panel, asphalt, ground, ao };
}

/* ======================= data-layer shaders ======================= */
const MAXSEG = 24;
function wireMaterial(glow) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: Array.from({ length: MAXSEG }, () => new THREE.Vector3(0, 0.62, 0.45)) }, uOp: { value: new Array(MAXSEG).fill(0.45) },
      uPhase: { value: 0 }, uDash: { value: 2.6 }, uDashAmt: { value: 1 } },
    vertexShader: `attribute float aSeg; attribute float aLen; uniform vec3 uCol[${MAXSEG}]; uniform float uOp[${MAXSEG}];
      varying vec3 vCol; varying float vOp; varying float vX; varying float vF;
      void main(){ int si = int(aSeg + 0.5); vCol = uCol[si]; vOp = uOp[si]; vX = uv.x * aLen;
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: glow
      ? `uniform float uPhase, uDash, uDashAmt; varying vec3 vCol; varying float vOp; varying float vX; varying float vF;
        void main(){ float d = fract(vX / uDash + uPhase); float dash = smoothstep(0.0, 0.18, d) * (1.0 - smoothstep(0.32, 0.55, d));
          float a = vOp * pow(vF, 1.3) * mix(1.0, 0.35 + 1.1 * dash, uDashAmt);
          gl_FragColor = vec4(vCol * (0.85 + 0.45 * dash * uDashAmt), clamp(a, 0.0, 1.0)); }`
      : `varying vec3 vCol; varying float vOp; varying float vX; varying float vF; void main(){ gl_FragColor = vec4(vCol * (0.75 + 0.25 * vF), 1.0); }`,
    transparent: !!glow, depthWrite: !glow, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false
  });
}
function quadField(centers, delays, kind, hex) {
  const n = centers.length, pos = new Float32Array(n * 12), cen = new Float32Array(n * 12), cor = new Float32Array(n * 8), del = new Float32Array(n * 4), on = new Float32Array(n * 4), idx = [];
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) { const v = i * 4 + k, c = centers[i]; pos.set([c.x, c.y, c.z], v * 3); cen.set([c.x, c.y, c.z], v * 3); cor.set(C[k], v * 2); del[v] = delays[i]; on[v] = 0; }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCenter', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2)); g.setAttribute('aDelay', new THREE.BufferAttribute(del, 1));
  g.setAttribute('aOn', new THREE.BufferAttribute(on, 1)); g.setIndex(idx);
  const radius = {
    ring: 'float age = fract((uTime - aDelay) / uPeriod); float r = mix(0.5, uMaxR, 1.0 - pow(1.0 - age, 2.0)); vA = aOn * pow(1.0 - age, 1.3);',
    burst: 'float age = (uTime - aDelay) / uPeriod; float r = mix(0.6, uMaxR, 1.0 - pow(1.0 - clamp(age, 0.0, 1.0), 2.5)); vA = (age > 0.0 && age < 1.0) ? aOn * pow(1.0 - age, 1.2) : 0.0;',
    halo: 'float r = uMaxR; vA = aOn;'
  }[kind];
  const frag = kind === 'halo'
    ? 'float d = length(vC); gl_FragColor = vec4(uColor, pow(max(0.0, 1.0 - d), 2.2) * vA);'
    : 'float d = length(vC); float ring = smoothstep(0.76, 0.87, d) * (1.0 - smoothstep(0.92, 1.0, d)); gl_FragColor = vec4(uColor, ring * vA);';
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMaxR: { value: 6 }, uPeriod: { value: 2.4 }, uColor: { value: rawRGB(hex) } },
    vertexShader: `uniform float uTime, uMaxR, uPeriod; attribute vec3 aCenter; attribute vec2 aCorner; attribute float aDelay; attribute float aOn;
      varying vec2 vC; varying float vA;
      void main(){ ${radius} vec4 mv = modelViewMatrix * vec4(aCenter, 1.0); mv.xy += aCorner * r; gl_Position = projectionMatrix * mv; vC = aCorner; }`,
    fragmentShader: `uniform vec3 uColor; varying vec2 vC; varying float vA; void main(){ ${frag} }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5;
  m.setOn = (i, v) => { const a = g.attributes.aOn; if (Math.abs(a.array[i * 4] - v) < 1e-3) return; for (let k = 0; k < 4; k++) a.array[i * 4 + k] = v; a.needsUpdate = true; };
  m.setDelay = (i, v) => { const a = g.attributes.aDelay; for (let k = 0; k < 4; k++) a.array[i * 4 + k] = v; a.needsUpdate = true; };
  return m;
}

/* ======================= HTML overlay ======================= */
const CSS = `
.s3d-wrap{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.s3d-wrap canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.s3d-wrap canvas:active{cursor:grabbing}
.s3d-ui{position:absolute;inset:0;pointer-events:none;font-variant-numeric:tabular-nums}
.s3d-ui svg{position:static!important;inset:auto!important}
.s3d-a{position:absolute;left:0;top:0;will-change:transform}
.s3d-dot{width:34px;height:34px;margin:-17px 0 0 -17px}
.s3d-ui .s3d-dot svg{width:34px!important;height:34px!important;display:block}
.s3d-ln{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 18px 10px;border-radius:18px;background:rgba(14,20,26,.8);
  border:4px solid var(--c,#009E73);color:#fff;white-space:nowrap;box-shadow:0 10px 26px rgba(0,0,0,.28)}
.s3d-ln.on{background:rgba(14,52,82,.9)}
.s3d-ln .ec{font-size:22px;font-weight:900;color:#fff;background:#D55E00;border:2px solid #fff;border-radius:99px;padding:2px 12px;margin:-2px 0 4px;white-space:nowrap}
.s3d-ln .pc{font-size:21px;font-weight:800;color:#13211b;background:#F0E442;border-radius:99px;padding:3px 12px;margin:-2px 0 4px;white-space:nowrap}
.s3d-ln .t{font-size:28px;font-weight:800;letter-spacing:.01em;display:flex;align-items:center;gap:8px}
.s3d-ln .v{font-size:54px;font-weight:800;line-height:.98;color:var(--t,#57D9AE);display:flex;align-items:center;gap:12px;letter-spacing:-.01em}
.s3d-ln .v i{font-style:normal;font-size:34px;font-weight:700;margin-left:-6px}
.s3d-ln .st{font-size:26px;font-weight:900;letter-spacing:.05em;padding:4px 10px;border-radius:10px;line-height:1.1}
.s3d-ln .st.over{background:#D55E00;color:#fff;border:3px solid #fff}
.s3d-ln .st.near{background:#E69F00;color:#1b1206}
.s3d-ln .st.ok{background:#009E73;color:#fff;font-size:22px}
.s3d-ln .m{display:flex;align-items:center;gap:8px;white-space:nowrap}
.s3d-ui .s3d-ln svg{width:40px!important;height:40px!important;display:block}
.s3d-ui .s3d-ln .t svg{width:30px!important;height:30px!important}
.s3d-sgk circle{fill:${SG};stroke:#fff;stroke-width:3}.s3d-sgk path{fill:none;stroke:#fff;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
.s3d-tp{font-size:24px;font-weight:800;color:#fff;padding:3px 10px;border-radius:9px;background:rgba(14,20,26,.66);white-space:nowrap}
.s3d-hud{position:absolute;right:30px;top:26px;width:300px;padding:8px 12px 6px;border-radius:16px;background:rgba(14,20,26,.55);color:#fff}
.s3d-ui .s3d-hud svg{display:block;width:276px!important;height:107px!important}
.s3d-hud em{position:absolute;left:14px;top:9px;font-style:normal;font-size:14px;font-weight:800;letter-spacing:.1em;border:2px solid #FFD98A;color:#FFD98A;border-radius:99px;padding:0 8px}
.s3d-scrim{position:absolute;inset:0;pointer-events:none;background:radial-gradient(1350px 560px at 0% 0%,rgba(10,18,28,.62),rgba(10,18,28,.25) 55%,transparent 80%)}
.s3d-scrim.light{background:radial-gradient(1350px 560px at 0% 0%,rgba(250,248,244,.80),rgba(250,248,244,.45) 55%,transparent 82%)}
`;
function div(cls, parent, html) { const e = document.createElement('div'); e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
/* status marks (colour + shape): ok = green disc with a tick, near = amber disc with "!", over = vermillion triangle with "!" */
const MARK = [
  '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#009E73" stroke="#fff" stroke-width="3"/><path d="M12 20.5l5.5 5.5L28.5 14" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#E69F00" stroke="#fff" stroke-width="3"/><rect x="17.6" y="9" width="4.8" height="14" rx="2.4" fill="#1b1206"/><circle cx="20" cy="29" r="2.9" fill="#1b1206"/></svg>',
  '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3.5L37.5 35H2.5Z" fill="#D55E00" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><rect x="17.7" y="13" width="4.6" height="12" rx="2.3" fill="#fff"/><circle cx="20" cy="30" r="2.7" fill="#fff"/></svg>'
];
const TICKSVG = (cls) => `<svg class="${cls}" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7.5 7.5L38 18"/></svg>`;

/* ======================= the Street3D instance ======================= */
export function createStreet3D(opts = {}) {
  if (opts.home) { const h = opts.home; if (h.yaw != null) HOME_VIEW.yaw = +h.yaw; if (h.pitch != null) HOME_VIEW.pitch = +h.pitch; if (h.dist != null) HOME_VIEW.dist = +h.dist; if (h.target) HOME_VIEW.target.set(...h.target); }
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const S = { sun: 0.15, vel: 0, goal: 0.15, to: 0.15, sweep: null, stage: 0, act: new Array(N).fill(0), pop: new Array(N).fill(-9), showAll: false,
    actA: HOMES.map(() => ({ from: 0, to: 0, t0: 0, dur: 0 })), tap: false, tapK: 0, tapVolts: TAP_STEP_V, tapA: { from: 0, to: 0, t0: 0, dur: 0 }, inv: new Array(N).fill(1), trip: new Array(N).fill(-1), over: new Array(N).fill(-1), pulseT: -9,
    active: false, raf: 0, lastT: 0, time: 0, flowPhase: 0, lastShadowSun: -1, built: false, failed: false, ready: false,
    lost: false, lostAt: 0, lostTimer: 0, errs: 0,
    quality: 0, cw: 1920, ch: 1080, lastSec: -1, dtLast: 0, hl: false, auto: opts.autoRotate !== false, userAt: -99, tween: null, swayBase: null, swayT0: 0 };
  const W = {}, U = { off: { value: new Array(N).fill(0) }, glint: { value: 0 }, time: { value: 0 }, sweep: { value: new THREE.Vector4(-99, -99, -99, -99) }, sweepDur: { value: 0.6 } };
  let root = null, wrap = null, ui = null, renderer = null, scene = null, camera = null, controls = null;
  const T = { dots: [], lines: {} };
  const keepOut = opts.keepOut || KEEP_OUT;
  const onFail = opts.onFail || (() => {});
  const boxedLine = (L) => (L === 'A' || L === 'B' ? S.stage >= 1 : L === 'D' ? S.stage >= 2 : false);
  const tgtOf = (i) => (boxedLine(lineOf(i)) ? 1 : 0);
  let last = computeVillage(S.sun, S.act, S.inv, S.tapK * S.tapVolts);

  function build(el) {
    root = el;
    if (!document.getElementById('s3d-css')) { const st = document.createElement('style'); st.id = 's3d-css'; st.textContent = CSS; document.head.appendChild(st); }
    if (THREE.setConsoleFunction) THREE.setConsoleFunction((type, msg, ...rest) => {
      if (type === 'warn' && /Program Info Log/.test(String(msg)) && !/error/i.test(rest.join(' '))) return;   /* ANGLE compiler notes */
      (console[type] || console.log)(msg, ...rest);
    });
    wrap = div('s3d-wrap', null);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    renderer.debug.onShaderError = () => fail('shader compile error');
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
    renderer.domElement.style.pointerEvents = 'none';
    wrap.appendChild(renderer.domElement);
    if (opts.scrim) div('s3d-scrim' + (opts.scrim === 'dark' ? '' : ' light'), wrap);
    ui = div('s3d-ui', wrap);
    root.appendChild(wrap);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, 16 / 9, 1, 16000);
    scene.fog = new THREE.Fog(0xcdd5dc, 200, 5200);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reduced; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.minDistance = 55; controls.maxDistance = 260; controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.8;
    controls.minPolarAngle = THREE.MathUtils.degToRad(12); controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
    controls.target.copy(HOME_VIEW.target);
    controls.addEventListener('start', () => { S.userAt = S.time; S.tween = null; S.swayBase = null; });
    controls.addEventListener('end', () => { S.userAt = S.time; });
    setCam(HOME_VIEW.yaw, HOME_VIEW.pitch, HOME_VIEW.dist);

    const TX = makeTextures();
    const mat = {
      tuff: new THREE.MeshStandardMaterial({ map: TX.tuff, vertexColors: true, roughness: 0.95 }),
      plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ map: TX.metal, vertexColors: true, roughness: 0.55, metalness: 0.25 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.25, metalness: 0.3, emissive: 0xffc27a, emissiveIntensity: 0 }),
      panel: new THREE.MeshStandardMaterial({ map: TX.panel, roughness: 0.3, metalness: 0.45 }),
      road: new THREE.MeshStandardMaterial({ map: TX.asphalt, vertexColors: true, roughness: 0.95 }),
      ground: new THREE.MeshStandardMaterial({ map: TX.ground, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x5e554c, roughness: 1 }),
      mountain: new THREE.MeshLambertMaterial({ color: 0xaab1b8 }),
      ao: new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: TX.ao, transparent: true, opacity: 0.32, depthWrite: false }),
      box: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, emissive: SG, emissiveIntensity: 0 })
    };
    W.mat = mat;
    TX.asphalt.repeat.set(1 / 6, 1 / 6); TX.ground.repeat.set(1 / 14, 1 / 14);

    W.sky = new Sky(); W.sky.scale.setScalar(14000); scene.add(W.sky);
    W.skyTint = { value: new THREE.Vector3(1, 1, 1) };
    W.sky.material.onBeforeCompile = (sh) => { sh.uniforms.uSkyTint = W.skyTint; sh.fragmentShader = 'uniform vec3 uSkyTint;' + String.fromCharCode(10) + sh.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyTint, 1.0 );'); };
    const su = W.sky.material.uniforms; su.showSunDisc.value = 0; su.cloudCoverage.value = 0; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
    W.hemi = new THREE.HemisphereLight(0xdfe7ef, 0xa59985, 1.5); scene.add(W.hemi);
    W.sun = new THREE.DirectionalLight(0xffffff, 3); W.sun.castShadow = true;
    const sc = W.sun.shadow.camera; sc.left = -100; sc.right = 100; sc.top = 85; sc.bottom = -85; sc.near = 1; sc.far = 700;
    W.sun.shadow.mapSize.set(2048, 2048); W.sun.shadow.bias = -0.0005; W.sun.shadow.normalBias = 0.06; W.sun.shadow.radius = 4;
    W.sun.target.position.set(-3, 0, 4); scene.add(W.sun); scene.add(W.sun.target);

    const gG = new THREE.PlaneGeometry(9000, 9000); gG.rotateX(-Math.PI / 2);
    { const uv = gG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 9000, uv.getY(i) * 9000); }
    const ground = new THREE.Mesh(gG, mat.ground); ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    const roadB = new Bucket();
    roadB.add(place(wbox(300, 0.04, 7, 1), -10, 0, 0), '#ffffff');
    roadB.add(place(wbox(6, 0.04, 220, 1), 0, 0.006, -10), '#ffffff');
    roadB.add(place(wbox(4, 0.04, 44, 1), 40.5, 0.004, 24.5), '#c9bba3');            /* gravel lane of the A branch */
    W.road = roadB.mesh(mat.road, { cast: false }); scene.add(W.road);

    const tuffB = new Bucket(), plainB = new Bucket(), metalB = new Bucket(), glassB = new Bucket(), aoB = new Bucket(), leafB = new Bucket(), panels = [];
    W.boxPos = []; W.roofTop = []; W.drops = []; W.barBase = [];
    const panelLine = [], panelHome = [];
    HOMES.forEach((h, i) => { const n0 = panels.length; buildHome(h, i, tuffB, plainB, metalB, glassB, aoB, leafB, panels); for (let k = n0; k < panels.length; k++) { panelLine.push(LINES.indexOf(lineOf(i))); panelHome.push(i); } });
    buildGround();
    buildNetwork(plainB);
    W.tuff = tuffB.mesh(mat.tuff); scene.add(W.tuff);
    W.plain = plainB.mesh(mat.plain); scene.add(W.plain);
    W.metal = metalB.mesh(mat.metal); scene.add(W.metal);
    scene.add(glassB.mesh(mat.glass, { cast: false }));
    const leaf = leafB.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })); scene.add(leaf);
    const aoMesh = aoB.mesh(mat.ao, { cast: false, receive: false }); aoMesh.renderOrder = 1; scene.add(aoMesh);

    const pGeo = new THREE.BoxGeometry(1.02, 0.05, 1.68); pGeo.setAttribute('aLine', new THREE.InstancedBufferAttribute(new Float32Array(panelLine), 1)); pGeo.setAttribute('aHome', new THREE.InstancedBufferAttribute(new Float32Array(panelHome), 1));
    W.panels = new THREE.InstancedMesh(pGeo, mat.panel, panels.length);
    panels.forEach((m, i) => W.panels.setMatrixAt(i, m));
    W.panels.castShadow = true; W.panels.receiveShadow = true; scene.add(W.panels);
    mat.panel.onBeforeCompile = (sh) => {
      sh.uniforms.uGlint = U.glint; sh.uniforms.uTime = U.time; sh.uniforms.uSweep = U.sweep; sh.uniforms.uSweepDur = U.sweepDur; sh.uniforms.uOff = U.off;
      sh.vertexShader = 'attribute float aLine; attribute float aHome; varying float vLine; varying float vHome; varying vec3 vGW;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvLine = aLine; vHome = aHome;\nvec4 gw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ngw = instanceMatrix * gw;\n#endif\nvGW = (modelMatrix * gw).xyz;');
      sh.fragmentShader = 'uniform float uGlint; uniform float uTime; uniform vec4 uSweep; uniform float uSweepDur; uniform float uOff[' + N + ']; varying float vLine; varying float vHome; varying vec3 vGW;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nfloat offK = uOff[int(vHome + 0.5)];\ndiffuseColor.rgb *= mix(1.0, 0.22, offK);').replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\nfloat gb = sin(vGW.x * 0.22 + vGW.z * 0.12 - uTime * 1.1);\ntotalEmissiveRadiance += vec3(1.0, 0.96, 0.88) * smoothstep(0.975, 1.0, gb) * uGlint;\n' +
        'float st = vLine < 0.5 ? uSweep.x : (vLine < 1.5 ? uSweep.y : (vLine < 2.5 ? uSweep.z : uSweep.w));\n' +
        'float ag = (uTime - st) / uSweepDur;\n' +
        'if (ag > 0.0 && ag < 1.0) { float dd = (vMapUv.x + vMapUv.y) * 0.5; float band = 1.0 - smoothstep(0.0, 0.2, abs(dd - (ag * 1.5 - 0.25)));\n' +
        '  totalEmissiveRadiance += vec3(1.0, 0.97, 0.86) * band * 2.2 * (1.0 - 0.6 * ag); }\n' +
        'totalEmissiveRadiance *= (1.0 - offK);');
    };

    const boxGeo = mergeGeometries([stripTo(new THREE.BoxGeometry(0.7, 0.9, 0.26)), stripTo(place(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), 0.25, 0.75, 0))]);
    W.boxes = new THREE.InstancedMesh(boxGeo, mat.box, N);
    for (let i = 0; i < N; i++) { W.boxes.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); W.boxes.setColorAt(i, new THREE.Color('#9aa3a8')); }
    scene.add(W.boxes);

    buildTrees();
    buildMountains();
    buildWires();
    buildRadio();
    {                                                                       /* sun disc + soft glow (one sprite) */
      const tx = canvasTex(256, 256, (x, w, h) => {
        const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.16, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,240,210,.55)');
        g.addColorStop(0.45, 'rgba(255,220,170,.18)'); g.addColorStop(1, 'rgba(255,210,160,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
      }, { repeat: false });
      W.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
      W.sunDisc.scale.setScalar(12000 * Math.tan(THREE.MathUtils.degToRad(7)));
      W.sunDisc.renderOrder = -1; scene.add(W.sunDisc);
    }
    buildOverlay();
    S.built = true;
    resize();
  }

  /* ---------------- homes ---------------- */
  function buildHome(h, i, tuffB, plainB, metalB, glassB, aoB, leafB, panels) {
    const tone = TONES[h.tone], top = h.fl === 2 ? 6.2 : 3.4;
    tuffB.add(place(wbox(h.w, top, h.d, TUFF_TILE), h.x, top / 2, h.z), tone);
    plainB.add(place(new THREE.BoxGeometry(h.w + 0.2, 0.45, h.d + 0.2), h.x, 0.22, h.z), '#77716b');
    if (h.fl === 2) plainB.add(place(new THREE.BoxGeometry(h.w + 0.12, 0.16, h.d + 0.12), h.x, 3.15, h.z), '#d4cabd');
    aoB.add(place(new THREE.PlaneGeometry(h.w + 4, h.d + 4).rotateX(-Math.PI / 2), h.x, 0.03, h.z), '#000000');
    let roofTop;
    if (h.roof === 'flat') {
      plainB.add(place(new THREE.BoxGeometry(h.w + 0.1, 0.22, h.d + 0.1), h.x, top + 0.11, h.z), '#8f8a83');
      for (const [dx, dz, ww, dd] of [[0, h.d / 2, h.w + 0.1, 0.3], [0, -h.d / 2, h.w + 0.1, 0.3], [-h.w / 2, 0, 0.3, h.d], [h.w / 2, 0, 0.3, h.d]])
        tuffB.add(place(wbox(ww, 0.7, dd, TUFF_TILE), h.x + dx, top + 0.35, h.z + dz), tone, 0.94);
      const a = THREE.MathUtils.degToRad(25), cols = Math.floor((h.w - 1.6) / 1.06), sx = h.x - (cols - 1) * 1.06 / 2;
      for (let r = 0; r < 2; r++) {
        const zr = h.z + h.d / 2 - 2.0 - r * 3.3;
        for (let c = 0; c < cols; c++) { E.set(-a, 0, 0); Q.setFromEuler(E); panels.push(new THREE.Matrix4().compose(new THREE.Vector3(sx + c * 1.06, top + 0.95, zr), Q.clone(), S3.clone())); }
        plainB.add(place(new THREE.BoxGeometry(cols * 1.06, 0.08, 0.08), h.x, top + 0.45, zr + 0.72), '#a7aaad');
        plainB.add(place(new THREE.BoxGeometry(cols * 1.06, 0.08, 0.08), h.x, top + 1.35, zr - 0.72), '#a7aaad');
      }
      roofTop = top + 1.9;
    } else {
      /* low-pitched corrugated metal roof, ridge east–west; PV on the south slope */
      const a = THREE.MathUtils.degToRad(17), o = 0.45, hd = h.d / 2 + o, rise = h.d / 2 * Math.tan(a), L = hd / Math.cos(a);
      const yE = top - o * Math.tan(a), yR = top + rise, zS = h.z + h.d / 2 + o, mc = h.metal === 'rust' ? '#9a5a45' : '#8d9195';
      metalB.add(place(wbox(h.w + 0.8, 0.12, L, 2), h.x, (yE + yR) / 2 + 0.06, (zS + h.z) / 2, -a), mc);
      metalB.add(place(wbox(h.w + 0.8, 0.12, L, 2), h.x, (yE + yR) / 2 + 0.06, (h.z - h.d / 2 - o + h.z) / 2, a), mc, 0.88);
      const gL = gableGeo(h.d, rise, TUFF_TILE); place(gL, h.x - h.w / 2, top, h.z, 0, Math.PI, 0); tuffB.add(gL, tone);
      const gR = gableGeo(h.d, rise, TUFF_TILE); place(gR, h.x + h.w / 2, top, h.z); tuffB.add(gR, tone);
      const cols = Math.floor((h.w - 1.2) / 1.06), rows = Math.min(2, Math.floor((L - 0.6) / 1.72)), sx = h.x - (cols - 1) * 1.06 / 2;
      const up = new THREE.Vector3(0, Math.sin(a), -Math.cos(a)), nrm = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const p = new THREE.Vector3(sx + c * 1.06, yE, zS).addScaledVector(up, 0.4 + r * 1.72 + 0.84).addScaledVector(nrm, 0.16);
        E.set(-a, 0, 0); Q.setFromEuler(E); panels.push(new THREE.Matrix4().compose(p, Q.clone(), S3.clone()));
      }
      roofTop = yR + 0.2;
    }
    /* windows (dark frames; some arched) on the street face and the south face; a door on the street face */
    const faces = h.face === 'S' ? ['S'] : [h.face, 'S'];
    for (const F of faces) {
      const len = faceLen(h, F), n = len > 9.6 ? 3 : 2;
      for (let fl = 0; fl < h.fl; fl++) for (let k = 0; k < n; k++) {
        const u = -len / 2 + (k + 0.5) * len / n;
        if (F === h.face && fl === 0 && k === n - 1) { addDoor(plainB, h, F, u, h.arch || i % 4 === 2); continue; }
        addWindow(plainB, glassB, h, F, u, 1.0 + fl * 2.9, h.arch);
      }
    }
    if (h.fl === 2) addBalcony(plainB, h, h.face);
    /* inverter on the south wall; the SunGuard box beside it */
    const [ix, iz] = facePt(h, 'S', h.w / 2 - 1.1, 0.13);
    plainB.add(place(new THREE.BoxGeometry(0.62, 0.8, 0.22), ix, 1.9, iz), '#eef0ee');
    const [bx, bz] = facePt(h, 'S', h.w / 2 - 2.1, 0.15);
    W.boxPos.push(new THREE.Vector3(bx, 1.9, bz));
    W.roofTop.push(new THREE.Vector3(h.x, roofTop, h.z));
    W.barBase.push(new THREE.Vector3(h.x, roofTop + 1.2, h.z));
    /* service drop to the street face, under the eave */
    const [dx, dz] = facePt(h, h.face, 0, 0.05);
    W.drops.push([new THREE.Vector3(NODES[h.node][1], WIRE_Y - 0.4, NODES[h.node][2]), new THREE.Vector3(dx, Math.min(top - 0.35, 5.6), dz)]);
    /* courtyard: tuff walls from the street face to a front wall with a metal gate */
    const yard = 4.2, F = FACES[h.face], half = faceHalf(h, h.face), len = faceLen(h, h.face) + 3;
    const fx = h.x + F.n[0] * (half + yard), fz = h.z + F.n[1] * (half + yard);
    const gw = 3.2, seg = (len - gw) / 2, wallT = '#bfb3a5';
    for (const sgn of [-1, 1]) {
      const cx = fx + F.t[0] * sgn * (gw / 2 + seg / 2), cz = fz + F.t[1] * sgn * (gw / 2 + seg / 2);
      tuffB.add(place(wbox(seg, 1.7, 0.36, TUFF_TILE), cx, 0.85, cz, 0, F.ry, 0), wallT, 0.95);
      const sx = fx + F.t[0] * sgn * len / 2 - F.n[0] * yard / 2, sz = fz + F.t[1] * sgn * len / 2 - F.n[1] * yard / 2;
      tuffB.add(place(wbox(0.36, 1.7, yard, TUFF_TILE), sx, 0.85, sz, 0, F.ry, 0), wallT, 0.95);
    }
    plainB.add(place(new THREE.BoxGeometry(gw, 1.9, 0.07), fx, 0.95, fz, 0, F.ry, 0), i % 3 === 0 ? '#4a5650' : (i % 3 === 1 ? '#5c4a3e' : '#3e4348'));
    plainB.add(place(new THREE.BoxGeometry(gw + 1.1, 0.04, yard + 0.2), (fx + h.x + F.n[0] * half) / 2, 0.03, (fz + h.z + F.n[1] * half) / 2, 0, F.ry, 0), '#b9b0a3');
    /* a grape trellis in two yards */
    if (i === 1 || i === 9) {
      const tx = (fx + h.x + F.n[0] * half) / 2 + F.t[0] * -2.2, tz = (fz + h.z + F.n[1] * half) / 2 + F.t[1] * -2.2;
      for (const [ox, oz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) plainB.add(place(new THREE.CylinderGeometry(0.06, 0.06, 2.3, 5), tx + ox, 1.15, tz + oz), '#5e554c');
      leafB.add(place(new THREE.BoxGeometry(3.8, 0.3, 3.0), tx, 2.4, tz), '#7d8a69');
    }
  }
  function addWindow(plainB, glassB, h, F, u, yb, arch) {
    const ww = 1.1, wh = 1.4, f = FACES[F];
    const [x0, z0] = facePt(h, F, u, 0.04), [x1, z1] = facePt(h, F, u, 0.09);
    plainB.add(place(new THREE.BoxGeometry(ww + 0.26, wh + 0.26, 0.08), x0, yb + wh / 2, z0, 0, f.ry, 0), '#3d3731');
    glassB.add(place(new THREE.PlaneGeometry(ww, wh), x1, yb + wh / 2, z1, 0, f.ry, 0), '#ffffff');
    if (arch) {
      plainB.add(place(new THREE.CircleGeometry(ww / 2 + 0.13, 10, 0, Math.PI), x0, yb + wh + 0.0, z0, 0, f.ry, 0), '#3d3731');
      glassB.add(place(new THREE.CircleGeometry(ww / 2, 10, 0, Math.PI), x1, yb + wh, z1, 0, f.ry, 0), '#ffffff');
    }
  }
  function addDoor(plainB, h, F, u, arch) {
    const f = FACES[F], [x, z] = facePt(h, F, u, 0.05), [x0, z0] = facePt(h, F, u, 0.03);
    if (!arch) { plainB.add(place(new THREE.BoxGeometry(1.2, 2.2, 0.1), x, 1.5, z, 0, f.ry, 0), '#4f463e'); return; }
    /* arched doorway: dark stone surround + wooden leaf with a round head */
    plainB.add(place(new THREE.BoxGeometry(1.7, 2.0, 0.08), x0, 1.4, z0, 0, f.ry, 0), '#3d3731');
    plainB.add(place(new THREE.CircleGeometry(0.85, 12, 0, Math.PI), x0, 2.4, z0, 0, f.ry, 0), '#3d3731');
    plainB.add(place(new THREE.BoxGeometry(1.3, 1.85, 0.1), x, 1.38, z, 0, f.ry, 0), '#5a4636');
    plainB.add(place(new THREE.CircleGeometry(0.65, 12, 0, Math.PI), x, 2.3, z + 0.0, 0, f.ry, 0), '#5a4636');
  }
  /* balcony on the street face of a two-storey house: slab + thin metal railing */
  function addBalcony(plainB, h, F) {
    const f = FACES[F], bw = 3.2, dp = 1.1, y = 3.05;
    const at = (u, off, yy, g, hex) => { const [x, z] = facePt(h, F, u, off); plainB.add(place(g, x, yy, z, 0, f.ry, 0), hex); };
    at(0, dp / 2, y, new THREE.BoxGeometry(bw, 0.14, dp), '#9d968d');
    at(0, dp - 0.04, y + 0.95, new THREE.BoxGeometry(bw, 0.06, 0.06), '#34312d');
    for (const su of [-1, 1]) at(su * (bw / 2 - 0.03), dp / 2, y + 0.95, new THREE.BoxGeometry(0.06, 0.06, dp), '#34312d');
    for (let k = 0; k <= 10; k++) at(-bw / 2 + 0.05 + k * (bw - 0.1) / 10, dp - 0.04, y + 0.5, new THREE.BoxGeometry(0.035, 0.9, 0.035), '#34312d');
  }

  /* ---------------- ground: road shoulders, gardens behind the homes, dirt paths, fields (flat, muted, one draw call) ---------------- */
  function buildGround() {
    const gB = new Bucket(), r = rng(31);
    const patch = (cx, cz, w, d, hex, y = 0.012, ry = 0) => gB.add(place(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), cx, y, cz, 0, ry, 0), hex);
    for (const sgn of [-1, 1]) { patch(-10, sgn * 4.6, 300, 2.2, '#9a8f78'); patch(sgn * 4.1, -10, 2.2, 220, '#9a8f78'); }
    patch(40.5 + 2.9, 24.5, 1.8, 44, '#a39880'); patch(40.5 - 2.9, 24.5, 1.8, 44, '#a39880');
    const greens = ['#8f9a72', '#97a079', '#88936c', '#9da37e'];
    HOMES.forEach((h, i) => {                      /* kitchen garden behind each house, with a few darker rows */
      const F = FACES[h.face], half = faceHalf(h, h.face), gw = faceLen(h, h.face) + 2, gd = 7;
      const cx = h.x - F.n[0] * (half + gd / 2 + 0.6), cz = h.z - F.n[1] * (half + gd / 2 + 0.6);
      patch(cx, cz, gw, gd, greens[i % 4], 0.012, F.ry);
      for (let k = 0; k < 4; k++) {
        const off = -gd / 2 + 1.0 + k * 1.6;
        patch(cx - F.n[0] * off, cz - F.n[1] * off, gw - 1.2, 0.45, '#7a8562', 0.016, F.ry);
      }
    });
    for (const [x0, z0, x1, z1] of [[-30, 4.6, -44, 40], [24, -4.6, 34, -48], [-56, -4.6, -70, -46], [62, 4.6, 80, 44], [4.6, 52, 30, 70]]) {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
      patch((x0 + x1) / 2, (z0 + z1) / 2, 1.8, len, '#b4a587', 0.014, ang);
    }
    const tones = ['#a8a382', '#9ea17c', '#b3a888', '#a49f80', '#97a079'];
    for (let k = 0; k < 70; k++) {                   /* fields around the block, fading into the haze */
      const a = r() * Math.PI * 2, d = 95 + r() * 360, w = 30 + r() * 60, dd = 25 + r() * 50;
      patch(Math.sin(a) * d, -Math.cos(a) * d, w, dd, tones[k % 5], 0.006 + (k % 3) * 0.002, r() * 0.5);
    }
    const m = gB.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { cast: false });
    scene.add(m);
  }

  /* ---------------- transformer, poles, cables ---------------- */
  function buildNetwork(plainB) {
    const pole = (x, z, hgt = POLE_H) => plainB.add(place(new THREE.CylinderGeometry(0.13, 0.2, hgt, 8), x, hgt / 2, z), '#b7b2aa');
    for (const n of NODE_KEYS) { pole(NODES[n][1], NODES[n][2]); plainB.add(place(new THREE.BoxGeometry(0.9, 0.15, 0.15), NODES[n][1], WIRE_Y + 0.12, NODES[n][2]), '#6c6763'); }
    /* pole-mounted 10/0.4 kV transformer (two poles + platform) */
    pole(TPX - 1.8, TPZ - 1.2, 10.4); pole(TPX + 1.8, TPZ - 1.2, 10.4);
    plainB.add(place(new THREE.BoxGeometry(4.4, 0.22, 1.5), TPX, 3.6, TPZ - 1.2), '#7b7d80');
    plainB.add(place(new THREE.BoxGeometry(1.8, 1.8, 1.2), TPX, 4.6, TPZ - 1.2), '#9da29d');
    for (let k = -3; k <= 3; k++) plainB.add(place(new THREE.BoxGeometry(0.08, 1.3, 1.4), TPX + k * 0.25, 4.55, TPZ - 1.2), '#8b918c');
    plainB.add(place(new THREE.BoxGeometry(4.6, 0.18, 0.18), TPX, 9.9, TPZ - 1.2), '#66625e');
    plainB.add(place(new THREE.BoxGeometry(1.2, 1.4, 0.6), TPX, 1.4, TPZ - 0.9), '#b5b9b6');
    W.mv = [];
    const mvP = [[TPX, TPZ - 1.2, 9.9], [TPX + 22, -46, 10.6], [TPX + 44, -86, 10.6], [TPX + 66, -126, 10.6]];
    for (let k = 1; k < mvP.length; k++) { pole(mvP[k][0], mvP[k][1], 11.4); plainB.add(place(new THREE.BoxGeometry(3.6, 0.16, 0.16), mvP[k][0], 10.6, mvP[k][1], 0, -0.5, 0), '#66625e'); }
    for (let k = 1; k < mvP.length; k++) for (const dx of [-1.5, 0, 1.5]) W.mv.push([new THREE.Vector3(mvP[k - 1][0] + dx, mvP[k - 1][2] + 0.1, mvP[k - 1][1]), new THREE.Vector3(mvP[k][0] + dx, mvP[k][2] + 0.1, mvP[k][1]), 0.8]);
    W.mv.push([new THREE.Vector3(TPX, 5.6, TPZ - 1.2), new THREE.Vector3(TPX, WIRE_Y, TPZ), 0.05]);
    W.tpAnchor = new THREE.Vector3(TPX + 3.2, 3.6, TPZ - 1.2);
  }
  function buildWires() {
    const darkB = new Bucket();
    for (const [p, q, sag] of W.mv) darkB.add(new THREE.TubeGeometry(new SagCurve(p, q, sag), 20, 0.05, 5), '#2a2c2e');
    for (const [p, q] of W.drops) darkB.add(new THREE.TubeGeometry(new SagCurve(p, q, 0.35), 10, 0.045, 5), '#2a2c2e');
    scene.add(darkB.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), { receive: false }));
    /* the 0.4 kV feeders: one merged tube set, coloured per span by the voltage at its far pole */
    const core = [], glow = [];
    NODE_KEYS.forEach((n, si) => {
      const p = NODES[NODES[n][0]], a = new THREE.Vector3(p[1], WIRE_Y, p[2]), b = new THREE.Vector3(NODES[n][1], WIRE_Y, NODES[n][2]);
      const curve = new SagCurve(a, b, 0.45), len = a.distanceTo(b);
      for (const [list, r, rs] of [[core, 0.13, 6], [glow, 0.5, 8]]) {
        const g = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len / 1.2)), r, rs);
        g.setAttribute('aSeg', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(si), 1));
        g.setAttribute('aLen', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(len), 1));
        list.push(stripTo(g, ['position', 'normal', 'uv', 'aSeg', 'aLen']));
      }
    });
    W.wireCore = new THREE.Mesh(mergeGeometries(core), wireMaterial(false)); scene.add(W.wireCore);
    W.wireGlow = new THREE.Mesh(mergeGeometries(glow), wireMaterial(true)); W.wireGlow.renderOrder = 4; scene.add(W.wireGlow);
    W.segLvl = new Array(NODE_KEYS.length).fill(-1);
  }

  /* ---------------- SunGuard radio ---------------- */
  function buildRadio() {           /* a soft, steady glow around each SunGuard box (no radio rings: it talks over home Wi-Fi) */
    const c = W.boxPos.map((p) => p.clone().add(new THREE.Vector3(0, 0, 0.3)));
    W.halo = quadField(c, c.map((_, i) => i), 'halo', SG); W.halo.material.uniforms.uMaxR.value = 2.4; scene.add(W.halo);
  }

  function buildTrees() {
    const crown = mergeVertices(new THREE.IcosahedronGeometry(1, 2));
    { const p = crown.attributes.position, r3 = rng(5);
      for (let i = 0; i < p.count; i++) { V3.fromBufferAttribute(p, i); const n = 1 + Math.sin(V3.x * 5.1 + 1.3) * Math.sin(V3.y * 4.3) * Math.sin(V3.z * 5.7 + 2) * 0.12 + (r3() - 0.5) * 0.08; p.setXYZ(i, V3.x * n, V3.y * n, V3.z * n); }
      crown.computeVertexNormals(); }
    const trunk = new THREE.CylinderGeometry(0.14, 0.24, 1, 6); trunk.translate(0, 0.5, 0);
    /* apricot (smaller) and walnut (bigger) trees in back gardens and along the lanes */
    const spots = [[25, -28, 1.0], [40, -27, 1.25], [55, -29, 0.95], [70, -26, 1.2], [-28, -29, 1.1], [-44, -27, 1.3], [-60, -28, 1.0],
      [-45, 27, 1.2], [-60, 28, 1.0], [24, 37, 1.1], [56, 22, 1.0], [-36, 46, 1.2], [64, 47, 1.0], [-22, 34, 1.15], [-24, -40, 1.25], [26, -42, 1.1]];
    W.crowns = new THREE.InstancedMesh(crown, W.mat.leaf, spots.length * 2); W.trunks = new THREE.InstancedMesh(trunk, W.mat.bark, spots.length);
    const m = new THREE.Matrix4(), col = new THREE.Color(), r4 = rng(17), greens = ['#7f8b6f', '#76836a', '#86917a'];
    let ci = 0;
    spots.forEach(([x, z, s], k) => {
      const th = 2.2 * s; m.compose(V3.set(x, 0, z), Q.identity(), new THREE.Vector3(s, th, s)); W.trunks.setMatrixAt(k, m);
      for (const [dx, dy, rr] of [[0, th + 2.0 * s, 2.7 * s], [1.2 * s, th + 1.3 * s, 1.8 * s]]) {
        E.set(r4() * 3, r4() * 3, 0); Q.setFromEuler(E);
        m.compose(V3.set(x + dx, dy, z + (r4() - 0.5)), Q, new THREE.Vector3(rr, rr * 0.82, rr)); W.crowns.setMatrixAt(ci, m);
        W.crowns.setColorAt(ci++, col.set(greens[(r4() * 3) | 0]));
      }
    });
    Q.identity();
    W.crowns.castShadow = W.trunks.castShadow = true; W.crowns.receiveShadow = true;
    scene.add(W.crowns); scene.add(W.trunks);
  }
  function buildMountains() {           /* a low hill ring and a soft distant mountain ring; fog makes them hazy */
    const ring = (R0, R1, base, amp, seed, hex, gaps) => {
      const r5 = rng(seed), ph = [r5() * 6, r5() * 6, r5() * 6], nx = 240, rows = 4, pos = [], idx = [];
      const hgt = (a) => { let v = base + amp * (0.6 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 7 + ph[1]) + 0.1 * Math.sin(a * 17 + ph[2])); if (gaps) v *= smooth(-0.2, 0.4, Math.sin(a * 2 + ph[1])); return Math.max(0, v); };
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= nx; i++) {
        const a = i / nx * Math.PI * 2, t = j / rows, R = lerp(R0, R1, t), y = -10 + (hgt(a) + 10) * Math.sin(t * Math.PI / 2);
        pos.push(Math.sin(a) * R, y, -Math.cos(a) * R);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide })));
    };
    buildArarat();
    ring(520, 760, 18, 10, 3, 0xa3a48d, false);         /* continuous low hills (no gaps: a gap showed the white horizon) */
    ring(3200, 4100, 95, 60, 7, 0xa4acb6, false);
  }

  /* Mount Ararat on the horizon: broad snow-capped Masis and the sharper Sis to its left, hazy, world-fixed */
  function buildArarat() {
    const yaw = THREE.MathUtils.degToRad(HOME_VIEW.yaw), p = THREE.MathUtils.degToRad(HOME_VIEW.pitch);
    const cam = HOME_VIEW.target.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw) * Math.cos(p), -Math.sin(p), -Math.cos(yaw) * Math.cos(p)), -HOME_VIEW.dist);
    const at = (bearDeg, d) => { const b = yaw + THREE.MathUtils.degToRad(bearDeg); return new THREE.Vector2(cam.x + Math.sin(b) * d, cam.z - Math.cos(b) * d); };
    const M = at(ARARAT.masis.bear, ARARAT.dist), Sx = at(ARARAT.sis.bear, ARARAT.sis.dist);
    const r6 = rng(41);
    const ux = Sx.x - M.x, uz = Sx.y - M.y, ul = Math.hypot(ux, uz);
    /* Masis: broad dome, long gentle flank towards Sis (the saddle side), steeper on the far side */
    const masis = (x, z) => { const dx = x - M.x, dz = z - M.y, side = 0.92 + 0.43 * smooth(-0.35, 0.35, (dx * ux + dz * uz) / (ul * (Math.hypot(dx, dz) + 1e-6))), t = Math.hypot(dx, dz) / (ARARAT.masis.r * side); if (t >= 1.6) return 0;
      const a = Math.atan2(dz, dx), base = Math.pow(Math.max(0, 1 - Math.pow(Math.min(t, 1), 1.6)), 2.2) + (t > 1 ? 0 : 0) + Math.max(0, 0.06 * (1.6 - t));
      return ARARAT.masis.h * base * (1 + 0.025 * Math.sin(a * 9 + 1.3) * t + 0.015 * Math.sin(a * 23) * t); };
    const sis = (x, z) => { const dx = x - Sx.x, dz = z - Sx.y, t = Math.hypot(dx, dz) / ARARAT.sis.r; if (t >= 1.5) return 0;
      const a = Math.atan2(dz, dx); return ARARAT.sis.h * (Math.pow(Math.max(0, 1 - Math.min(t, 1)), 1.25) + Math.max(0, 0.05 * (1.5 - t))) * (1 + 0.05 * Math.sin(a * 7 + 0.4) * t); };
    const saddle = (x, z) => { const sx = ((x - M.x) * ux + (z - M.y) * uz) / (ul * ul); if (sx < 0 || sx > 1) return 0; const q = Math.abs((x - M.x) * uz - (z - M.y) * ux) / ul;
      return ARARAT.masis.h * 0.3 * Math.sin(Math.PI * (0.15 + 0.7 * sx)) * Math.exp(-Math.pow(q / 650, 2)); };
    const cx = (M.x + Sx.x) / 2, cz = (M.y + Sx.y) / 2, half = ARARAT.masis.r * 1.8 + Math.hypot(M.x - Sx.x, M.y - Sx.y) / 2, nx = 150, nz = 90;
    const pos = [], col = [], idx = [], snow = new THREE.Color('#f3f5f8'), rock = new THREE.Color('#8f97a2'), haze = new THREE.Color('#bcc6d2'), c = new THREE.Color();
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = cx - half + 2 * half * i / nx, z = cz - half * 0.9 + 1.8 * half * 0.9 * j / nz;
      const hm = masis(x, z), hs = sis(x, z), h = Math.max(hm, hs, saddle(x, z));
      const isM = hm >= hs, rel = isM ? hm / ARARAT.masis.h : hs / ARARAT.sis.h;
      const line = (isM ? 0.5 : 0.72) + (r6() - 0.5) * 0.08 + 0.05 * Math.sin(x * 0.004);
      c.copy(rock).lerp(haze, 0.35); if (rel > line) c.copy(snow).lerp(haze, 0.12 * (1 - rel)); else if (rel > line - 0.06) c.copy(snow).lerp(rock, 0.5);
      pos.push(x, h - 20, z); col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    W.ararat = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    W.ararat.frustumCulled = false; scene.add(W.ararat);
  }

  function buildOverlay() {
    HOMES.forEach(() => { const el = div('s3d-a s3d-dot', ui); T.dots.push({ el, lvl: -1, vis: -1 }); });
    for (const L of LINES) {
      const el = div('s3d-a s3d-ln', ui);
      el.innerHTML = '<div class="ec" style="display:none">⚠ emergency shutdown · panels off</div><div class="pc" style="display:none">☀ panels working · no emergency shutdown</div><div class="t"></div><div class="v"><span class="n"></span><span class="m"></span></div>';
      T.lines[L] = { el, ec: el.querySelector('.ec'), chip: el.querySelector('.pc'), t: el.querySelector('.t'), n: el.querySelector('.n'), m: el.querySelector('.m'), key: '', w: 0, h: 0, vis: -1 };
    }
    T.tp = { el: div('s3d-a s3d-tp', ui), w: 0, h: 0, vis: -1 }; T.tp.el.textContent = 'transformer';
    /* sun dial (time of day), top-right */
    T.hud = div('s3d-hud', ui, `<svg viewBox="0 0 388 150" aria-hidden="true">
      <path d="M18 132 Q 120 18 370 22" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-dasharray="2 10" stroke-linecap="round"/>
      <line x1="10" y1="134" x2="378" y2="134" stroke="rgba(255,255,255,.45)" stroke-width="3"/>
      <text x="14" y="122" font-size="20" font-weight="700" fill="rgba(255,255,255,.85)" font-family="inherit">6:00</text>
      <text x="342" y="18" font-size="20" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="end" font-family="inherit">13:00</text>
      <circle class="sg" r="30" fill="url(#s3dSunG)"/><circle class="sd" r="19" fill="#FFC21F" stroke="#fff" stroke-width="3"/>
      <text class="ck" font-size="34" font-weight="800" fill="#fff" font-family="inherit">6:00</text>
      <defs><radialGradient id="s3dSunG"><stop offset="0" stop-color="#FFD25A" stop-opacity=".9"/><stop offset="1" stop-color="#FFD25A" stop-opacity="0"/></radialGradient></defs>
    </svg><em>MODEL</em>`);
    T.sunG = T.hud.querySelector('.sg'); T.sunD = T.hud.querySelector('.sd'); T.clock = T.hud.querySelector('.ck');
  }

  /* ---------------- camera ---------------- */
  function setCam(yawDeg, pitchDeg, dist) {
    const y = THREE.MathUtils.degToRad(yawDeg), p = THREE.MathUtils.degToRad(clamp(pitchDeg, 10, 78));
    const d = new THREE.Vector3(Math.sin(y) * Math.cos(p), -Math.sin(p), -Math.cos(y) * Math.cos(p));
    camera.position.copy(controls.target).addScaledVector(d, -dist);
    camera.lookAt(controls.target);
  }
  function getView() {
    const o = camera.position.clone().sub(controls.target), dist = o.length();
    return { yaw: THREE.MathUtils.radToDeg(Math.atan2(-o.x, o.z)), pitch: THREE.MathUtils.radToDeg(Math.asin(clamp(o.y / dist, -1, 1))), dist };
  }
  function startTween(yaw, pitch, dist, ms) {
    const v = getView();
    let dy = ((yaw - v.yaw) % 360 + 540) % 360 - 180;
    S.tween = { y0: v.yaw, dy, p0: v.pitch, p1: clamp(pitch, 12, 78), d0: v.dist, d1: clamp(dist == null ? v.dist : dist, controls.minDistance, controls.maxDistance), t0: S.time, dur: Math.max(0, (reduced ? 0 : (ms == null ? 600 : ms)) / 1000) };
    S.swayBase = null; S.userAt = S.time;
    if (!S.active) { stepTween(true); renderOnce(); }
    kick();
  }
  function stepTween(force) {
    const tw = S.tween; if (!tw) return;
    const p = tw.dur > 0 && !force ? clamp((S.time - tw.t0) / tw.dur, 0, 1) : 1, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    setCam(tw.y0 + tw.dy * e, lerp(tw.p0, tw.p1, e), lerp(tw.d0, tw.d1, e));
    if (p >= 1) S.tween = null;
  }
  function stepSway(dt) {
    /* idle "turntable": slow ±10° yaw swing around the view the user left, starts 8 s after the last interaction */
    if (!S.auto || reduced || S.tween || S.time - S.userAt < 8) { S.swayBase = null; return; }
    if (!S.swayBase) { S.swayBase = getView(); S.swayT0 = S.time; }
    const k = S.time - S.swayT0, amp = 10 * smooth(0, 6, k);
    setCam(S.swayBase.yaw + amp * Math.sin(k * 2 * Math.PI / 48), S.swayBase.pitch, S.swayBase.dist);
    void dt;
  }

  /* ---------------- sun ---------------- */
  const cTmp = new THREE.Color(), cTmp2 = new THREE.Color();
  function applySun(s) {
    const sp = sunPos(s), day = smooth(0.02, 0.6, s), el = sunElev(s), dusk = smooth(0.04, -0.1, s);
    const up = smooth(-0.004, 0.035, s);                                   /* direct sun: 0 below the horizon */
    /* sky: real elevation; azimuth of the visible disc around sunrise, the real one from 06:50 on */
    const yaw = THREE.MathUtils.degToRad(HOME_VIEW.yaw + SUN_DISC_BEAR), bl = smooth(0.05, 0.12, s);
    /* before sunrise the sky's sun swings behind the camera at +3°: the sky in view is a cool blue twilight, no orange band */
    const back = yaw + Math.PI - THREE.MathUtils.degToRad(SUN_DISC_BEAR), ax = lerp(lerp(Math.sin(yaw), Math.sin(sp.az), bl), Math.sin(back), dusk), az0 = lerp(lerp(Math.cos(yaw), Math.cos(sp.az), bl), Math.cos(back), dusk);
    const az = Math.atan2(ax, az0);
    const se = lerp(Math.max(el, THREE.MathUtils.degToRad(4)), THREE.MathUtils.degToRad(24), dusk);
    W.skyTint.value.set(1, 1, 1).lerp(V3.set(0.5, 0.64, 1.0), dusk);              /* cool blue hour before sunrise */
    W.sky.material.uniforms.sunPosition.value.set(Math.sin(az) * Math.cos(se), Math.sin(se), -Math.cos(az) * Math.cos(se));
    W.sky.material.uniforms.turbidity.value = lerp(lerp(5, 2.0, day), 1.4, dusk);
    W.sky.material.uniforms.rayleigh.value = lerp(lerp(2.4, 2.0, day), 3.6, dusk);
    W.sky.material.uniforms.mieCoefficient.value = lerp(lerp(0.005, 0.0025, day), 0.0015, dusk);
    const le = Math.max(el, THREE.MathUtils.degToRad(5));
    V3.copy(sp.dir).setY(0).normalize().multiplyScalar(Math.cos(le)).setY(Math.sin(le));
    W.sun.position.copy(W.sun.target.position).addScaledVector(V3, 320);
    W.sun.color.copy(cTmp.set('#ffb27a')).lerp(cTmp2.set('#fff6ea'), day);
    W.sun.intensity = lerp(2.4, 3.4, day) * up;
    W.hemi.color.copy(cTmp.set('#d8ccd4')).lerp(cTmp2.set('#dfe7ef'), day).lerp(cTmp2.set('#8ea3cc'), dusk);
    W.hemi.groundColor.copy(cTmp.set('#a59985')).lerp(cTmp2.set('#4f5566'), dusk);
    W.hemi.intensity = lerp(lerp(1.85, 1.8, day), 2.3, dusk);
    scene.fog.color.copy(cTmp.set('#dccbbf')).lerp(cTmp2.set('#cdd5dc'), day).lerp(cTmp2.set('#8794ae'), dusk);
    renderer.toneMappingExposure = lerp(lerp(1.0, 0.9, day), 0.5, dusk);
    W.mat.glass.emissiveIntensity = clamp(1 - s * 2.4, 0, 1) * 1.1;
    /* the visible sun disc: world-fixed bearing, real elevation; hills hide it below the horizon */
    const D = 12000, sel = el + THREE.MathUtils.degToRad(0.25);
    W.sunDisc.position.set(Math.sin(yaw) * Math.cos(sel) * D + HOME_VIEW.target.x, Math.sin(sel) * D, -Math.cos(yaw) * Math.cos(sel) * D + HOME_VIEW.target.z);
    W.sunDisc.material.opacity = 1 - smooth(0.12, 0.2, s);
    W.sunDisc.visible = W.sunDisc.material.opacity > 0.01;
    W.sunDisc.material.color.copy(cTmp.set('#ff9a52')).lerp(cTmp2.set('#ffe3a0'), smooth(0, 0.12, s));
    if (Math.abs(s - S.lastShadowSun) > 0.0008) { renderer.shadowMap.needsUpdate = true; S.lastShadowSun = s; }
  }

  /* ---------------- state -> 3D ---------------- */
  const cA = new THREE.Color(), sc3 = new THREE.Vector3();
  function applyModel(now, dt) {
    const m = computeVillage(S.sun, S.act, S.inv, S.tapK * S.tapVolts); last = m;
    const uc = W.wireCore.material.uniforms.uCol.value, ug = W.wireGlow.material.uniforms;
    const nq = smooth(0, 0.04, S.sun);                                       /* 0 before sunrise: wires neutral */
    NODE_KEYS.forEach((n, si) => {
      const L = level(m.nv[si], HOMES.some((h, i) => lineOf(i) === n[0].toUpperCase() && S.act[i] > 0.5));
      if (W.segLvl[si] !== L) { W.segLvl[si] = L; uc[si].copy(rawRGB(LCOL[L])); ug.uCol.value[si].copy(rawRGB(LCOL[L])); }
      ug.uOp.value[si] = ([0.4, 0.55, 0.7][L] + (L === 2 && !reduced ? 0.12 * (0.5 + 0.5 * Math.sin(now / 160)) : 0)) * nq;
      if (nq < 1) uc[si].copy(rawRGB(LCOL[L])).lerp(NEUTRAL, 1 - nq); else if (W.segNeutral) uc[si].copy(rawRGB(LCOL[L]));
    });
    const net = m.out.reduce((a, b) => a + b, 0) / N - 0.3;
    if (!reduced) S.flowPhase += net * 1.5 * dt;
    ug.uPhase.value = S.flowPhase; ug.uDashAmt.value = clamp(Math.abs(net) * 2.2, 0.15, 1);
    /* SunGuard boxes: pop in/out, glow with activation */
    let anyOn = 0; Q.identity();
    for (let i = 0; i < N; i++) {
      const a = S.act[i], vis = Math.max(a, S.showAll ? 1 : 0), age = S.time - S.pop[i];
      let s = vis > 0.001 ? Math.min(1, vis * 3) : 0;
      if (age >= 0 && age < 0.6) s *= 1 + 0.5 * Math.sin(age / 0.6 * Math.PI);
      M4.compose(W.boxPos[i], Q, sc3.set(s, s, s)); W.boxes.setMatrixAt(i, M4);
      W.boxes.setColorAt(i, cA.set(a > 0.5 ? '#eaf6ff' : '#9aa3a8'));
      W.halo.setOn(i, s > 0 ? (0.2 + 0.8 * a) * (1 + 0.9 * Math.max(0, 1 - (S.time - S.pulseT) / 0.8)) : 0);
      anyOn = Math.max(anyOn, a);
    }
    W.boxes.instanceMatrix.needsUpdate = true; W.boxes.instanceColor.needsUpdate = true;
    W.mat.box.emissiveIntensity = 0.15 + 0.9 * anyOn;
    U.glint.value = smooth(0.35, 0.9, S.sun) * 0.5;
    for (let i = 0; i < N; i++) U.off.value[i] = 1 - S.inv[i];
    W.segNeutral = nq < 1;
  }

  /* ---------------- labels: project, hide behind camera / off-screen, cull overlaps ---------------- */
  const P = new THREE.Vector3(), vTop = new THREE.Vector3();
  function project(v) { P.copy(v).project(camera); return { x: (P.x + 1) / 2 * S.cw, y: (1 - P.y) / 2 * S.ch, ok: P.z < 1 && P.z > -1 && Math.abs(P.x) < 1.15 && Math.abs(P.y) < 1.15 }; }
  const show = (o, on) => { const v = on ? 1 : 0; if (o.vis !== v) { o.vis = v; o.el.style.opacity = String(v); } };
  const at = (o, x, y) => { o.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; };
  const hit = (r, list) => list.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  function applyOverlay() {
    const m = last, s5 = S.showAll || S.stage > 0;
    /* 1. line labels: content */
    for (const L of LINES) {
      const o = T.lines[L], wi = WORST[LINES.indexOf(L)], on = boxedLine(L), boxedNow = S.act[wi] > 0.5;
      const v = Math.max(...HOMES.map((h, i) => (lineOf(i) === L ? m.v[i] : -1))), tr = HOMES.some((h, i) => lineOf(i) === L && S.trip[i] >= 0);
      const lv = tr ? 2 : level(v, boxedNow);
      const title = L === 'C' ? 'Line C · short line' : ('Line ' + L + (s5 ? (on ? ' · with SunGuard' : ' · no SunGuard') : ''));
      const pre = S.sun < 0, chip = S.hl && on && s5, trip = HOMES.some((h, i) => lineOf(i) === L && S.trip[i] >= 0);
      const key = title + '|' + Math.round(v) + '|' + lv + '|' + (on && s5 ? 1 : 0) + '|' + pre + '|' + chip + '|' + trip + '|' + S.tap;
      if (o.key !== key) {
        o.key = key;
        o.t.innerHTML = (on && s5 ? TICKSVG('s3d-sgk') : '') + '<span>' + title + '</span>';
        o.n.innerHTML = Math.round(v) + ' <i>V</i>';
        o.m.innerHTML = pre ? '' : (lv === 2 ? '<span class="st over">OVER</span>' : (lv === 1 ? '<span class="st near">above legal limit</span>' : MARK[0] + (S.tap ? '<span class="st ok">within the legal limit</span>' : '')));
        o.el.style.setProperty('--c', pre ? '#8d96a0' : LCOL[lv]); o.el.style.setProperty('--t', pre ? '#e8ecf0' : LTXT[lv]);
        o.chip.style.display = chip ? '' : 'none'; o.ec.style.display = trip ? '' : 'none';
        o.el.classList.toggle('on', on && s5); o.w = 0;
      }
    }
    for (const o of Object.values(T.lines).concat([T.tp])) if (!o.w) { o.w = o.el.offsetWidth; o.h = o.el.offsetHeight; }
    /* 2. place: line labels above the last home of each line (keep-outs + no overlaps), then the transformer tag */
    const placed = keepOut.slice(); placed.push([S.cw - 345, 0, S.cw, 150]);
    const put = (o, x, y, tries) => {
      for (const [dx, dy] of tries) {
        const r = [x + dx - o.w / 2, y + dy - o.h, x + dx + o.w / 2, y + dy];
        if (r[0] < 4 || r[2] > S.cw - 4 || r[1] < 4 || r[3] > S.ch - 4 || hit(r, placed)) continue;
        placed.push(r); at(o, r[0], r[1]); show(o, true); return true;
      }
      show(o, false); return false;
    };
    const tries = [[0, 0], [0, -40], [0, 60], [-140, 0], [140, 0], [-140, 60], [140, 60], [0, 130], [-220, 130], [220, 130]];
    const order = LINES.slice().sort((a, b) => m.v[WORST[LINES.indexOf(b)]] - m.v[WORST[LINES.indexOf(a)]]);
    for (const L of order) {
      const wi = WORST[LINES.indexOf(L)], p = project(W.barBase[wi]);
      if (p.ok) put(T.lines[L], p.x, p.y - 6, tries); else show(T.lines[L], false);
    }
    { const t = S.tap ? 'transformer · tap ' + (S.tapVolts > 6 ? '−5 %' : '−2.5 %') : 'transformer'; if (T.tp.el.textContent !== t) { T.tp.el.textContent = t; T.tp.w = 0; T.tp.w = T.tp.el.offsetWidth; T.tp.h = T.tp.el.offsetHeight; } }
    const tp = project(W.tpAnchor); if (tp.ok) put(T.tp, tp.x + T.tp.w / 2 + 8, tp.y + T.tp.h / 2, [[0, 0], [0, 34], [-T.tp.w - 16, 0]]); else show(T.tp, false);
    /* 3. status marks at each service connection (small; hidden in keep-outs and under the labels) */
    HOMES.forEach((h, i) => {
      const d = T.dots[i], lv = level(m.v[i], S.act[i] > 0.5);
      if (S.sun < 0) { show(d, false); return; }
      if (d.lvl !== lv) { d.lvl = lv; d.el.innerHTML = MARK[lv]; }
      const p = project(W.drops[i][1]);
      const r = [p.x - 17, p.y - 17, p.x + 17, p.y + 17];
      if (!p.ok || hit(r, placed)) { show(d, false); return; }
      at(d, p.x, p.y); show(d, true);
    });
    /* sun dial */
    const t = clamp(S.sun, 0, 1), x = (1 - t) * (1 - t) * 18 + 2 * (1 - t) * t * 120 + t * t * 370,
      y = (1 - t) * (1 - t) * 132 + 2 * (1 - t) * t * 18 + t * t * 22 + (S.sun < 0 ? -S.sun / -SUN_MIN * 40 : 0);   /* below the dial's horizon before sunrise */
    T.sunG.setAttribute('cx', x.toFixed(1)); T.sunG.setAttribute('cy', y.toFixed(1)); T.sunD.setAttribute('cx', x.toFixed(1)); T.sunD.setAttribute('cy', y.toFixed(1));
    const ck = fmtClock(sunClock(S.sun)); if (T.clock.textContent !== ck) T.clock.textContent = ck;
    T.clock.setAttribute('x', '380'); T.clock.setAttribute('text-anchor', 'end'); T.clock.setAttribute('y', '124');
  }
  const fmtClock = (t) => { let hh = Math.floor(t + 1e-6), mm = Math.round((t - hh) * 60 / 5) * 5; if (mm === 60) { hh += 1; mm = 0; } return hh + ':' + String(mm).padStart(2, '0'); };

  /* ---------------- sizing + watchdog ---------------- */
  let lastKey = '';
  function resize() {
    if (!root || !renderer) return;
    const cw = root.clientWidth || 1920, ch = root.clientHeight || 1080, rect = root.getBoundingClientRect();
    S.cw = cw; S.ch = ch;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * [1, 0.8, 0.62][S.quality];
    let bw = Math.max(2, Math.round((rect.width || cw) * dpr)), bh = Math.max(2, Math.round((rect.height || ch) * dpr));
    const maxPx = 1920 * 1080 * 1.6; if (bw * bh > maxPx) { const k = Math.sqrt(maxPx / (bw * bh)); bw = Math.round(bw * k); bh = Math.round(bh * k); }
    const key = bw + 'x' + bh + ':' + cw + 'x' + ch; if (key === lastKey) return; lastKey = key;
    renderer.setSize(bw, bh, false);
    /* shift lens: render the top cw×ch window of a taller virtual frame (fullH = ch + 2·shift); same pixel scale as a camera of LENS.fov */
    const sh = LENS.shift * ch / 1080, fullH = ch + 2 * sh;
    camera.fov = 2 * Math.atan(Math.tan(LENS.fov * Math.PI / 360) * fullH / ch) * 180 / Math.PI;
    camera.aspect = cw / fullH; camera.setViewOffset(cw, fullH, 0, 0, cw, ch); camera.updateProjectionMatrix();
  }
  const WD = { t0: 0, frames: 0, warm: 0, prev: 0, gaps: 0, bad: 0, proven: false, on: opts.watchdog !== false };
  function setQuality(q) {
    S.quality = q; lastKey = ''; resize();
    if (q >= 2 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((mm) => { mm.needsUpdate = true; }); }); }
  }
  /* new measuring window after a pause; the first frames after a pause are often slow (compositor, GPU wake-up) */
  function wdPause(settleMs) { WD.t0 = 0; WD.prev = 0; WD.gaps = 0; WD.bad = 0; WD.warm = performance.now() + settleMs; S.lastT = 0; }
  /* fps windows: 1.5 s at full quality, 3 s at low quality. A pause is not slowness: a frame gap > 250 ms (window hidden,
     Alt-Tab, frozen tab, long task) drops the window, unless 4 slow frames come in a row (a really slow GPU).
     Two bad windows in a row are needed: full quality < 24 fps -> low quality, < 12 fps -> 2D; low quality < 20 fps -> 2D.
     24, not 30: Chrome's energy saver and Windows battery saver cap pages at 30 fps, which is not a slow GPU.
     Once a full-quality window reached 24 fps the GPU is proven and the 3D never switches to 2D. */
  function watchdog(t) {
    const gap = WD.prev ? t - WD.prev : 0; WD.prev = t;
    if (document.visibilityState !== 'visible' || t < WD.warm) { WD.t0 = 0; return; }
    if (gap > 250) { if (++WD.gaps < 4) { WD.t0 = 0; return; } } else WD.gaps = 0;
    if (!WD.t0) { WD.t0 = t; WD.frames = 0; return; }
    WD.frames++;
    const span = t - WD.t0; if (span < (S.quality === 0 ? 1500 : 3000)) return;
    const fps = WD.frames * 1000 / span; S.fps = fps; WD.t0 = t; WD.frames = 0;
    if (S.quality === 0 && fps >= 24) WD.proven = true;
    if (!WD.on) return;
    WD.bad = (S.quality === 0 ? fps < 24 : fps < 20) ? WD.bad + 1 : 0;
    if (WD.bad < 2) return;
    WD.bad = 0;
    if (S.quality === 0 && (fps >= 12 || WD.proven)) { setQuality(2); WD.warm = t + 700; }
    else if (!WD.proven) fail('fps ' + fps.toFixed(1) + (S.quality === 0 ? ' at full quality' : ' at low quality') + ', two windows in a row');
  }
  function onVisibility() {
    wdPause(1000);
    if (document.visibilityState === 'visible') { if (S.lost) S.lostAt = performance.now(); kick(); }
  }
  /* WebGL context loss (GPU reset, driver update, sleep): three.js restores everything itself on 'webglcontextrestored';
     only if no restore comes within 5 s of VISIBLE time the deck falls back */
  function onContextLost(e) {
    e.preventDefault(); S.lost = true; S.lostAt = performance.now();
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    clearTimeout(S.lostTimer);
    const check = () => {
      if (!S.lost || S.failed) return;
      if (document.visibilityState === 'visible' && performance.now() - S.lostAt > 5000) { fail('webgl context lost, not restored in 5 s'); return; }
      S.lostTimer = setTimeout(check, 500);
    };
    S.lostTimer = setTimeout(check, 500);
  }
  function onContextRestored() {
    S.lost = false; clearTimeout(S.lostTimer);
    S.lastShadowSun = -1; lastKey = ''; resize(); wdPause(1500);
    if (S.active) kick(); else renderOnce();
  }

  /* ---------------- loop ---------------- */
  function step(t, dt) {
    S.time += dt; U.time.value = S.time;
    if (S.sweep) {                                          /* scripted sweep: the goal itself moves, eased */
      const p = clamp((t - S.sweep.t0) / S.sweep.dur, 0, 1), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      S.goal = lerp(S.sweep.from, S.sweep.to, e); if (p >= 1) S.sweep = null;
    }
    if (reduced) { S.sun = S.goal; S.vel = 0; }
    else {                                                  /* critically damped spring, |speed| <= SUN_VMAX (deck v8: ~110 ms, 1.2 units/s) */
      const w = SUN_W, acc = w * w * (S.goal - S.sun) - 2 * w * S.vel;
      S.vel = clamp(S.vel + acc * dt, -SUN_VMAX, SUN_VMAX); S.sun += S.vel * dt;
      if (Math.abs(S.goal - S.sun) < 1e-4 && Math.abs(S.vel) < 1e-3) { S.sun = S.goal; S.vel = 0; }
    }
    for (let j = 0; j < N; j++) {
      const a = S.actA[j];
      if (a.dur <= 0 || reduced) { S.act[j] = a.to; continue; }
      const p = clamp((S.time - a.t0) / a.dur, 0, 1), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      S.act[j] = a.from + (a.to - a.from) * e; if (p >= 1) a.dur = 0;
    }
    { const a = S.tapA;                                     /* ENA tap change, eased */
      if (a.dur <= 0 || reduced) S.tapK = a.to;
      else { const p = clamp((S.time - a.t0) / a.dur, 0, 1), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; S.tapK = a.from + (a.to - a.from) * e; if (p >= 1) a.dur = 0; } }
    /* inverters on unboxed homes: > 253 V for 0.6 s -> trip (output off in 0.2 s), restart after 5 s with a 1.2 s soft start (cycle ~6.8 s) */
    const vNow = last.v;
    for (let j = 0; j < N; j++) {
      if (S.act[j] > 0.02) { S.trip[j] = -1; S.over[j] = -1; S.inv[j] = Math.min(1, S.inv[j] + dt / 1.2); continue; }
      if (S.trip[j] >= 0) {
        S.inv[j] = Math.max(0, S.inv[j] - dt / 0.2);
        if (S.time - S.trip[j] > 5.0) S.trip[j] = -1;
        continue;
      }
      S.inv[j] = Math.min(1, S.inv[j] + dt / 1.2);
      if (vNow[j] > TRIP_V) { if (S.over[j] < 0) S.over[j] = S.time; else if (S.time - S.over[j] > 0.6) { S.trip[j] = S.time; S.over[j] = -1; } }
      else S.over[j] = -1;
    }
    if (S.tween) stepTween(false); else stepSway(dt);
    controls.update();
    W.sky.material.uniforms.time.value = S.time;
    W.halo.material.uniforms.uTime.value = S.time;
  }
  function draw(t) { camera.updateMatrixWorld(); applySun(S.sun); applyModel(t, S.dtLast); renderer.render(scene, camera); applyOverlay(); }
  function frame(t) {
    S.raf = 0;
    if (!S.active || S.failed || S.lost) return;
    try {
      const dt = S.lastT ? Math.min(0.1, (t - S.lastT) / 1000) : 0.016; S.lastT = t; S.dtLast = dt;
      step(t, dt);
      if ((S.time | 0) !== S.lastSec) { S.lastSec = S.time | 0; resize(); }
      draw(t); watchdog(t); S.errs = 0;
    } catch (e) {                                           /* one bad frame is skipped; only a persistent error (30 frames in a row) ends the 3D */
      if (!S.errs) console.warn('[street3d] frame error:', e);
      if (++S.errs >= 30) { fail('frame error: ' + (e && e.message)); return; }
    }
    S.raf = requestAnimationFrame(frame);
  }
  function kick() { if (S.active && S.ready && !S.raf && !S.failed && !S.lost) { S.lastT = 0; S.raf = requestAnimationFrame(frame); } }
  function renderOnce() {
    if (!S.built || !S.ready || S.failed || S.lost) return;
    try { S.sun = S.goal = S.to; S.vel = 0; S.sweep = null; retarget(true); S.tapK = S.tapA.to; S.tapA.dur = 0; controls.update(); S.dtLast = 0; draw(performance.now()); }
    catch (e) { fail('render error: ' + (e && e.message)); }
  }
  function fail(reason) {
    if (S.failed) return;
    S.failed = true; window.Street3DFailed = true;
    if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0;
    console.info('[street3d] switching to the 2D street:', reason);
    try { onFail(reason, api.snapshot()); } catch (e) { /* ignore */ }
    destroy();
  }
  function destroy() {
    try {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('focus', onVisibility); window.removeEventListener('pageshow', onVisibility);
      clearTimeout(S.lostTimer);
      if (controls) controls.dispose();
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (scene) scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); }); });
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); }
    } catch (e) { /* ignore */ }
    renderer = null;
  }
  function onResize() { lastKey = ''; resize(); if (!S.active) renderOnce(); }
  /* bright sweep over the PV panels of the given lines (staggered), duration U.sweepDur */
  function sweep(lines, delay = 0) {
    const v = U.sweep.value; lines.forEach((L, k) => { v.setComponent(LINES.indexOf(L), S.time + delay + k * 0.12); });
    kick();
  }
  /* boxes switch on house by house from the transformer outward (250 ms apart, 0.6 s ease-in-out); off: together, 0.5 s */
  function retarget(instant) {
    HOMES.forEach((h, i) => {
      const a = S.actA[i], tg = tgtOf(i);
      if (instant || !S.built) { a.from = a.to = tg; a.dur = 0; S.act[i] = tg; return; }
      if (a.to === tg) return;
      a.from = S.act[i]; a.to = tg;
      a.t0 = S.time + (tg > a.from ? RANK[i] * 0.25 : 0); a.dur = tg > a.from ? 0.6 : 0.5;
      if (tg > a.from) S.pop[i] = a.t0;
      if (tg > 0) { S.trip[i] = -1; S.over[i] = -1; }
    });
  }
  /* ENA tap step: -2.5 % if that brings every house <= 241 V (1 V margin under 242) at full sun with the current boxes, otherwise -5 % */
  function tapStep() {
    const act = HOMES.map((h, i) => tgtOf(i)), one = new Array(N).fill(1);
    return Math.max(...computeVillage(1, act, one, TAP_STEP_V).v) <= TAP_TARGET ? TAP_STEP_V : 2 * TAP_STEP_V;
  }
  function setStage(n) {
    const was = S.stage; S.stage = clamp(Math.round(+n || 0), 0, 2);
    retarget(false);
    if (S.tap) S.tapVolts = tapStep();
    if (S.built && S.hl && S.stage > was) sweep(was < 1 ? ['A', 'B'].concat(S.stage >= 2 ? ['D'] : []) : ['D'], 0.35);
    if (!S.active) renderOnce(); kick();
    return api.boxes();
  }

  const api = {
    is3D: true,
    init(el) {
      if (S.built) { if (el && el !== root) { el.appendChild(wrap); root = el; resize(); } return; }
      build(el); window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVisibility); window.addEventListener('focus', onVisibility); window.addEventListener('pageshow', onVisibility);
    },
    async warm() {
      if (!S.built || S.failed) return;
      if (renderer.compileAsync) { try { await renderer.compileAsync(scene, camera); } catch (e) { /* compiled on first render */ } }
      await new Promise((r) => requestAnimationFrame(() => r()));
      if (S.failed) return;
      S.ready = true; renderOnce(); kick();
    },
    setActive(on) {
      S.active = !!on;
      if (renderer) renderer.domElement.style.pointerEvents = on ? 'auto' : 'none';
      if (controls) controls.enabled = !!on;
      if (on) { WD.t0 = 0; WD.warm = performance.now() + 1500; kick(); }
      else if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    },
    /* ms = 0: jump (scene entry); ms >= 1000: scripted sweep over ms; otherwise follow with the spring (remote samples at up to 50 Hz) */
    setSun(v, ms) {
      v = clamp(+v || 0, SUN_MIN, 1); S.to = v;
      if (!S.active || ms === 0 || +ms === 0) { S.sun = S.goal = v; S.vel = 0; S.sweep = null; if (!S.active) renderOnce(); else kick(); return; }
      if (ms != null && +ms >= 1000) { S.sweep = { from: S.goal, to: v, t0: performance.now(), dur: +ms }; }
      else { S.sweep = null; S.goal = v; }
      kick();
    },
    sweepSun(v, ms) {
      v = clamp(+v || 0, SUN_MIN, 1); S.to = v;
      if (!S.active) { S.sun = S.goal = v; S.vel = 0; S.sweep = null; renderOnce(); return; }
      S.sweep = { from: S.goal, to: v, t0: performance.now(), dur: ms == null ? 6000 : Math.max(1, +ms || 0) };
      kick();
    },
    getSun() { return S.to; },
    setGuard(on) { return setStage(on ? Math.max(1, S.stage) : 0); },
    setGuardAll(on) { return setStage(on ? 2 : Math.min(S.stage, 1)); },
    setGuardRight(on) { return api.setGuardAll(on); },
    setBoxes(show) { S.showAll = !!show; if (!S.active) renderOnce(); kick(); },
    /* ENA adjusts the transformer: one tap step down (-2.5 % ≈ -5.75 V at every house; -5 % if needed), eased over ms */
    setTap(on, ms) {
      S.tap = !!on; if (S.tap) S.tapVolts = tapStep();
      const a = S.tapA; a.from = S.tapK; a.to = S.tap ? 1 : 0; a.t0 = S.time; a.dur = Math.max(0, (ms == null ? 1500 : +ms || 0) / 1000);
      if (!S.active) renderOnce(); kick();
      return S.tap;
    },
    /* "panels keep working": a brief bright sweep over the PV panels of BOXED lines (ms, default 600)
       + a chip "panels working · no emergency shutdown" above each boxed line's label while on */
    highlightPanels(on, ms) {
      S.hl = !!on; U.sweepDur.value = Math.max(0.15, (ms == null ? 600 : +ms || 600) / 1000);
      if (S.hl && S.built) sweep(LINES.filter((L) => boxedLine(L)));
      if (!S.active) renderOnce(); kick();
    },
    setBoxCount(k) { k = Math.round(+k || 0); const nAB = HOMES.filter((h, i) => 'AB'.includes(lineOf(i))).length; return setStage(k <= 0 ? 0 : (k <= nAB ? 1 : 2)); },
    addBox() { return setStage(S.stage + 1); },
    boxes() { return HOMES.filter((h, i) => boxedLine(lineOf(i))).length; },
    boxedHouses() { return HOMES.map((h, i) => boxedLine(lineOf(i))); },
    cutPercent() { return Math.round(100 * computeVillage(S.sun, S.act, S.inv, S.tapK * S.tapVolts).cut); },
    pulse() {
      if (!S.built || !(S.stage > 0 || S.showAll)) return;
      S.pulseT = S.time; kick();
    },
    volts() { return computeVillage(S.sun, S.act, S.inv, S.tapK * S.tapVolts).v; },
    state() {
      const m = computeVillage(S.sun, S.act, S.inv, S.tapK * S.tapVolts), v = camera ? getView() : null;
      return { sun: S.sun, target: S.to, stage: S.stage, boxes: api.boxes(), g: api.boxes() / N, k: Math.min(...Object.values(m.k)), kBy: m.k, cut: m.cut, cutBy: m.cutBy,
        v: m.v, homes: HOMES.map((h) => h.id), out: m.out, view: v, panelsHighlight: S.hl, tap: { on: S.tap, percent: S.tap ? -(S.tapVolts / 2.3) : 0, volts: S.tap ? -S.tapVolts : 0, progress: S.tapK }, inverters: S.inv.slice(), tripped: HOMES.filter((h, i) => S.trip[i] >= 0).map((h) => h.id), autoRotate: S.auto, quality: S.quality, fps: S.fps || null, renderer: '3d' };
    },
    /* camera: yaw = compass bearing the camera looks to (0 = north), pitch = degrees down from the horizon */
    setView(yaw, pitch, ms, dist) { if (camera) startTween(+yaw || 0, pitch == null ? HOME_VIEW.pitch : +pitch, dist == null ? null : +dist, ms); },
    orbitBy(dYaw, dPitch) { if (!camera) return; const v = S.tween ? { yaw: S.tween.y0 + S.tween.dy, pitch: S.tween.p1, dist: S.tween.d1 } : getView(); startTween(v.yaw + (+dYaw || 0), v.pitch + (+dPitch || 0), v.dist, 300); },
    resetView(ms) { if (camera) startTween(HOME_VIEW.yaw, HOME_VIEW.pitch, HOME_VIEW.dist, ms == null ? 900 : ms); },
    setAutoRotate(on) { S.auto = !!on; S.swayBase = null; kick(); },
    snapshot() { return { sun: S.to, stage: S.stage, guard: S.stage >= 1, count: api.boxes(), boxes: S.showAll || S.stage > 0, active: S.active }; },
    _debug() { return { renderer, scene, camera, controls, W, S, info: renderer && renderer.info, HOMES, NODES }; },
    _fail(reason) { fail(reason || 'manual'); }
  };
  return api;
}

/* ======================= upgrade the 2D street in place ======================= */
const API_KEYS = ['init', 'setSun', 'sweepSun', 'getSun', 'setGuard', 'setGuardAll', 'setGuardRight', 'setBoxes', 'pulse', 'setActive', 'volts', 'state',
  'setBoxCount', 'addBox', 'boxes', 'cutPercent', 'boxedHouses', 'setView', 'orbitBy', 'resetView', 'setAutoRotate', 'highlightPanels', 'setTap'];
function read2D(el, saved) {
  const st = { sun: 0.15, stage: 0, boxes: false };
  try { if (saved.getSun) st.sun = +saved.getSun() || 0; } catch (e) { /* ignore */ }
  try {
    const s = saved.state ? saved.state() : null;
    if (s) { if (s.stage != null) st.stage = s.stage; else if (s.right) st.stage = 2; else if (s.left || s.boxes > 0) st.stage = 1; }
  } catch (e) { /* ignore */ }
  const svg = el.querySelector('svg.street-svg');
  if (svg && !st.stage) {
    const radio = Array.from(svg.querySelectorAll('g')).find((g) => g.querySelector('.rip'));
    if (radio) { st.stage = radio.classList.contains('guard-off') ? 0 : 1; st.boxes = !radio.classList.contains('sg-hidden'); }
  }
  return st;
}
/**
 * Replace window.Street (2D) by the 3D village in the same element; methods are swapped IN PLACE on the same object.
 * Resolves true on success. On any problem the 2D street stays (or comes back) and window.Street3DFailed = true.
 * opts: { active, watchdog (default true), scrim (default false), autoRotate (default true), keepOut: [[x0,y0,x1,y1],...] }
 */
export async function upgrade(el, opts = {}) {
  el = el || document.getElementById('street');
  if (!el) { window.Street3DFailed = true; return false; }
  if (!webgl2Available()) { window.Street3DFailed = true; console.info('[street3d] WebGL2 unavailable, keeping the 2D street'); return false; }
  const host = window.Street || (window.Street = {});
  if (host.is3D) return true;
  const saved = {}; API_KEYS.forEach((k) => { if (typeof host[k] === 'function') saved[k] = host[k]; });
  const svg2d = () => el.querySelector('svg.street-svg');
  let swapped = false;
  const back2D = (reason, snap) => {
    if (!swapped) return;
    API_KEYS.forEach((k) => { if (saved[k]) host[k] = saved[k]; else delete host[k]; });
    const noop = () => {};
    for (const k of ['setView', 'orbitBy', 'resetView', 'setAutoRotate', 'highlightPanels', 'setTap']) if (!host[k]) host[k] = noop;
    if (!host.setGuardAll) host.setGuardAll = (on) => { if (saved.setGuardRight) saved.setGuardRight(on); else if (saved.setBoxCount) saved.setBoxCount(on ? 6 : 3); };
    if (!host.sweepSun && saved.setSun) host.sweepSun = (v, ms) => saved.setSun(v, ms == null ? 6000 : ms);
    delete host.is3D; delete host._s3d;
    try {
      if (!svg2d() && saved.init) saved.init(el);
      const s = svg2d(); if (s) s.style.display = '';
      if (snap && saved.setSun) {
        saved.setSun(snap.sun, 0); if (saved.setBoxes) saved.setBoxes(snap.boxes);
        if (saved.setGuard) saved.setGuard(snap.stage >= 1);
        if (host.setGuardAll) host.setGuardAll(snap.stage >= 2);
        saved.setActive(snap.active);
      }
    } catch (e) { /* the 2D street is the last resort */ }
  };
  let s3 = null;
  try {
    s3 = createStreet3D({ onFail: back2D, watchdog: opts.watchdog, scrim: opts.scrim, autoRotate: opts.autoRotate, keepOut: opts.keepOut, home: opts.home, preserveDrawingBuffer: opts.preserveDrawingBuffer });
    s3.init(el);
    await s3.warm();
    if (window.Street3DFailed) throw new Error('failed during warm-up');
    const st = read2D(el, saved);
    s3.setSun(st.sun, 0); s3.setBoxes(st.boxes); s3.setGuard(st.stage >= 1); s3.setGuardAll(st.stage >= 2);
    const screens = ((window.GRINO && window.GRINO.SCREENS) || []).filter((x) => x.sun).map((x) => x.id);
    const active = opts.active != null ? !!opts.active : (screens.length ? screens.includes(document.body.dataset.screen) : true);
    if (saved.setActive) saved.setActive(false);
    const s = svg2d(); if (s) s.remove();                 /* nothing stays under the 3D; back2D() rebuilds the 2D street only if the 3D ever gives up */
    API_KEYS.forEach((k) => { host[k] = s3[k]; });
    host.is3D = true; host._s3d = s3;
    swapped = true; window.Street3DFailed = false;
    s3.setActive(active);
    return true;
  } catch (e) {
    console.info('[street3d] 3D not started, keeping the 2D street:', e && e.message);
    window.Street3DFailed = true;
    try { if (s3 && !swapped) s3._fail('init: ' + (e && e.message)); } catch (e2) { /* ignore */ }
    try { el.querySelectorAll('.s3d-wrap').forEach((n) => n.remove()); } catch (e3) { /* ignore */ }
    return false;
  }
}
