/* parts3d.js — SunGuard exploded view for the Grino #27 deck (three.js r186, ES module, no other libraries).
 *
 *   import('./assets/parts3d.js')  →  window.Parts3D = { init, explode, assemble, highlight, setLabels, setActive,
 *                                                         setCaption, state, dispose, LABELS }
 *
 * Everything is procedural (geometry, PCB artwork, label printing) and offline. If WebGL2 is missing or anything
 * fails, window.Parts3DFailed = true, init() resolves false, and nothing is thrown (the deck keeps its 2D screen).
 * See README_PARTS3D.md.
 */
import * as THREE from './vendor/three/three.module.min.js';
import { mergeGeometries } from './vendor/three/addons/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from './vendor/three/addons/RoundedBoxGeometry.js';
import { RoomEnvironment } from './vendor/three/addons/RoomEnvironment.js';

/* label order = highlight index */
export const LABELS = ['Microcontroller with Wi-Fi', 'Voltage sensor', 'Link to the inverter',
  'Power supply 230 V → 5 V', 'DIN-rail case'];

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ WebGL2 probe (at module load) */
function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    return true;
  } catch (e) { return false; }
}
const WEBGL2 = hasWebGL2();
if (!WEBGL2) window.Parts3DFailed = true;

/* ------------------------------------------------------------------ geometry helpers */
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _one);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function rbox(w, h, d, r, seg = 2) {
  r = Math.max(0.002, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new RoundedBoxGeometry(w, h, d, seg, r);
}
const cylZ = (r, h, seg = 20) => new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2);
const cylY = (r, h, seg = 20) => new THREE.CylinderGeometry(r, r, h, seg);
function rrShape(w, h, r, P = THREE.Shape) {
  const s = new P(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/* flat rounded rectangle facing +Z with 0..1 UVs (for printed / textured faces) */
function rrPlane(w, h, r) {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), 6);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}

/* collects geometry per material key under a transform stack; merges into one mesh per key */
class Bld {
  constructor() { this.map = new Map(); this.st = [new THREE.Matrix4()]; }
  get M() { return this.st[this.st.length - 1]; }
  push(x, y, z, rx, ry, rz) { this.st.push(this.M.clone().multiply(trs(x, y, z, rx, ry, rz))); return this; }
  pop() { this.st.pop(); return this; }
  put(key, geo, x, y, z, rx, ry, rz) {
    geo.applyMatrix4(this.M.clone().multiply(trs(x, y, z, rx, ry, rz)));
    let a = this.map.get(key); if (!a) this.map.set(key, (a = []));
    a.push(geo); return geo;
  }
}
function cleanGeo(g) {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') n.deleteAttribute(a);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  n.morphAttributes = {}; n.clearGroups();
  return n;
}

/* ------------------------------------------------------------------ canvas helpers */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; }
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
const FONT = "'Plus Jakarta Sans','Segoe UI',system-ui,Arial,sans-serif";

/* PCB artwork: colour map + packed map (R = bump height, G = roughness, B = metalness) */
class PcbArt {
  constructor(w, h, ppu, o) {
    this.w = w; this.h = h; this.k = ppu; this.o = o;
    this.pads = []; this.traces = []; this.vias = []; this.holes = []; this.silk = []; this.texts = []; this.extra = [];
  }
  X(x) { return (x + this.w / 2) * this.k; }
  Y(y) { return (this.h / 2 - y) * this.k; }
  pad(x, y, w, h, round = false) { this.pads.push([x, y, w, h, round]); }
  trace(pts, wd = 0.03) { this.traces.push([pts, wd]); }
  route(a, b, wd = 0.03) { // 45° routing a → b
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let m;
    if (Math.abs(dy) > Math.abs(dx)) m = [a[0], b[1] - Math.sign(dy) * Math.abs(dx)];
    else m = [b[0] - Math.sign(dx) * Math.abs(dy), a[1]];
    this.trace([a, m, b], wd);
  }
  via(x, y) { this.vias.push([x, y]); }
  hole(x, y, r) { this.holes.push([x, y, r]); }
  srect(x, y, w, h) { this.silk.push(['r', x, y, w, h]); }
  sline(x1, y1, x2, y2) { this.silk.push(['l', x1, y1, x2, y2]); }
  sdot(x, y, r = 0.025) { this.silk.push(['d', x, y, r]); }
  text(s, x, y, size, rot = 0) { this.texts.push([s, x, y, size, rot]); }
  render() {
    const { w, h, k, o } = this, W = Math.round(w * k), H = Math.round(h * k);
    const c = canvas(W, H), g = c.getContext('2d');
    const m = canvas(W, H), q = m.getContext('2d');
    const both = (fn) => { fn(g, 0); fn(q, 1); };
    const S = (v) => v * k;
    // base: mask over bare laminate
    g.fillStyle = o.mask; g.fillRect(0, 0, W, H);
    q.fillStyle = 'rgb(0,104,0)'; q.fillRect(0, 0, W, H);
    // copper pour under the mask (lighter), inset from the edge
    const ins = S(0.07);
    g.fillStyle = o.pour; roundRect(g, ins, ins, W - 2 * ins, H - 2 * ins, S(0.05)); g.fill();
    q.fillStyle = 'rgb(34,98,0)'; roundRect(q, ins, ins, W - 2 * ins, H - 2 * ins, S(0.05)); q.fill();
    // clearances (mask colour) around traces / pads / vias
    const clr = S(0.022);
    const strokePath = (ctx, pts, lw) => {
      ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(this.X(p[0]), this.Y(p[1])) : ctx.moveTo(this.X(p[0]), this.Y(p[1])))); ctx.stroke();
    };
    both((ctx, i) => {
      ctx.strokeStyle = i ? 'rgb(0,104,0)' : o.mask; ctx.fillStyle = ctx.strokeStyle;
      for (const [pts, wd] of this.traces) strokePath(ctx, pts, S(wd) + 2 * clr);
      for (const [x, y, pw, ph] of this.pads) { ctx.fillRect(this.X(x) - S(pw) / 2 - clr, this.Y(y) - S(ph) / 2 - clr, S(pw) + 2 * clr, S(ph) + 2 * clr); }
      for (const [x, y] of this.vias) { ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), S(0.035) + clr, 0, 7); ctx.fill(); }
      for (const [x, y, r] of this.holes) { ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), S(r * 1.6) + clr, 0, 7); ctx.fill(); }
    });
    // traces: copper under mask
    g.strokeStyle = o.trace; q.strokeStyle = 'rgb(70,92,0)';
    for (const [pts, wd] of this.traces) { strokePath(g, pts, S(wd)); strokePath(q, pts, S(wd)); }
    // tented vias
    for (const [x, y] of this.vias) {
      g.fillStyle = o.trace; g.beginPath(); g.arc(this.X(x), this.Y(y), S(0.035), 0, 7); g.fill();
      g.fillStyle = o.mask; g.beginPath(); g.arc(this.X(x), this.Y(y), S(0.015), 0, 7); g.fill();
      q.fillStyle = 'rgb(70,92,0)'; q.beginPath(); q.arc(this.X(x), this.Y(y), S(0.035), 0, 7); q.fill();
    }
    // exposed pads (ENIG gold / HASL tin)
    for (const [x, y, pw, ph, round] of this.pads) {
      for (const [ctx, col] of [[g, o.finish], [q, 'rgb(120,58,255)']]) {
        ctx.fillStyle = col;
        if (round) { ctx.beginPath(); ctx.ellipse(this.X(x), this.Y(y), S(pw) / 2, S(ph) / 2, 0, 0, 7); ctx.fill(); }
        else { roundRect(ctx, this.X(x) - S(pw) / 2, this.Y(y) - S(ph) / 2, S(pw), S(ph), S(Math.min(pw, ph)) * 0.18); ctx.fill(); }
      }
    }
    // plated mounting holes
    for (const [x, y, r] of this.holes) {
      for (const [ctx, ring, hole] of [[g, o.finish, '#0b0c0c'], [q, 'rgb(120,58,255)', 'rgb(0,240,0)']]) {
        ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), S(r * 1.6), 0, 7); ctx.fill();
        ctx.fillStyle = hole; ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), S(r), 0, 7); ctx.fill();
      }
    }
    // silkscreen
    both((ctx, i) => {
      ctx.strokeStyle = i ? 'rgb(150,190,0)' : o.silk; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = S(0.018); ctx.lineCap = 'round';
      for (const s of this.silk) {
        if (s[0] === 'r') { ctx.strokeRect(this.X(s[1] - s[3] / 2), this.Y(s[2] + s[4] / 2), S(s[3]), S(s[4])); }
        else if (s[0] === 'l') { ctx.beginPath(); ctx.moveTo(this.X(s[1]), this.Y(s[2])); ctx.lineTo(this.X(s[3]), this.Y(s[4])); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(this.X(s[1]), this.Y(s[2]), S(s[3]), 0, 7); ctx.fill(); }
      }
      for (const [s, x, y, size, rot] of this.texts) {
        ctx.save(); ctx.translate(this.X(x), this.Y(y)); ctx.rotate(-rot);
        ctx.font = `700 ${S(size)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s, 0, 0); ctx.restore();
      }
    });
    for (const fn of this.extra) fn(g, q, this);
    return { c, m };
  }
}

/* ------------------------------------------------------------------ materials */
const PCB = {
  mcu: { mask: '#0f4f31', pour: '#176a42', trace: '#1f7a4c', silk: '#eef0ea', finish: '#d9b25e' },
  esp: { mask: '#141617', pour: '#1a1d1e', trace: '#25292a', silk: '#d9dbd6', finish: '#d9b25e' },
  sens: { mask: '#13409a', pour: '#1a4fb4', trace: '#2560c8', silk: '#f2f4f8', finish: '#cfd3d6' },
  link: { mask: '#8e1b22', pour: '#a8252c', trace: '#b93038', silk: '#f4efe8', finish: '#cfd3d6' },
};

/* plain single-colour materials are merged per part into 3 vertex-coloured classes (fewer draw calls on iGPUs) */
const KEYCLASS = {
  latch: ['matte', 0x3b403e], dark: ['matte', 0x0d0e0e], epoxy: ['matte', 0x1a1b1c], psu: ['matte', 0x1c1d1e],
  black: ['satin', 0x151617], ceramic: ['satin', 0xb29372], blueTerm: ['satin', 0x2c6ee0], greenTerm: ['satin', 0x1f9a58],
  trim: ['satin', 0x4a93ff], sheath: ['satin', 0xa3a7a5], coreBn: ['satin', 0x6b3a1c], coreBu: ['satin', 0x1f56b8], mark: ['satin', 0x3a3c3d],
  gloss: ['satin', 0x141515], lever: ['satin', 0x3d4143], sideMcu: ['satin', 0x0d4029], sideEsp: ['satin', 0x111213], sideSens: ['satin', 0x0f3478], sideLink: ['satin', 0x741319],
  gold: ['metal', 0xe8be68], tin: ['metal', 0xd5d7d9], nickel: ['metal', 0xcfd2d5], steel: ['metal', 0xd2d5d8], brass: ['metal', 0xd8b067],
  zinc: ['metal', 0xc2c7ca], copper: ['metal', 0xd68a5a],
};
function matDefs(T) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const pcbTop = (t) => S({ map: t.map, roughnessMap: t.orm, metalnessMap: t.orm, bumpMap: t.orm, bumpScale: 0.9, roughness: 0.92, metalness: 1 });
  return {
    case: () => S({ color: 0xcdd1cd, roughness: 0.62, metalness: 0 }),                  // RAL 7035 light grey, matte
    casePrint: () => S({ map: T.casePrint, roughness: 0.62 }),
    mcb: () => S({ color: 0xedede9, roughness: 0.55 }),
    mcbPrint: () => S({ map: T.mcbPrint, roughness: 0.55 }),
    hole: () => S({ color: 0x262928, roughness: 0.85, side: THREE.BackSide }),
    matte: () => S({ vertexColors: true, roughness: 0.74 }),
    satin: () => S({ vertexColors: true, roughness: 0.44 }),
    metal: () => S({ vertexColors: true, metalness: 1, roughness: 0.27 }),
    interior: () => S({ color: 0x343836, roughness: 0.9, side: THREE.BackSide }),
    window: () => P({ color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false }),
    display: () => P({ color: 0x0a0d0c, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
    print: () => S({ map: T.print, roughness: 0.55 }),
    ledG: () => S({ color: 0x0b2a16, emissive: 0x3dff8a, emissiveIntensity: 2.4, roughness: 0.3 }),
    ledA: () => S({ color: 0x2a1c05, emissive: 0xffb547, emissiveIntensity: 1.8, roughness: 0.3 }),
    coreGy: () => S({ map: T.gy, roughness: 0.42 }),
    topMcu: () => pcbTop(T.mcu), topEsp: () => pcbTop(T.esp), topSens: () => pcbTop(T.sens), topLink: () => pcbTop(T.link),
  };
}

/* ------------------------------------------------------------------ textures */
function canvasTex(c, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
/* print atlas for the SunGuard housing (140 px per unit): nose front 4.8 x 4.0 on top, two shoulder strips below */
function casePrintCanvas() {
  const k = 140, W = Math.round(4.9 * k), H = 661, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#CDD1CD'; g.fillRect(0, 0, W, H);
  const ink = '#2c302e', grey = '#6d726f';
  // nose front: canvas rows 0..553 (= v 108/661 .. 1)
  const fx = (u) => (u / 4.8 + 0.5) * W, fy = (v) => (0.5 - v / 4.0) * 553;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = grey; g.font = `700 ${0.16 * k}px ${FONT}`;
  [['PWR', -0.75], ['WI-FI', 0], ['LIMIT', 0.75]].forEach(([s, x]) => g.fillText(s, fx(x), fy(0.6)));
  // small "SunGuard" with a sun mark
  const sy = fy(-0.3), size = 0.5 * k;
  g.font = `800 ${size}px ${FONT}`;
  const tw = g.measureText('SunGuard').width, sx = W / 2 + 0.22 * k;
  g.fillStyle = '#253B33'; g.fillText('SunGuard', sx, sy);
  const cx = sx - tw / 2 - 0.3 * k;
  g.fillStyle = '#E39B2D'; g.beginPath(); g.arc(cx, sy, 0.1 * k, 0, 7); g.fill();
  g.strokeStyle = '#E39B2D'; g.lineWidth = 0.035 * k; g.lineCap = 'round';
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * 0.15 * k, sy + Math.sin(a) * 0.15 * k); g.lineTo(cx + Math.cos(a) * 0.21 * k, sy + Math.sin(a) * 0.21 * k); g.stroke(); }
  g.fillStyle = grey; g.font = `600 ${0.17 * k}px ${FONT}`;
  g.fillText('230 V~  50 Hz   \u00B7   IP20', W / 2, fy(-1.05));
  g.fillRect(W / 2 - 1.6 * k, fy(-0.82), 3.2 * k, 2);
  // shoulder strips (terminal marks): top strip rows 557..607, bottom strip rows 611..661
  g.fillStyle = ink; g.font = `800 ${0.22 * k}px ${FONT}`;
  const strip = (y0, marks) => marks.forEach((s, i) => g.fillText(s, ([-1.5, 0, 1.5][i] / 4.9 + 0.5) * W, y0 + 25));
  strip(557, ['L', 'N', '\u23DA']);
  strip(611, ['A', 'B', '\u22A5']);
  return c;
}
/* print for the circuit breakers (1.5 x 4.2 units) */
function mcbPrintCanvas() {
  const k = 140, W = Math.round(1.5 * k), H = Math.round(4.2 * k), c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#EDEDE9'; g.fillRect(0, 0, W, H);
  const fy = (v) => (0.5 - v / 4.2) * H;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#4a4e4c'; g.font = `800 ${0.2 * k}px ${FONT}`;
  g.fillText('I', W / 2, fy(1.48)); g.fillText('O', W / 2, fy(-0.36));
  g.fillStyle = '#c8372a'; g.fillRect(W / 2 - 0.26 * k, fy(-0.68) - 0.09 * k, 0.52 * k, 0.18 * k);   // contact indicator: ON
  g.strokeStyle = '#3a3d3c'; g.lineWidth = 3; g.strokeRect(W / 2 - 0.29 * k, fy(-0.68) - 0.12 * k, 0.58 * k, 0.24 * k);
  g.fillStyle = '#2b2e30'; g.font = `800 ${0.36 * k}px ${FONT}`; g.fillText('C16', W / 2, fy(-1.15));
  g.lineWidth = 2; g.strokeRect(W / 2 - 0.36 * k, fy(-1.6) - 0.12 * k, 0.72 * k, 0.24 * k);
  g.font = `700 ${0.15 * k}px ${FONT}`; g.fillText('6000', W / 2, fy(-1.6));
  g.fillStyle = '#6d726f'; g.font = `600 ${0.12 * k}px ${FONT}`; g.fillText('230/400 V~', W / 2, fy(-1.9));
  return c;
}
function psuPrintCanvas() {
  const W = 680, H = 400, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#1c1d1e'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(236,236,230,.86)'; g.textBaseline = 'middle';
  g.font = `800 64px ${FONT}`; g.fillText('AC → DC', 48, 92);
  g.font = `700 38px ${FONT}`; g.fillText('IN  100–240 V~  50/60 Hz', 48, 190);
  g.fillText('OUT  5 V ⎓  0.6 A  3 W', 48, 250);
  g.fillRect(48, 300, 584, 4);
  g.font = `600 30px ${FONT}`; g.fillStyle = 'rgba(236,236,230,.6)'; g.fillText('isolated  ·  3 kV', 48, 345);
  return c;
}
function stripeCanvas() {
  const W = 64, H = 64, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#2f9a3c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8d22c';
  for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 16, 0); g.lineTo(i * 32 + 16 + 32, H); g.lineTo(i * 32 + 32, H); g.fill(); }
  return c;
}

/* ------------------------------------------------------------------ components (board top at z0, local XY) */
function placer(A, x, y, rot) { // local → board coords for artwork (rot multiple of 90°)
  const c = Math.round(Math.cos(rot)), s = Math.round(Math.sin(rot));
  return {
    p: (lx, ly) => [x + lx * c - ly * s, y + lx * s + ly * c],
    pad: (lx, ly, w, h, round) => { if (!A) return; const [px, py] = [x + lx * c - ly * s, y + lx * s + ly * c]; A.pad(px, py, s ? h : w, s ? w : h, round); },
    rect: (lx, ly, w, h) => { if (!A) return; const [px, py] = [x + lx * c - ly * s, y + lx * s + ly * c]; A.srect(px, py, s ? h : w, s ? w : h); },
    dot: (lx, ly, r) => { if (!A) return; const [px, py] = [x + lx * c - ly * s, y + lx * s + ly * c]; A.sdot(px, py, r); },
  };
}
function chip(B, A, x, y, rot, z0, kind = 'cap') {
  const L = 0.2, W = 0.125, H = kind === 'cap' ? 0.08 : 0.05, e = 0.034;
  B.push(x, y, z0, 0, 0, rot);
  B.put(kind === 'cap' ? 'ceramic' : 'black', box(L - 2 * e + 0.004, W * 0.97, H), 0, 0, H / 2);
  B.put('tin', box(e, W, H + 0.004), -(L / 2 - e / 2), 0, H / 2 + 0.002);
  B.put('tin', box(e, W, H + 0.004), L / 2 - e / 2, 0, H / 2 + 0.002);
  B.pop();
  const P = placer(A, x, y, rot); P.pad(-0.085, 0, 0.08, 0.15); P.pad(0.085, 0, 0.08, 0.15);
}
function soic8(B, A, x, y, rot, z0) {
  B.push(x, y, z0, 0, 0, rot);
  B.put('epoxy', rbox(0.49, 0.39, 0.15, 0.012), 0, 0, 0.03 + 0.075);
  for (let i = 0; i < 4; i++) {
    const px = -0.1905 + i * 0.127;
    for (const s of [-1, 1]) {
      B.put('tin', box(0.042, 0.075, 0.018), px, s * 0.272, 0.009);
      B.put('tin', box(0.042, 0.018, 0.075), px, s * 0.236, 0.05);
      B.put('tin', box(0.042, 0.05, 0.018), px, s * 0.212, 0.09);
    }
  }
  B.put('mark', cylZ(0.028, 0.006, 14), -0.17, -0.1, 0.181);
  B.pop();
  const P = placer(A, x, y, rot);
  for (let i = 0; i < 4; i++) { const px = -0.1905 + i * 0.127; P.pad(px, 0.275, 0.07, 0.13); P.pad(px, -0.275, 0.07, 0.13); }
  P.dot(-0.3, -0.36, 0.03);
}
function header(B, A, x, y, n, rot, z0, up = 0.55) { // row along local x, pins up (+z)
  const p = 0.254, L = n * p;
  B.push(x, y, z0, 0, 0, rot);
  B.put('black', rbox(L - 0.01, 0.25, 0.25, 0.025), 0, 0, 0.125);
  for (let i = 0; i < n; i++) {
    const px = -L / 2 + p / 2 + i * p;
    B.put('gold', box(0.064, 0.064, up + 0.25 - 0.03), px, 0, (up + 0.25 - 0.03) / 2);
    B.put('gold', box(0.04, 0.04, 0.03), px, 0, up + 0.25 - 0.015);
    if (i) B.put('dark', box(0.012, 0.252, 0.06), px - p / 2, 0, 0.222);
  }
  B.pop();
  const P = placer(A, x, y, rot);
  for (let i = 0; i < n; i++) P.pad(-L / 2 + p / 2 + i * p, 0, 0.16, 0.16, true);
  P.rect(0, 0, L + 0.04, 0.29);
}
function terminal(B, A, x, y, n, rot, z0, key) { // poles along local y, wire entries face −x
  const p = 0.5, D = 0.76, H = 0.95, L = n * p;
  B.push(x, y, z0, 0, 0, rot);
  B.put(key, rbox(D, L - 0.004, 0.6, 0.035), 0, 0, 0.3);
  B.put(key, rbox(D * 0.74, L - 0.004, 0.42, 0.035), D * 0.13, 0, 0.6 + 0.19);
  for (let i = 0; i < n; i++) {
    const py = -L / 2 + p / 2 + i * p;
    B.put('dark', cylZ(0.16, 0.02, 22), D * 0.13, py, H - 0.004);
    B.put('steel', cylZ(0.135, 0.06, 22), D * 0.13, py, H - 0.03);
    B.put('dark', box(0.05, 0.25, 0.012), D * 0.13, py, H + 0.001, 0, 0, 0.5);
    B.put('dark', rbox(0.03, 0.32, 0.3, 0.01), -D / 2 - 0.004, py, 0.3);
    B.put('steel', box(0.02, 0.26, 0.07), -D / 2 - 0.008, py, 0.22);
    if (i) B.put(key, box(0.08, 0.04, 0.5), -D / 2 - 0.03, py - p / 2, 0.3);
  }
  B.pop();
  const P = placer(A, x, y, rot);
  P.rect(0, 0, D + 0.06, L + 0.06);
}
function tact(B, x, y, z0) {
  B.put('black', box(0.36, 0.36, 0.1), x, y, z0 + 0.05);
  B.put('nickel', box(0.34, 0.34, 0.02), x, y, z0 + 0.11);
  B.put('black', cylZ(0.085, 0.08, 18), x, y, z0 + 0.15);
}
function led(B, A, x, y, rot, z0, key) {
  B.push(x, y, z0, 0, 0, rot);
  B.put(key, box(0.11, 0.085, 0.06), 0, 0, 0.03);
  B.put('tin', box(0.03, 0.085, 0.05), -0.07, 0, 0.025); B.put('tin', box(0.03, 0.085, 0.05), 0.07, 0, 0.025);
  B.pop();
  const P = placer(A, x, y, rot); P.pad(-0.07, 0, 0.06, 0.11); P.pad(0.07, 0, 0.06, 0.11);
}

/* ------------------------------------------------------------------ parts */
const T_PCB = 0.16;   // 1 unit = 10 mm

function boardBase(B, w, h, top, side, r = 0.06) {
  B.put(side, rbox(w, h, T_PCB, r, 2), 0, 0, T_PCB / 2);
  B.put(top, rrPlane(w - 0.004, h - 0.004, r), 0, 0, T_PCB + 0.0015);
}

/* 1. microcontroller with radio: green carrier + black radio module with shield can + PCB antenna */
function buildMcu() {
  const B = new Bld(), w = 4.6, h = 2.6, z0 = T_PCB;
  const A = new PcbArt(w, h, 125, PCB.mcu);
  const R = mulberry(27);
  boardBase(B, w, h, 'topMcu', 'sideMcu');
  // pin header rows along both long edges
  const rowY = 1.1, n = 16, x0 = -(n * 0.254) / 2 + 0.127;
  header(B, A, 0, rowY, n, 0, z0); header(B, A, 0, -rowY, n, 0, z0);
  const names = ['GND', '3V3', 'EN', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'RX', 'TX', 'SDA', 'SCL', '5V', 'GND'];
  for (let i = 0; i < n; i++) { A.text(names[i], x0 + i * 0.254, 0.86, 0.062); A.text(names[n - 1 - i], x0 + i * 0.254, -0.86, 0.062); }
  // radio module (PCB antenna at the right edge)
  const mw = 2.55, mh = 1.8, mt = 0.08, mx = w / 2 - mw / 2 + 0.05;
  B.push(mx, 0, z0);
  B.put('sideEsp', rbox(mw, mh, mt, 0.02), 0, 0, mt / 2);
  B.put('topEsp', rrPlane(mw - 0.004, mh - 0.004, 0.02), 0, 0, mt + 0.0012);
  const sx = -mw / 2 + 0.06 + 0.86;
  B.put('nickel', rbox(1.76, 1.68, 0.04, 0.012), sx, 0, mt + 0.02);
  B.put('nickel', rbox(1.72, 1.62, 0.3, 0.04, 3), sx, 0, mt + 0.16);
  B.put('nickel', rbox(1.5, 1.4, 0.012, 0.05, 2), sx, 0, mt + 0.312);   // stamped lid step
  B.pop();
  for (let i = 0; i < 12; i++) { const px = mx - mw / 2 + 0.25 + i * 0.127; A.pad(px, 0.93, 0.07, 0.1); A.pad(px, -0.93, 0.07, 0.1); }
  // USB-C at the left edge
  const ux = -w / 2 + 0.36;
  B.put('nickel', rbox(0.75, 0.9, 0.32, 0.13, 3), ux, 0, z0 + 0.165);
  B.put('dark', rbox(0.03, 0.72, 0.17, 0.07), ux - 0.375, 0, z0 + 0.165);
  B.put('black', box(0.03, 0.46, 0.05), ux - 0.37, 0, z0 + 0.165);
  A.pad(ux + 0.1, 0.52, 0.3, 0.12); A.pad(ux + 0.1, -0.52, 0.3, 0.12);
  // buttons, regulator, USB-UART, LEDs
  tact(B, -1.28, 0.45, z0); tact(B, -1.28, -0.45, z0);
  A.srect(-1.28, 0.45, 0.42, 0.42); A.srect(-1.28, -0.45, 0.42, 0.42);
  A.text('BOOT', -1.28, 0.13, 0.062); A.text('RST', -1.28, -0.13, 0.062);
  B.put('epoxy', rbox(0.62, 0.34, 0.15, 0.012), -0.66, 0.45, z0 + 0.1);
  B.put('tin', box(0.3, 0.1, 0.02), -0.66, 0.68, z0 + 0.01);
  for (const lx of [-0.21, 0, 0.21]) B.put('tin', box(0.045, 0.12, 0.018), -0.66 + lx, 0.23, z0 + 0.009);
  A.pad(-0.66, 0.69, 0.36, 0.14); A.srect(-0.66, 0.47, 0.74, 0.62);
  B.put('epoxy', rbox(0.4, 0.4, 0.08, 0.01), -0.66, -0.42, z0 + 0.045);
  for (let i = 0; i < 4; i++) { A.pad(-0.81 + i * 0.1, -0.2, 0.05, 0.07); A.pad(-0.81 + i * 0.1, -0.64, 0.05, 0.07); }
  A.sdot(-0.91, -0.18, 0.025);
  led(B, A, -0.32, 0.72, 0, z0, 'ledG'); led(B, A, -0.32, -0.72, 0, z0, 'ledA');
  // passives
  const caps = [[-1.72, 0.74, 0], [-1.72, -0.74, 0], [-1.0, -0.78, 0], [-0.34, -0.12, 1], [-0.34, 0.22, 1], [-0.98, 0.0, 0], [-1.0, 0.78, 0]];
  caps.forEach(([cx, cy, r], i) => chip(B, A, cx, cy, r ? Math.PI / 2 : 0, z0, i % 3 === 1 ? 'res' : 'cap'));
  // traces: header pins -> module pads / parts / vias
  for (let i = 0; i < n; i++) {
    const px = x0 + i * 0.254;
    for (const sgn of [1, -1]) {
      const a = [px, sgn * rowY];
      const j = Math.round((px - (mx - mw / 2 + 0.25)) / 0.127);
      if (px > -0.1 && j >= 0 && j < 12) A.route(a, [mx - mw / 2 + 0.25 + j * 0.127, sgn * 0.93], 0.026);
      else if (px <= -0.1 && R() > 0.25) {
        const tx = clamp(px + (R() - 0.5) * 0.4, -2.0, -0.3), ty = sgn * (0.5 + R() * 0.28);
        A.route(a, [tx, ty], 0.026); A.via(tx, ty);
      }
    }
  }
  A.route([ux + 0.1, 0.52], [-1.72, 0.74], 0.05); A.route([ux + 0.1, -0.52], [-1.72, -0.74], 0.05);
  A.route([-0.66, 0.69], [-0.34, 0.22], 0.05); A.route([-0.34, -0.12], [-0.66, -0.2], 0.03);
  for (let i = 0; i < 16; i++) A.via(-2.1 + R() * 1.8, (R() - 0.5) * 1.6);
  return { B, art: A, key: 'mcu' };
}
function espArt() {
  const A = new PcbArt(2.55, 1.8, 160, PCB.esp);
  for (let i = 0; i < 12; i++) { const px = -2.55 / 2 + 0.25 + i * 0.127; A.pad(px, 0.88, 0.07, 0.07, true); A.pad(px, -0.88, 0.07, 0.07, true); }
  A.extra.push((g, q, a) => { // printed meander antenna (copper under black mask)
    const x0 = a.X(2.55 / 2 - 0.6), x1 = a.X(2.55 / 2 - 0.06), yTop = a.Y(0.78), yBot = a.Y(-0.62);
    for (const [ctx, col] of [[g, '#5c4d2c'], [q, 'rgb(80,70,90)']]) {
      ctx.strokeStyle = col; ctx.lineWidth = a.k * 0.045; ctx.lineJoin = 'miter'; ctx.beginPath();
      let x = x0 + a.k * 0.05; ctx.moveTo(x, yBot); const step = (x1 - x0 - a.k * 0.1) / 7;
      for (let i = 0; i < 7; i++) { ctx.lineTo(x, yTop); x += step / 2; ctx.lineTo(x, yTop); ctx.lineTo(x, yTop + (yBot - yTop) * 0.7); x += step / 2; ctx.lineTo(x, yTop + (yBot - yTop) * 0.7); }
      ctx.stroke();
    }
    g.strokeStyle = 'rgba(217,219,214,.85)'; g.lineWidth = a.k * 0.014; g.strokeRect(x0 - a.k * 0.03, yTop - a.k * 0.06, x1 - x0 + a.k * 0.06, yBot - yTop + a.k * 0.12);
  });
  return A;
}

/* 2. voltage sensor: blue board, small voltage transformer, trimmer, op-amp, 2-pin screw terminal */
function buildSens() {
  const B = new Bld(), w = 4.6, h = 1.95, z0 = T_PCB;
  const A = new PcbArt(w, h, 130, PCB.sens);
  boardBase(B, w, h, 'topSens', 'sideSens');
  terminal(B, A, -w / 2 + 0.42, 0, 2, 0, z0, 'blueTerm');
  A.text('~230 V', -w / 2 + 0.42, 0.78, 0.09);
  // transformer (glossy black, flanged)
  const tx = -0.45;
  B.put('black', rbox(1.9, 1.62, 0.16, 0.04), tx, 0, z0 + 0.08);
  B.put('gloss', rbox(1.74, 1.46, 1.08, 0.12, 3), tx, 0, z0 + 0.16 + 0.54);
  B.put('black', rbox(1.79, 1.51, 0.07, 0.035), tx, 0, z0 + 0.16 + 0.78);
  B.put('mark', cylZ(0.06, 0.006, 14), tx - 0.62, 0.5, z0 + 1.243);
  A.srect(tx, 0, 2.0, 1.72);
  // trimmer + op-amp + passives + 4-pin header
  B.put('trim', rbox(0.95, 0.48, 0.9, 0.04), 1.03, 0.47, z0 + 0.45);
  B.put('brass', cylZ(0.11, 0.07, 20), 1.35, 0.47, z0 + 0.92);
  B.put('dark', box(0.03, 0.18, 0.012), 1.35, 0.47, z0 + 0.951);
  A.srect(1.03, 0.47, 1.0, 0.53);
  soic8(B, A, 1.0, -0.47, 0, z0);
  const ps = [[1.6, 0.55, 1], [1.6, 0.2, 1], [1.6, -0.2, 1], [1.6, -0.6, 1], [0.6, -0.72, 1]];
  ps.forEach(([cx, cy, r], i) => chip(B, A, cx, cy, r ? Math.PI / 2 : 0, z0, i % 2 ? 'cap' : 'res'));
  const hx = w / 2 - 0.25;
  header(B, A, hx, 0, 4, Math.PI / 2, z0, 0.45);
  ['VCC', 'OUT', 'GND', 'GND'].forEach((s, i) => A.text(s, 1.8, 0.381 - i * 0.254, 0.06));
  // traces
  A.route([-w / 2 + 0.6, 0.25], [tx - 0.85, 0.55], 0.09); A.route([-w / 2 + 0.6, -0.25], [tx - 0.85, -0.55], 0.09);
  A.route([tx + 0.85, -0.5], [0.6, -0.62], 0.04); A.route([0.6, -0.82], [0.81, -0.75], 0.03);
  A.route([1.19, -0.2], [1.6, 0.1], 0.03); A.route([1.19, -0.75], [1.6, -0.7], 0.03);
  A.route([1.6, 0.65], [hx, 0.381], 0.035); A.route([1.6, 0.1], [hx, 0.127], 0.03);
  A.route([1.6, -0.3], [hx, -0.127], 0.035); A.route([1.6, -0.7], [hx, -0.381], 0.035);
  A.hole(-w / 2 + 0.2, 0.78, 0.07);
  [[0.62, 0.1], [0.62, -0.3], [1.35, -0.9], [1.85, 0.85]].forEach(([x, y]) => A.via(x, y));
  return { B, art: A, key: 'sens' };
}

/* 3. link to the inverter: red RS-485 board, 8-pin chip, green 2-pin screw terminal */
function buildLink() {
  const B = new Bld(), w = 4.4, h = 1.4, z0 = T_PCB;
  const A = new PcbArt(w, h, 140, PCB.link);
  boardBase(B, w, h, 'topLink', 'sideLink');
  terminal(B, A, -w / 2 + 0.42, 0, 2, 0, z0, 'greenTerm');
  A.text('A', -w / 2 + 0.95, 0.25, 0.11); A.text('B', -w / 2 + 0.95, -0.25, 0.11);
  soic8(B, A, -0.25, 0.05, 0, z0);
  const ps = [[0.42, 0.42, 0], [0.42, -0.36, 0], [0.82, 0.42, 0], [0.82, -0.36, 0], [1.22, 0.42, 0], [1.22, -0.36, 0], [-0.9, 0.5, 0], [-0.9, -0.48, 0]];
  ps.forEach(([cx, cy, r], i) => chip(B, A, cx, cy, r, z0, i % 2 ? 'cap' : 'res'));
  led(B, A, 0.82, 0.04, 0, z0, 'ledG');
  header(B, A, w / 2 - 0.28, 0, 4, Math.PI / 2, z0, 0.45);
  ['RO', 'RE', 'DE', 'DI'].forEach((s, i) => A.text(s, w / 2 - 0.58, 0.381 - i * 0.254, 0.075));
  A.route([-w / 2 + 0.6, 0.25], [-0.44, 0.33], 0.05); A.route([-w / 2 + 0.6, -0.25], [-0.31, -0.23], 0.05);
  A.route([-0.06, 0.33], [0.42, 0.52], 0.03); A.route([0.07, 0.33], [0.82, 0.52], 0.03);
  A.route([0.07, -0.23], [1.22, -0.46], 0.03); A.route([1.32, 0.42], [w / 2 - 0.28, 0.381], 0.03);
  A.route([1.32, -0.36], [w / 2 - 0.28, -0.381], 0.03); A.route([0.92, 0.04], [w / 2 - 0.28, 0.127], 0.03);
  A.route([0.5, -0.36], [w / 2 - 0.28, -0.127], 0.03);
  A.hole(1.55, 0.47, 0.07); A.hole(1.55, -0.47, 0.07);
  [[-0.9, 0.05], [0.25, 0.0], [1.0, -0.05]].forEach(([x, y]) => A.via(x, y));
  return { B, art: A, key: 'link' };
}

/* 4. power supply 230 V → 5 V: black encapsulated module, 4 pins */
function buildPsu() {
  const B = new Bld();
  B.put('psu', rbox(3.4, 2.0, 1.5, 0.12, 3), 0, 0, 0.75);
  B.put('print', rrPlane(3.0, 1.62, 0.06), 0, 0.02, 1.5015);
  B.put('psu', rbox(3.3, 0.06, 1.4, 0.02), 0, -1.0, 0.75);           // moulding step on the pin side
  for (const x of [-1.4, 1.4]) for (const z of [0.5, 1.0]) {
    B.put('tin', box(0.09, 0.55, 0.09), x, -1.0 - 0.27, z);
    B.put('tin', cylY(0.08, 0.06, 12), x, -1.03, z);
  }
  return { B, art: null, key: 'psu' };
}

/* 5. DIN-rail case: slim 3-module modular housing (53 x 90 x 60 mm, DIN 43880 stepped profile, RAL 7035) */
const CASE = { w: 5.3, h: 9.0, dBody: 4.4, nose: 4.5, dNose: 1.6, hole: [4.7, 4.1], ty: 3.4, tx: [-1.5, 0, 1.5] };
// plane with a UV sub-rectangle of a texture atlas (u0,v0 = bottom-left)
function uvPlane(w, h, u0, v0, u1, v1) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)));
  return g;
}
/* body of a modular device (shoulders full height, optional central opening): round screw-terminal holes in the
   shoulders with the screws ~9 mm deep, wire entries on top/bottom, side rivets, DIN latch */
function modularBody(B, key, w, termX, opening) {
  const C = CASE, bt = 0.1;
  const sh = rrShape(w - 2 * bt, C.h - 2 * bt, 0.3);
  if (opening) sh.holes.push(rrShape(opening[0] + 2 * bt, opening[1] + 2 * bt, 0.2, THREE.Path));
  for (const sy of [1, -1]) for (const x of termX) { const hp = new THREE.Path(); hp.absarc(x, sy * C.ty, 0.3 + bt, 0, Math.PI * 2, true); sh.holes.push(hp); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: C.dBody - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, bt);
  B.put(key, g);
  for (const sy of [1, -1]) for (const x of termX) {
    const y = sy * C.ty, zf = C.dBody;
    B.put('hole', new THREE.CylinderGeometry(0.285, 0.285, 1.25, 24, 1, true).rotateX(Math.PI / 2), x, y, zf - 0.625);
    B.put('dark', cylZ(0.3, 0.02, 24), x, y, zf - 1.25);
    B.put('steel', cylZ(0.235, 0.1, 24), x, y, zf - 0.95);
    B.put('dark', box(0.34, 0.05, 0.02), x, y, zf - 0.9); B.put('dark', box(0.05, 0.34, 0.02), x, y, zf - 0.9);
    B.put('dark', rbox(0.56, 0.04, 0.46, 0.06), x, sy * C.h / 2, 3.0);           // wire entry
    B.put('copper', box(0.32, 0.03, 0.18), x, sy * (C.h / 2 - 0.025), 3.0);
  }
  for (const sx of [-1, 1]) for (const [y, z] of [[2.95, 1.6], [-2.95, 1.6]]) {   // housing rivets
    B.put('steel', cylZ(0.17, 0.04, 20).rotateY(Math.PI / 2), sx * w / 2, y, z);
    B.put('dark', cylZ(0.07, 0.045, 14).rotateY(Math.PI / 2), sx * w / 2, y, z);
  }
  B.put('latch', rbox(Math.min(1.4, w * 0.55), 0.9, 0.42, 0.06), 0, -C.h / 2 - 0.12, 0.23);  // DIN latch
  B.put('dark', rbox(Math.min(0.5, w * 0.25), 0.04, 0.2, 0.02), 0, -C.h / 2 - 0.57, 0.23);
}
/* TS35 x 7.5 rail section from x0 to x1 (slotted) */
function dinRail(B, x0, x1, slots) {
  const L = x1 - x0, cx = (x0 + x1) / 2;
  for (const sy of [1, -1]) {
    B.put('zinc', box(L, 0.42, 0.1), cx, sy * 1.54, -0.05);
    B.put('zinc', box(L, 0.1, 0.75), cx, sy * 1.3, -0.375);
  }
  B.put('zinc', box(L, 2.7, 0.1), cx, 0, -0.7);
  for (const x of slots) B.put('dark', rbox(0.95, 0.62, 0.02, 0.3), x, 0, -0.645);
}
function buildCase() {
  const B = new Bld(), C = CASE;
  modularBody(B, 'case', C.w, C.tx, C.hole);
  B.put('case', box(C.hole[0] + 0.1, C.hole[1] + 0.1, 0.34), 0, 0, 0.17);                      // back wall (behind the liner)
  B.put('interior', box(C.hole[0] - 0.12, C.hole[1] - 0.12, 4.0), 0, 0, 0.4 + 2.0);            // dark inner liner (gap: no z-fight)
  // printed terminal marks above / below the screws (atlas strips)
  B.put('casePrint', uvPlane(4.9, 0.36, 0, 54 / 661, 1, 104 / 661), 0, 4.12, C.dBody + 0.0015);
  B.put('casePrint', uvPlane(4.9, 0.36, 0, 0, 1, 50 / 661), 0, -4.12, C.dBody + 0.0015);
  dinRail(B, -3.9, 3.4, [-3.3]);
  // 3-core cable stub into the top terminals
  const top = C.h / 2, ez = 3.0;
  const cores = [['coreBn', -1.5], ['coreBu', 0], ['coreGy', 1.5]];
  const sheathEnd = new THREE.Vector3(-0.15, top + 1.05, 1.75);
  for (const [key, x] of cores) {
    const c = new THREE.CubicBezierCurve3(new THREE.Vector3(x, top - 0.1, ez), new THREE.Vector3(x, top + 0.6, ez),
      new THREE.Vector3(sheathEnd.x + x * 0.12, sheathEnd.y - 0.55, sheathEnd.z + 0.15), new THREE.Vector3(sheathEnd.x + x * 0.08, sheathEnd.y + 0.05, sheathEnd.z));
    B.put(key, new THREE.TubeGeometry(c, 28, 0.15, 12, false));
  }
  const sc = new THREE.CubicBezierCurve3(sheathEnd.clone(), new THREE.Vector3(-0.15, top + 1.75, 1.65),
    new THREE.Vector3(-0.25, top + 1.95, 0.5), new THREE.Vector3(-0.35, top + 1.95, -1.6));
  B.put('sheath', new THREE.TubeGeometry(sc, 30, 0.42, 20, false));
  B.put('sheath', cylY(0.42, 0.02, 20), sheathEnd.x, sheathEnd.y, sheathEnd.z);
  return { B, art: null, key: 'case' };
}
/* the removable front ("nose", 45 mm): small smoked window with 3 LEDs, small printed "SunGuard" */
function buildFace() {
  const B = new Bld(), C = CASE;
  B.put('case', rbox(C.w, C.nose, C.dNose, 0.2, 3), 0, 0, C.dNose / 2);
  B.put('casePrint', uvPlane(4.8, 4.0, 0, 108 / 661, 1, 1), 0, 0, C.dNose + 0.0015);
  B.put('display', rrPlane(2.5, 0.7, 0.14), 0, 1.15, C.dNose + 0.003);
  B.put('window', rbox(2.6, 0.8, 0.05, 0.1), 0, 1.15, C.dNose + 0.02);
  B.put('ledG', cylZ(0.075, 0.03, 18), -0.75, 1.15, C.dNose + 0.012);
  B.put('ledG', cylZ(0.075, 0.03, 18), 0, 1.15, C.dNose + 0.012);
  B.put('ledA', cylZ(0.075, 0.03, 18), 0.75, 1.15, C.dNose + 0.012);
  return { B, art: null, key: 'face' };
}
/* context for scale: two 1-module miniature circuit breakers on the same rail (no brand); fade out when exploding */
function buildCtx() {
  const B = new Bld(), C = CASE, mw = 1.78, top = C.h / 2;
  for (const x of [C.w / 2 + 0.02 + mw / 2, C.w / 2 + 0.04 + mw * 1.5]) {        // right of SunGuard (behind it from the camera)
    B.push(x, 0, 0);
    modularBody(B, 'mcb', mw, [0], null);
    B.put('mcb', rbox(mw, C.nose, C.dNose, 0.18, 3), 0, 0, C.dBody + C.dNose / 2);
    B.put('mcbPrint', uvPlane(1.5, 4.2, 0, 0, 1, 1), 0, 0, C.dBody + C.dNose + 0.0015);
    B.put('dark', rbox(0.8, 1.3, 0.03, 0.1), 0, 0.55, C.dBody + C.dNose + 0.004);       // lever slot
    B.push(0, 0.38, C.dBody + C.dNose, -0.4, 0, 0);
    B.put('lever', rbox(0.62, 0.42, 1.05, 0.1, 2), 0, 0, 0.38);                          // toggle in ON (up)
    B.pop();
    const wc = new THREE.CubicBezierCurve3(new THREE.Vector3(0, top - 0.1, 3.0), new THREE.Vector3(0, top + 0.9, 3.0),
      new THREE.Vector3(0, top + 1.6, 2.2), new THREE.Vector3(0, top + 1.7, -0.8));
    B.put('coreBn', new THREE.TubeGeometry(wc, 24, 0.15, 12, false));
    B.pop();
  }
  dinRail(B, 3.4, 7.4, [6.95]);
  return { B, art: null, key: 'ctx' };
}

/* ------------------------------------------------------------------ layout (device-local; front = +Z) */
// a: assembled pose (device-local), e: exploded pose (device-local) or ew: exploded position in WORLD axes relative to
// the case origin (x → screen right, y up, z → camera), converted with the device yaw at init so the exploded row is
// parallel to the screen; out: z the part slides to first (clear of the case front at 5.6), then a smooth curve to e.
// w: [start, end] in the explode timeline (front-most part leaves first); lab: label index
const LAYOUT = {
  case: { a: [0, 0, 0, 0, 0, 0], e: [0, 0, 0, 0, 0, 0], w: [0, 1], lab: 4 },
  ctx: { a: [0, 0, 0, 0, 0, 0], e: [0, 0, 0, 0, 0, 0], w: [0, 1], lab: -1, ctx: true },
  face: { a: [0, 0, 4.4, 0, 0, 0], e: [0.25, 4.95, 6.0, -8, -16, 0], out: 4.75, w: [0, 0.42], lab: 4 },
  mcu: { a: [0, 0.25, 3.4, 0, 0, 0], ew: [17.0, 2.0, 3.0], r: [4, -18, 0], out: 4.6, w: [0.24, 0.8], lab: 0 },
  link: { a: [0, -1.1, 1.8, 0, 0, 0], ew: [13.6, -2.55, 3.0], r: [4, -18, 0], out: 4.6, w: [0.32, 0.86], lab: 2 },
  sens: { a: [0, 0.6, 1.8, 0, 0, 0], ew: [10.0, 2.2, 3.0], r: [4, -18, 0], out: 4.6, w: [0.4, 0.93], lab: 1 },
  psu: { a: [0, -0.25, 0.2, 0, 0, 0], ew: [6.4, -2.45, 3.0], r: [4, -18, 0], out: 4.6, w: [0.47, 1], lab: 3 },
};
const CTX_C = new THREE.Vector3(0, 0, 2.2);                      // the context collapses here in the camera fit while fading
const ctxFade = (t) => 1 - smooth(0.02, 0.3, t);
function resolveLayout(yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const L of Object.values(LAYOUT)) {
    if (L.ew) { const [X, Y, Z] = L.ew; L.e = [X * c - Z * s, Y, X * s + Z * c, L.r[0], L.r[1], L.r[2]]; }
    if (L.out != null) {
      const B = [L.a[0], L.a[1], L.out], len1 = Math.max(0, L.out - L.a[2]);
      const len2 = Math.hypot(L.e[0] - B[0], L.e[1] - B[1], L.e[2] - B[2]);
      L.k = Math.min(2.4, 0.35 * len2);               // control point: keep heading out of the case a bit longer
      L.q = clamp(len1 / (len1 + len2 + 1e-6), 0.12, 0.4);
    }
  }
}
/* label anchors (part-local) and lane: +1 = above, −1 = below */
const ANCHOR = [
  { part: 'mcu', p: [0.2, 1.23, 0.45], lane: 1 },
  { part: 'sens', p: [-0.45, 0.74, 1.3], lane: 1 },
  { part: 'link', p: [-0.4, -0.7, 0.18], lane: -1 },
  { part: 'psu', p: [0.0, -1.0, 1.25], lane: -1 },
  { part: 'case', p: [-1.2, 4.5, 2.0], lane: 1 },
];

/* ------------------------------------------------------------------ the viewer */
const CSS = `
.p3d-root{position:absolute;inset:0;pointer-events:none;overflow:visible}
.p3d-canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block}
.p3d-ov{position:absolute;inset:0;pointer-events:none}
.p3d-lines{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.p3d-lines line{stroke:var(--p3d-line);stroke-width:2;transition:opacity .35s}
.p3d-lines circle{fill:var(--p3d-ink);stroke:var(--p3d-halo);stroke-width:3;transition:opacity .35s}
.p3d-lab{position:absolute;left:0;top:0;white-space:nowrap;font-family:var(--p3d-font);font-size:var(--p3d-fs);font-weight:700;
  line-height:1.15;letter-spacing:-.012em;color:var(--p3d-ink);padding:.12em .46em;border-radius:.55em;
  text-shadow:0 2px 16px var(--p3d-shadow);transition:opacity .35s,background-color .35s,color .35s;will-change:transform,opacity}
.p3d-lab.hl{background:var(--p3d-ink);color:var(--p3d-bg-ink);text-shadow:none}
.p3d-cap{position:absolute;left:50%;bottom:3.5%;transform:translateX(-50%);font-family:var(--p3d-font);font-size:calc(var(--p3d-fs) * 1.06);
  font-weight:800;color:var(--p3d-ink);letter-spacing:-.01em;text-shadow:0 2px 16px var(--p3d-shadow);white-space:nowrap}
.p3d-cap:empty{display:none}
`;
const THEMES = {
  dark: { ink: '#F4F1E8', line: 'rgba(244,241,232,.72)', halo: 'rgba(14,26,21,.85)', shadow: 'rgba(0,0,0,.55)', bgInk: '#253B33' },
  light: { ink: '#253B33', line: 'rgba(37,59,51,.7)', halo: 'rgba(255,255,255,.9)', shadow: 'rgba(255,255,255,.6)', bgInk: '#F4F1E8' },
};

let V = null;           // current viewer
let initPromise = null;
let _rmq = null;
const reduceMotion = () => { try { if (!_rmq) _rmq = matchMedia('(prefers-reduced-motion: reduce)'); return _rmq.matches; } catch (e) { return false; } };

function fail(msg, err) {
  window.Parts3DFailed = true;
  try { console.info('[parts3d] 2D fallback:', msg, err && err.message ? err.message : ''); } catch (e) { /* */ }
  try { if (V && V.el) V.el.dispatchEvent(new CustomEvent('parts3d:failed', { detail: { reason: msg } })); } catch (e) { /* */ }
  if (V && V.opts && typeof V.opts.onFail === 'function') { try { V.opts.onFail(msg); } catch (e) { /* */ } }
  teardown();
}

async function init(el, opts = {}) {
  if (!WEBGL2) { window.Parts3DFailed = true; console.info('[parts3d] no WebGL2 → 2D'); return false; }
  if (!el || !(el instanceof Element)) { console.info('[parts3d] init: no container'); return false; }
  if (V && V.el === el && initPromise) return initPromise;
  if (V) teardown();
  initPromise = build(el, opts).catch((e) => { fail('init failed', e); return false; });
  return initPromise;
}

async function build(el, opts) {
  const o = Object.assign({ background: 'transparent', labels: true, labelPx: 34, theme: 'dark', dprCap: 1.5, idle: true,
    exploded: false, active: true, caption: '', floorGlow: true }, opts);
  const v = V = {
    el, opts: o, active: !!o.active, labelsOn: !!o.labels, t: o.exploded ? 1 : 0, tFrom: 0, tTo: o.exploded ? 1 : 0, tStart: 0, tDur: 0,
    hTarget: -1, h: [0, 0, 0, 0, 0], dim: {}, raf: 0, last: 0, clock: 0, frames: 0, fpsT: 0, fps: 0, pr: 1, prScale: 1,
    labF: o.labels ? 1 : 0, capF: o.caption ? 1 : 0,
    shadowDirty: true, dead: false, resolveAnim: null, size: [0, 0], lastLayout: '',
  };
  if (getComputedStyle(el).position === 'static') { el.style.position = 'relative'; v.setPos = true; }
  if (!document.getElementById('p3d-css')) { const s = document.createElement('style'); s.id = 'p3d-css'; s.textContent = CSS; document.head.appendChild(s); }

  // fonts for printed textures (label on the case, PSU print); never block longer than ~0.9 s
  try { await Promise.race([Promise.all([document.fonts.load(`800 112px 'Plus Jakarta Sans'`), document.fonts.load(`700 34px 'Plus Jakarta Sans'`)]), new Promise((r) => setTimeout(r, 900))]); } catch (e) { /* */ }
  if (v !== V) return false;

  const root = v.root = document.createElement('div'); root.className = 'p3d-root';
  const cv = v.canvas = document.createElement('canvas'); cv.className = 'p3d-canvas';
  root.appendChild(cv); el.appendChild(root);

  const renderer = v.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) throw new Error('not WebGL2');
  renderer.debug.checkShaderErrors = !!o.debug;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setBackground(o.background);
  v.onLost = (e) => { e.preventDefault(); if (!v.dead) fail('WebGL context lost'); };
  cv.addEventListener('webglcontextlost', v.onLost, false);

  const scene = v.scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  v.env = pmrem.fromScene(room, 0.04).texture;
  room.dispose(); pmrem.dispose();

  // lights: warm key (shadows), cool fill, rim from behind
  const key = new THREE.DirectionalLight(0xfff1e0, 2.9);
  key.position.set(13, 24, 17); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const sc = key.shadow.camera; sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17; sc.near = 4; sc.far = 80;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.025; key.shadow.radius = 2;
  const fill = new THREE.DirectionalLight(0xd6e4ff, 0.45); fill.position.set(-18, 6, 12);
  const rim = new THREE.DirectionalLight(0xffffff, 1.7); rim.position.set(-10, 12, -22);
  const rim2 = new THREE.DirectionalLight(0xfff0dc, 0.8); rim2.position.set(18, 8, -14);
  scene.add(key, key.target, fill, rim, rim2);

  // textures
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = {};
  const parts = { mcu: buildMcu(), sens: buildSens(), link: buildLink(), psu: buildPsu(), case: buildCase(), face: buildFace(), ctx: buildCtx() };
  for (const k of ['mcu', 'sens', 'link']) { const r = parts[k].art.render(); T[k] = { map: canvasTex(r.c, true, aniso), orm: canvasTex(r.m, false, aniso) }; }
  { const r = espArt().render(); T.esp = { map: canvasTex(r.c, true, aniso), orm: canvasTex(r.m, false, aniso) }; }
  T.casePrint = canvasTex(casePrintCanvas(), true, aniso);
  T.mcbPrint = canvasTex(mcbPrintCanvas(), true, aniso);
  T.print = canvasTex(psuPrintCanvas(), true, aniso);
  T.gy = canvasTex(stripeCanvas(), true, aniso); T.gy.wrapS = T.gy.wrapT = THREE.RepeatWrapping; T.gy.repeat.set(10, 1);
  v.textures = [];
  for (const t of Object.values(T)) { if (t.isTexture) v.textures.push(t); else v.textures.push(t.map, t.orm); }
  const defs = matDefs(T);

  // groups: pivot (idle yaw about the layout centre) → device (3/4 yaw) → parts
  const pivot = v.pivot = new THREE.Group();
  const dev = v.dev = new THREE.Group();
  dev.rotation.y = (o.yaw != null ? o.yaw : 47) * DEG;
  resolveLayout(dev.rotation.y);
  pivot.add(dev); scene.add(pivot);
  // the light rig turns with the idle rotation (turntable): shadows only change when parts move → shadow map on demand
  pivot.add(key, key.target, fill, rim, rim2);
  renderer.shadowMap.autoUpdate = false;
  v.parts = {}; v.mats = {}; v.meshes = [];
  for (const [name, p] of Object.entries(parts)) {
    const g = new THREE.Group(); g.name = name;
    const mats = {};
    const buckets = new Map();
    for (const [k, list] of p.B.map) {
      const cls = KEYCLASS[k], bk = cls ? cls[0] : k, col = cls ? new THREE.Color(cls[1]) : null;
      let arr = buckets.get(bk); if (!arr) buckets.set(bk, (arr = []));
      for (const g0 of list) {
        const g = cleanGeo(g0);
        if (col) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
        arr.push(g);
      }
    }
    for (const [k, list] of buckets) {
      const geo = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!geo) throw new Error('merge failed ' + name + '/' + k);
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      const m = mats[k] = defs[k]();
      if (m.isMeshStandardMaterial) { m.envMap = v.env; m.envMapIntensity = m.metalnessMap ? 0.85 : m.metalness > 0.5 ? 1.0 : 0.55; }
      if (name === 'ctx') m.transparent = true;                     // fades out when exploding (always in the transparent pass: no recompiles)
      m.userData.base = { color: m.color.clone(), env: m.envMapIntensity, emi: m.emissiveIntensity || 0, op: m.opacity };
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = (name === 'ctx' || !m.transparent) && k !== 'interior' && k !== 'hole';
      mesh.receiveShadow = k !== 'interior' && k !== 'hole';
      mesh.userData.cast = mesh.castShadow;
      if (m.transparent) mesh.renderOrder = 2;
      g.add(mesh); v.meshes.push(mesh);
    }
    v.parts[name] = g; v.mats[name] = Object.values(mats);
    g.userData.pts = samplePoints(g);
    dev.add(g);
  }

  // contact shadow under the whole layout (device-local, re-rendered only when parts move)
  setupContactShadow(v);

  // camera
  v.camera = new THREE.PerspectiveCamera(o.fov || 22, 1, 0.5, 400);
  v.el_ = (o.elev != null ? o.elev : 15) * DEG;

  // overlay
  buildOverlay(v);
  applyTheme(o.theme);
  setCaption(o.caption);

  // size + observers
  v.ro = new ResizeObserver(() => resize()); v.ro.observe(el);
  v.onWin = () => resize(); window.addEventListener('resize', v.onWin);
  resize(true);
  applyPose(0);

  // compile shaders off the main thread where supported, then start
  if (renderer.compileAsync) { try { await renderer.compileAsync(scene, v.camera); } catch (e) { /* falls back to sync compile on first render */ } }
  if (v !== V || v.dead) return false;
  v.ready = true;
  window.Parts3DFailed = false;
  if (o.debug) { v.dbg = {}; window.__p3d = v; }     // test hooks only
  if (v.active) start();
  el.dispatchEvent(new CustomEvent('parts3d:ready'));
  return true;
}

function setBackground(bg) {
  const r = V && V.renderer; if (!r) return;
  if (!bg || bg === 'transparent') r.setClearColor(0x000000, 0);
  else r.setClearColor(new THREE.Color(bg), 1);
}

/* ---- contact shadow (three.js "contact shadows" technique, top-down depth → blurred alpha) */
const BLUR_V = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const BLUR_F = `uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
void main(){ vec4 s = vec4(0.0);
 s += texture2D(tDiffuse, vUv - 4.0*dir) * 0.051; s += texture2D(tDiffuse, vUv - 3.0*dir) * 0.0918;
 s += texture2D(tDiffuse, vUv - 2.0*dir) * 0.12245; s += texture2D(tDiffuse, vUv - 1.0*dir) * 0.1531;
 s += texture2D(tDiffuse, vUv) * 0.1633;
 s += texture2D(tDiffuse, vUv + 1.0*dir) * 0.1531; s += texture2D(tDiffuse, vUv + 2.0*dir) * 0.12245;
 s += texture2D(tDiffuse, vUv + 3.0*dir) * 0.0918; s += texture2D(tDiffuse, vUv + 4.0*dir) * 0.051;
 gl_FragColor = s; }`;
function setupContactShadow(v) {
  // plane under both layouts (device-local x/z), floor a little below the case
  const bb = new THREE.Box3().setFromPoints(layoutCorners(0));
  for (const p of layoutCorners(1)) bb.expandByPoint(p);
  const pad = 2.2, W = bb.max.x - bb.min.x + 2 * pad, D = bb.max.z - bb.min.z + 2 * pad, H = 11, floorY = -CASE.h / 2 - 1.05;
  const g = v.cs = new THREE.Group(); g.position.set((bb.min.x + bb.max.x) / 2, floorY, (bb.min.z + bb.max.z) / 2);
  v.dev.add(g);
  const res = 320, rw = Math.round(W >= D ? res : res * W / D), rh = Math.round(W >= D ? res * D / W : res);
  const rt = new THREE.WebGLRenderTarget(rw, rh); rt.texture.generateMipmaps = false;
  const rt2 = new THREE.WebGLRenderTarget(rw, rh); rt2.texture.generateMipmaps = false;
  const planeGeo = new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2);
  const plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: rt.texture, opacity: 0.62, transparent: true, depthWrite: false, toneMapped: false }));
  plane.renderOrder = 1; plane.scale.y = -1; g.add(plane);
  const blurPlane = new THREE.Mesh(planeGeo); blurPlane.visible = false; g.add(blurPlane);
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0, H); cam.rotation.x = Math.PI / 2; g.add(cam);
  const depth = new THREE.ShaderMaterial({
    uniforms: { darkness: { value: 1.35 } },
    vertexShader: 'varying float vZ; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); vZ = gl_Position.z / gl_Position.w; }',
    fragmentShader: 'uniform float darkness; varying float vZ; void main(){ float d = clamp(0.5 * vZ + 0.5, 0.0, 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - d) * darkness); }',
    depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
  });
  const blur = (dir) => new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: BLUR_V, fragmentShader: BLUR_F, depthTest: false, depthWrite: false });
  const hb = blur(), vb = blur();
  // soft light pool on the floor (reads as a studio floor on dark slides)
  let glow = null;
  if (v.opts.floorGlow) {
    const c = canvas(256, 256), x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    const t = canvasTex(c); v.textures.push(t);
    glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.11, depthWrite: false, toneMapped: false }));
    glow.position.set(g.position.x, floorY - 0.01, g.position.z); glow.scale.set(W * 0.9, 1, D * 0.75); glow.renderOrder = 0;
    v.dev.add(glow);
  }
  v.csx = { g, rt, rt2, plane, blurPlane, cam, depth, hb, vb, glow, W, D };
}
function renderContactShadow(v) {
  const { rt, rt2, plane, blurPlane, cam, depth, hb, vb, glow } = v.csx, r = v.renderer, s = v.scene;
  const ca = r.getClearAlpha(), cc = r.getClearColor(new THREE.Color());
  plane.visible = false; if (glow) glow.visible = false;
  const ctx = v.parts.ctx, ctxVis = ctx.visible; ctx.visible = ctxFade(v.t) > 0.5;
  const au = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
  s.overrideMaterial = depth;
  r.setClearColor(0x000000, 0);
  r.setRenderTarget(rt); r.clear(); r.render(s, cam);
  s.overrideMaterial = null;
  const pass = (amount) => {
    blurPlane.visible = true;
    blurPlane.material = hb; hb.uniforms.tDiffuse.value = rt.texture; hb.uniforms.dir.value.set(amount / rt.width, 0);
    r.setRenderTarget(rt2); r.render(blurPlane, cam);
    blurPlane.material = vb; vb.uniforms.tDiffuse.value = rt2.texture; vb.uniforms.dir.value.set(0, amount / rt.height);
    r.setRenderTarget(rt); r.render(blurPlane, cam);
    blurPlane.visible = false;
  };
  pass(2.2); pass(1.0);
  r.setRenderTarget(null); r.setClearColor(cc, ca);
  r.shadowMap.autoUpdate = au;
  ctx.visible = ctxVis;
  plane.visible = true; if (glow) glow.visible = true;
}

/* ---- overlay labels */
function buildOverlay(v) {
  const ov = v.ov = document.createElement('div'); ov.className = 'p3d-ov';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'p3d-lines');
  ov.appendChild(svg);
  v.labs = LABELS.map((txt, i) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '6');
    svg.appendChild(line); svg.appendChild(dot);
    const d = document.createElement('div'); d.className = 'p3d-lab'; d.textContent = txt; d.dataset.i = i;
    ov.appendChild(d);
    return { i, d, line, dot, w: 0, h: 0, x: 0, y: 0, op: -1 };
  });
  v.cap = document.createElement('div'); v.cap.className = 'p3d-cap'; ov.appendChild(v.cap);
  v.root.appendChild(ov);
  measureLabels();
  try { document.fonts.ready.then(() => measureLabels()); } catch (e) { /* */ }
}
function measureLabels() { if (!V || !V.labs) return; for (const L of V.labs) { L.w = L.d.offsetWidth; L.h = L.d.offsetHeight; } }
function applyTheme(name) {
  const v = V; if (!v) return;
  const t = THEMES[name] || THEMES.dark, s = v.root.style;
  s.setProperty('--p3d-ink', t.ink); s.setProperty('--p3d-line', t.line); s.setProperty('--p3d-halo', t.halo);
  s.setProperty('--p3d-shadow', t.shadow); s.setProperty('--p3d-bg-ink', t.bgInk);
  s.setProperty('--p3d-fs', (v.opts.labelPx || 34) + 'px');
  s.setProperty('--p3d-font', `'Plus Jakarta Sans','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif`);
  measureLabels();
}

/* ---- sizing */
function resize(force) {
  const v = V; if (!v || !v.renderer) return;
  const el = v.el, w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  const rect = el.getBoundingClientRect();
  const visScale = rect.width > 0 ? rect.width / w : 1;            // deck stage transform: scale(--s)
  let pr = Math.min(v.opts.dprCap || 1.5, (window.devicePixelRatio || 1) * visScale);
  pr = Math.min(pr, Math.sqrt((1920 * 1080 * 1.6) / (w * h)));     // never more than ~1.6 × 1080p pixels
  pr = Math.max(0.5, pr * v.prScale);
  if (force || w !== v.size[0] || h !== v.size[1] || Math.abs(pr - v.pr) > 0.01) {
    v.size = [w, h]; v.pr = pr;
    v.renderer.setPixelRatio(pr); v.renderer.setSize(w, h, false);
    v.camera.aspect = w / h; v.camera.updateProjectionMatrix();
    measureLabels();
    if (v.ready && !v.raf) renderOnce();
  }
}

/* ---- poses */
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3();
function partProgress(name, t) { const w = LAYOUT[name].w; return clamp((t - w[0]) / (w[1] - w[0])); }
function poseOf(name, p, out) {
  const L = LAYOUT[name], a = L.a, e = L.e;
  let r = 0;
  if (L.out == null) { out.x = a[0]; out.y = a[1]; out.z = a[2]; }
  else {
    // straight out of the case along its front axis, then a smooth curve (tangent-continuous) to the exploded spot
    const s = ease(p);
    if (s <= L.q) { const u = s / L.q; out.x = a[0]; out.y = a[1]; out.z = lerp(a[2], L.out, u); }
    else {
      const u = (s - L.q) / (1 - L.q), m = 1 - u, cz = L.out + L.k;
      out.x = m * m * a[0] + 2 * u * m * a[0] + u * u * e[0];
      out.y = m * m * a[1] + 2 * u * m * a[1] + u * u * e[1];
      out.z = m * m * L.out + 2 * u * m * cz + u * u * e[2];
      r = smooth(0, 1, u);
    }
  }
  out.rx = lerp(a[3], e[3], r) * DEG; out.ry = lerp(a[4], e[4], r) * DEG; out.rz = lerp(a[5], e[5], r) * DEG;
  return out;
}
const _pose = {};
function applyPose(t) {
  const v = V;
  for (const name of Object.keys(LAYOUT)) {
    const g = v.parts[name], P = poseOf(name, partProgress(name, t), _pose);
    g.position.set(P.x, P.y, P.z); g.rotation.set(P.rx, P.ry, P.rz);
    g.scale.setScalar(1);
  }
}
/* a few hundred real vertices per part (+ per-mesh extremes): a much tighter hull than bounding-box corners */
function samplePoints(g, budget = 220) {
  let total = 0; g.children.forEach((m) => { total += m.geometry.attributes.position.count; });
  const stride = Math.max(1, Math.floor(total / budget)), out = [];
  for (const m of g.children) {
    const pos = m.geometry.attributes.position, ext = new Array(6).fill(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < pos.getX(ext[0])) ext[0] = i; if (x > pos.getX(ext[1])) ext[1] = i;
      if (y < pos.getY(ext[2])) ext[2] = i; if (y > pos.getY(ext[3])) ext[3] = i;
      if (z < pos.getZ(ext[4])) ext[4] = i; if (z > pos.getZ(ext[5])) ext[5] = i;
      if (i % stride === 0) out.push(new THREE.Vector3(x, y, z));
    }
    for (const i of ext) out.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  }
  return out;
}
/* hull points of the current layout in device space (without highlight offsets); cached per t */
const _m4 = new THREE.Matrix4();
function layoutCorners(t) {
  const v = V;
  if (v._lpT === t && v._lp) return v._lp;
  if (!v._lp) { v._lp = []; for (const name of Object.keys(LAYOUT)) for (let i = 0; i < v.parts[name].userData.pts.length; i++) v._lp.push(new THREE.Vector3()); }
  let k = 0;
  for (const name of Object.keys(LAYOUT)) {
    const P = poseOf(name, partProgress(name, t), _pose), f = LAYOUT[name].ctx ? ctxFade(t) : 1;
    _e.set(P.rx, P.ry, P.rz); _q.setFromEuler(_e); _p.set(P.x, P.y, P.z); _m4.compose(_p, _q, _one);
    for (const p of v.parts[name].userData.pts) { const o = v._lp[k++].copy(p); if (f < 1) o.sub(CTX_C).multiplyScalar(f).add(CTX_C); o.applyMatrix4(_m4); }
  }
  v._lpT = t;
  return v._lp;
}

/* camera fit: fixed elevation, target shifted so the projected layout is centred, distance so it fits with margins */
function fitCamera(t) {
  const v = V, cam = v.camera, el = v.el_;
  const key = t + '|' + cam.aspect.toFixed(4) + '|' + v.labF.toFixed(3) + '|' + v.capF.toFixed(3);
  if (v._fitKey === key) return;                 // idle frames: nothing to refit
  v._fitKey = key;
  const pts = layoutCorners(t);
  // centre of the layout → pivot (idle rotation turns around it)
  const bb = new THREE.Box3().setFromPoints(pts); bb.getCenter(_c);
  const yaw = v.dev.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const R = (p) => _w.set(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  const cW = R(_c).clone();
  v.dev.position.set(-cW.x, -cW.y, -cW.z);
  if (!v._world || v._world.length !== pts.length) v._world = pts.map(() => new THREE.Vector3());
  const world = v._world;
  for (let i = 0; i < pts.length; i++) world[i].copy(R(pts[i])).sub(cW);
  const right = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, Math.cos(el), -Math.sin(el)), fwd = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
  const aspect = cam.aspect, tanV = Math.tan(cam.fov * DEG / 2);
  const e = ease(t);
  const mx = lerp(v.opts.marginX0 != null ? v.opts.marginX0 : 0.2, v.opts.marginX1 != null ? v.opts.marginX1 : 0.05, e);
  const lab = ease(v.labF), cap = ease(v.capF);
  const myT = lerp(0.1 + 0.08 * lab, 0.06 + 0.11 * lab, e), myB = lerp(0.12, 0.06 + 0.11 * lab, e) + 0.055 * cap;
  let sx = 0, syy = 0, d = 50;
  for (let k = 0; k < 4; k++) {
    d = 0;
    for (const p of world) {
      const f = p.dot(fwd), xr = Math.abs(p.dot(right) - sx), yr = p.dot(up) - syy;
      d = Math.max(d, f + xr / (tanV * aspect * (1 - mx)), f + (yr > 0 ? yr / (tanV * (1 - 2 * myT)) : -yr / (tanV * (1 - 2 * myB))));
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of world) {
      const dz = d - p.dot(fwd), nx = (p.dot(right) - sx) / (dz * tanV * aspect), ny = (p.dot(up) - syy) / (dz * tanV);
      x0 = Math.min(x0, nx); x1 = Math.max(x1, nx); y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
    }
    sx += (x0 + x1) / 2 * d * tanV * aspect;
    syy += ((y0 + y1) / 2 - (myB - myT)) * d * tanV;
  }
  const target = right.clone().multiplyScalar(sx).add(up.clone().multiplyScalar(syy));
  cam.position.copy(target).addScaledVector(fwd, d);
  cam.up.set(0, 1, 0); cam.lookAt(target);
  cam.near = Math.max(0.5, d - 40); cam.far = d + 60; cam.updateProjectionMatrix();
  v.camD = d;
}

/* ---- highlight + dimming */
function applyHighlight() {
  const v = V, cam = v.camera;
  v.pivot.updateMatrixWorld(true);
  for (const name of Object.keys(LAYOUT)) {
    const li = LAYOUT[name].lab, h = li >= 0 ? v.h[li] : 0, g = v.parts[name];
    if (h > 0.001) {
      g.getWorldPosition(_w);
      const big = li === 4 ? 0.45 : 1;                 // the case is already the largest object: move it less
      _v.copy(cam.position).sub(_w).normalize().multiplyScalar(4.2 * big * ease(h)).add(_w);
      g.parent.worldToLocal(_v); g.position.copy(_v);
      g.scale.setScalar(1 + 0.1 * big * ease(h));
    }
    // dim = how much some other part is highlighted
    let d = 0; for (let i = 0; i < 5; i++) if (i !== li) d = Math.max(d, v.h[i]);
    d = ease(d);
    if (Math.abs((v.dim[name] || 0) - d) > 0.002) {
      v.dim[name] = d;
      for (const m of v.mats[name]) {
        const b = m.userData.base;
        /* deck v7: much lighter dimming of the non-highlighted parts (was 0.74 / 0.8 / 0.85 / 0.6) */
        m.color.copy(b.color).multiplyScalar(1 - 0.28 * d);
        m.envMapIntensity = b.env * (1 - 0.3 * d);
        if (m.emissive) m.emissiveIntensity = b.emi * (1 - 0.35 * d);
        if (m.transparent && name !== 'ctx') m.opacity = b.op * (1 - 0.25 * d);
      }
    }
  }
}

/* ---- labels per frame */
function layoutLabels() {
  const v = V, W = v.size[0], H = v.size[1], cam = v.camera;
  v.pivot.updateMatrixWorld(true);
  const pos = [];
  for (const A of ANCHOR) {
    const g = v.parts[A.part];
    _v.set(A.p[0], A.p[1], A.p[2]); g.localToWorld(_v); _v.project(cam);
    pos.push([(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H]);
  }
  const e = smooth(0.82, 1, v.t);
  // projected bounds of the whole layout → label lanes sit just outside it (never on top of a part)
  // (actual part matrices, so a highlighted part brought forward / scaled up is included)
  let top = Infinity, bot = -Infinity;
  for (const name of Object.keys(LAYOUT)) {
    const mw = v.parts[name].matrixWorld, f = LAYOUT[name].ctx ? ctxFade(v.t) : 1;
    for (const p of v.parts[name].userData.pts) {
      _v.copy(p); if (f < 1) _v.sub(CTX_C).multiplyScalar(f).add(CTX_C);
      _v.applyMatrix4(mw).project(cam); const y = (1 - _v.y) / 2 * H; if (y < top) top = y; if (y > bot) bot = y;
    }
  }
  const gap = Math.max(26, H * 0.035), mg = Math.max(12, W * 0.012);
  if (v.labs.some((L) => !L.w)) measureLabels();
  const lanes = { 1: [], [-1]: [] };
  v.labs.forEach((L, i) => { const A = ANCHOR[i]; lanes[A.lane].push(i); });
  const laneY = {};
  for (const lane of [1, -1]) {
    const ids = lanes[lane]; if (!ids.length) continue;
    const hh = Math.max(...ids.map((i) => v.labs[i].h)) || 40;
    // lane from the exploded layout anchors (the case label alone when assembled)
    let y = lane > 0 ? top - gap - hh / 2 : bot + gap + hh / 2;
    y = clamp(y, hh / 2 + 8, H - hh / 2 - 8);
    laneY[lane] = y;
    // horizontal: centre over the anchor, push apart, keep inside
    const order = ids.slice().sort((a, b) => pos[a][0] - pos[b][0]);
    const xs = order.map((i) => pos[i][0]);
    for (let k = 1; k < order.length; k++) { const a = v.labs[order[k - 1]], b = v.labs[order[k]]; xs[k] = Math.max(xs[k], xs[k - 1] + (a.w + b.w) / 2 + 28); }
    for (let k = order.length - 1; k >= 0; k--) {
      const L = v.labs[order[k]], maxX = k === order.length - 1 ? W - mg - L.w / 2 : xs[k + 1] - (L.w + v.labs[order[k + 1]].w) / 2 - 28;
      xs[k] = Math.min(xs[k], maxX);
    }
    for (let k = 0; k < order.length; k++) { const L = v.labs[order[k]]; xs[k] = Math.max(xs[k], mg + L.w / 2 + (k ? 0 : 0)); }
    order.forEach((i, k) => { v.labs[i].x = xs[k]; v.labs[i].y = y; });
  }
  const anyHl = v.h.some((x) => x > 0.5);
  v.labs.forEach((L, i) => {
    const vis = v.labelsOn ? (i === 4 ? 1 : e) : 0;
    const hl = v.hTarget === i;
    const op = vis * (anyHl && !hl ? 0.32 : 1);
    const lane = ANCHOR[i].lane;
    const [ax, ay] = pos[i];
    const ly = L.y + (lane > 0 ? L.h / 2 + 4 : -L.h / 2 - 4);
    L.d.style.transform = `translate(${(L.x - L.w / 2).toFixed(1)}px,${(L.y - L.h / 2).toFixed(1)}px)`;
    if (Math.abs(op - L.op) > 0.004) { L.d.style.opacity = op.toFixed(3); L.line.style.opacity = op.toFixed(3); L.dot.style.opacity = op.toFixed(3); L.op = op; }
    L.d.classList.toggle('hl', hl);
    L.line.setAttribute('x1', ax.toFixed(1)); L.line.setAttribute('y1', ay.toFixed(1));
    L.line.setAttribute('x2', L.x.toFixed(1)); L.line.setAttribute('y2', ly.toFixed(1));
    L.dot.setAttribute('cx', ax.toFixed(1)); L.dot.setAttribute('cy', ay.toFixed(1));
  });
}

/* ---- loop */
function start() { const v = V; if (!v || v.raf || !v.ready || v.dead) return; v.last = performance.now(); v.raf = requestAnimationFrame(frame); }
function stop() { const v = V; if (v && v.raf) { cancelAnimationFrame(v.raf); v.raf = 0; } }
function frame(now) {
  const v = V; if (!v || v.dead) return;
  v.raf = 0;
  try {
    const dt = Math.min(0.1, Math.max(0, (now - v.last) / 1000)); v.last = now;      // ≥ 10 fps keeps real-time speed
    step(dt);
    const c0 = performance.now();
    renderOnce();
    v.cpu = v.cpu ? v.cpu * 0.95 + (performance.now() - c0) * 0.05 : performance.now() - c0;   // main-thread ms per frame (EMA)
    // fps + adaptive resolution
    v.frames++; v.fpsT += dt;
    if (v.fpsT >= 1) {
      v.fps = v.frames / v.fpsT; v.frames = 0; v.fpsT = 0; v.clock2 = (v.clock2 || 0) + 1;
      // adaptive resolution: 2 s below 40 fps → −15 % pixels per axis (floor 0.6); 5 s at ≥ 58 fps → back up (max 2 times)
      v.slow = v.fps < 40 ? (v.slow || 0) + 1 : 0;
      v.fast = v.fps >= 58 ? (v.fast || 0) + 1 : 0;
      if (v.clock2 > 2 && v.slow >= 2 && v.prScale > 0.6 && !document.hidden) { v.prScale = Math.max(0.6, v.prScale * 0.85); v.slow = 0; v.fast = 0; resize(true); }
      else if (v.fast >= 5 && v.prScale < 1 && (v.ups || 0) < 2 && !document.hidden) { v.prScale = Math.min(1, v.prScale / 0.85); v.ups = (v.ups || 0) + 1; v.fast = 0; resize(true); }
    }
  } catch (e) { fail('frame error', e); return; }
  if (v.active && !v.dead) v.raf = requestAnimationFrame(frame);
}
function step(dt) {
  const v = V;
  v.clock += dt;
  // explode / assemble timeline
  if (v.tDur > 0) {
    v.tStart += dt;
    const k = clamp(v.tStart / v.tDur);
    v.t = lerp(v.tFrom, v.tTo, k);
    if (k >= 1) { v.tDur = 0; v.t = v.tTo; const r = v.resolveAnim; v.resolveAnim = null; if (r) r(true); }
    v.shadowDirty = true;
  }
  // label / caption margins ease in and out (the camera refits smoothly)
  const lt = v.labelsOn ? 1 : 0, ct = v.cap && v.cap.textContent ? 1 : 0, rm = reduceMotion() ? 0.05 : 0.6;
  if (v.labF !== lt) v.labF = clamp(v.labF + Math.sign(lt - v.labF) * dt / rm);
  if (v.capF !== ct) v.capF = clamp(v.capF + Math.sign(ct - v.capF) * dt / rm);
  // highlight easing
  for (let i = 0; i < 5; i++) {
    const tgt = v.hTarget === i ? 1 : 0;
    if (v.h[i] !== tgt) { v.h[i] = clamp(v.h[i] + Math.sign(tgt - v.h[i]) * dt / (reduceMotion() ? 0.05 : 0.55)); v.shadowDirty = true; }
  }
}
function renderOnce() {
  const v = V; if (!v || !v.ready) return;
  applyPose(v.t);
  // context breakers fade out over the first 30 % of the explode
  const f = ctxFade(v.t), cg = v.parts.ctx;
  cg.visible = f > 0.01;
  if (v._ctxF !== f) { v._ctxF = f; for (const m of v.mats.ctx) m.opacity = f; for (const ms of cg.children) ms.castShadow = ms.userData.cast && f > 0.5; }
  fitCamera(v.t);
  const idleAmp = v.opts.idle && !reduceMotion() ? 10 * DEG : 0;
  v.pivot.rotation.y = idleAmp * Math.sin(v.clock * Math.PI * 2 / 16);
  applyHighlight();
  if (v.shadowDirty) {
    const D = v.dbg || {};
    if (!D.noCS) renderContactShadow(v);
    if (!D.noSM) v.renderer.shadowMap.needsUpdate = true;
    v.shadowDirty = false;
  }
  v.renderer.render(v.scene, v.camera);
  layoutLabels();
}

/* ------------------------------------------------------------------ public API */
function animateTo(target, ms) {
  const v = V; if (!v) return Promise.resolve(false);
  if (v.resolveAnim) { const r = v.resolveAnim; v.resolveAnim = null; r(false); }
  ms = reduceMotion() ? Math.min(ms, 250) : ms;
  if (!ms || ms <= 0 || Math.abs(v.t - target) < 1e-4) {
    v.t = v.tTo = target; v.tDur = 0; v.shadowDirty = true; if (v.ready && !v.raf) renderOnce();
    return Promise.resolve(true);
  }
  v.tFrom = v.t; v.tTo = target; v.tStart = 0;
  v.tDur = (ms / 1000) * Math.abs(target - v.t);               // partial runs keep the same speed
  return new Promise((res) => { v.resolveAnim = res; });
}
function explode(ms = 1800) { try { return animateTo(1, ms); } catch (e) { fail('explode', e); return Promise.resolve(false); } }
function assemble(ms = 1500) {
  try { if (V) V.hTarget = -1; return animateTo(0, ms); } catch (e) { fail('assemble', e); return Promise.resolve(false); }
}
function highlight(i) {
  const v = V; if (!v) return;
  const n = (i === null || i === undefined || i === false) ? -1 : Number(i);
  v.hTarget = Number.isInteger(n) && n >= 0 && n < 5 ? n : -1;
  if (v.hTarget >= 0 && n !== 4 && v.t < 1 && v.tTo < 1) explode();
  v.shadowDirty = true;
  if (v.ready && !v.raf) renderOnce();
}
function setLabels(on) { const v = V; if (!v) return; v.labelsOn = !!on; if (!v.raf) { v.labF = v.labelsOn ? 1 : 0; if (v.ready) renderOnce(); } }
function setActive(on) {
  const v = V; if (!v) return;
  v.active = !!on;
  if (v.active) { if (v.ready) { resize(); start(); } } else stop();
}
function setCaption(text) { const v = V; if (!v || !v.cap) return; v.cap.textContent = text || ''; if (!v.raf) { v.capF = text ? 1 : 0; if (v.ready) renderOnce(); } }
function state() {
  const v = V;
  if (!v) return { ready: false, failed: !!window.Parts3DFailed };
  const info = v.renderer ? v.renderer.info : null;
  return {
    ready: !!v.ready, failed: !!window.Parts3DFailed, active: v.active, exploded: +v.t.toFixed(3), target: v.tTo,
    highlight: v.hTarget, labels: v.labelsOn, fps: +v.fps.toFixed(1), cpuMs: +(v.cpu || 0).toFixed(2), pixelRatio: +v.pr.toFixed(2), resolutionScale: +v.prScale.toFixed(2),
    size: v.size.slice(), drawCalls: info ? info.render.calls : 0, triangles: info ? info.render.triangles : 0,
    gpu: (() => { try { const gl = v.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return ''; } })(),
  };
}
function teardown() {
  const v = V; if (!v) return;
  v.dead = true; stop();
  try { if (v.ro) v.ro.disconnect(); } catch (e) { /* */ }
  if (v.onWin) window.removeEventListener('resize', v.onWin);
  if (v.resolveAnim) { const r = v.resolveAnim; v.resolveAnim = null; try { r(false); } catch (e) { /* */ } }
  try {
    if (v.meshes) for (const m of v.meshes) m.geometry.dispose();
    if (v.mats) for (const list of Object.values(v.mats)) for (const m of list) m.dispose();
    if (v.textures) for (const t of v.textures) t.dispose();
    if (v.env) v.env.dispose();
    if (v.csx) { v.csx.rt.dispose(); v.csx.rt2.dispose(); v.csx.plane.geometry.dispose(); v.csx.plane.material.dispose(); v.csx.depth.dispose(); v.csx.hb.dispose(); v.csx.vb.dispose(); if (v.csx.glow) { v.csx.glow.geometry.dispose(); v.csx.glow.material.dispose(); } }
    if (v.canvas && v.onLost) v.canvas.removeEventListener('webglcontextlost', v.onLost, false);
    if (v.renderer) {
      const gl = v.renderer.getContext();
      v.renderer.dispose();
      // free the GL context now (browsers cap live contexts); skip when it is already lost
      if (gl && !gl.isContextLost()) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    }
  } catch (e) { /* */ }
  try { if (v.root && v.root.parentNode) v.root.parentNode.removeChild(v.root); } catch (e) { /* */ }
  if (v.setPos) v.el.style.position = '';
  V = null; initPromise = null;
}
function dispose() { teardown(); }

const API = { init, explode, assemble, highlight, setLabels, setActive, setCaption, state, dispose, LABELS, webgl2: WEBGL2, version: '1.0.0' };
window.Parts3D = API;
export default API;
