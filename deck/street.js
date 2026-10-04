/* 2D street for S2 (problem) and S5 (SunGuard). SVG + requestAnimationFrame, no libraries. Fallback of street3d.js.
 * Layout (team decision 04.10): ONE transformer in the middle, TWO lines — left line and right line, 3 houses each.
 * The last house of each line is at the far end of the street.
 * API: init(el) · setSun(v, ms) · sweepSun(v, ms) · getSun() · setActive(bool) · setBoxes(show) · pulse() · volts() · state()
 *      setLines(n)  n = 0 no SunGuard · 1 SunGuard on the LEFT line · 2 on both lines;  lines()
 *      setGuard(on) = LEFT line, setGuardRight(on) = RIGHT line (as street3d.js) · addBox() = setLines(lines + 1) · setBoxCount(k) (3 boxes per line) · boxes()
 *      cutPercent() · boxedHouses()  (house order: left line from the transformer outwards, then right line)
 * Voltage model (MODEL, illustrative; same formulas as street3d.js computeShared, per line, independent):
 *   house i of a 3-house line at w_i = 1-(1-i/3)^2; f = sun^1.25; rise_i = c·Σ_j min(w_i,w_j)·P_j, c so that the last house
 *   of each line = 236 + 16 = 252 V at sun 1 (F13). SunGuard on a line: the inverter's own voltage-control mode takes 40 % off
 *   each house's voltage effect, plus ONE equal output factor k ∈ [0.4, 1] for the line, the largest that keeps it ≤ 240 V.
 * Colours (Okabe–Ito): ≤ 240 V #009E73 · 240–242 V #E69F00 · > 242 V #D55E00, plus position above the limit line and "OVER".
 * Performance: no node is created per frame; sky/hills/shadows are touched only when the sun moved, pillars only when a
 *   voltage changed; pulses and ripples are CSS animations (transform/opacity).
 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1920, H = 1080, BASE = 880, NL = 3;
  var V0 = 236, RISE = 16, LIMIT = 242, SAFE = 240, VV_CUT = 0.4, MAX_CUT = 0.6;
  var PB = 545, PPV = 11;                  /* pillar base y (= 230 V) and px per volt */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var COL = ['#009E73', '#E69F00', '#D55E00'], TXT = ['#5BE0B3', '#FFC24D', '#FF8A57'], SG = '#56B4E9', SOLAR = '#F0E442';
  var TPX = 960;                            /* transformer in the middle */
  /* house order: left line (near -> far), right line (near -> far) */
  var HX = [748, 528, 308, 1172, 1392, 1612];
  var LINE = [0, 0, 0, 1, 1, 1], POS = [0, 1, 2, 0, 1, 2];
  var POLES = [638, 418, 198, 1282, 1502, 1722];
  var WIRE_Y = 590;
  var HOUSES = [
    { w: 196, h: 150, wall: '#C9BDAD', wall2: '#AA9E8F', roof: '#6B6763', panels: [2, 3] },
    { w: 204, h: 160, wall: '#BDB4A8', wall2: '#9F968A', roof: '#5F6266', panels: [2, 3] },
    { w: 200, h: 146, wall: '#CFC4B4', wall2: '#B0A595', roof: '#716B66', panels: [2, 3] },
    { w: 200, h: 150, wall: '#C4BAAE', wall2: '#A69C90', roof: '#5E6064', panels: [2, 3] },
    { w: 206, h: 158, wall: '#CBBDAB', wall2: '#AC9F8D', roof: '#6F6964', panels: [2, 3] },
    { w: 200, h: 152, wall: '#BFB6AA', wall2: '#A1988C', roof: '#5B5E62', panels: [2, 3] }
  ];

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function hex(c) { c = c.replace('#', ''); return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)]; }
  function mix(c1, c2, t) { var a = hex(c1), b = hex(c2); return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')'; }
  function ramp(keys, s) {
    for (var i = 1; i < keys.length; i++) if (s <= keys[i][0]) { var t = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]); return mix(keys[i - 1][1], keys[i][1], t); }
    return mix(keys[keys.length - 1][1], keys[keys.length - 1][1], 0);
  }
  function level(v) { return v > LIMIT + 0.05 ? 2 : (v > SAFE + 0.05 ? 1 : 0); }
  function setA(e, k, v) { if (e['_' + k] !== v) { e['_' + k] = v; e.setAttribute(k, v); } }

  var SKY = {
    top: [[0, '#2E3850'], [0.35, '#4F6C8C'], [1, '#6F9BC2']],
    mid: [[0, '#6C7286'], [0.35, '#93A9BE'], [1, '#A9C6DC']],
    hor: [[0, '#CDB3A2'], [0.35, '#D9D6CF'], [1, '#E2EBEE']],
    ridge: [[0, '#565C6E'], [0.4, '#8A95A2'], [1, '#A3B0BA']],
    far: [[0, '#3E4A45'], [0.4, '#6E7D6C'], [1, '#86947E']],
    near: [[0, '#36423A'], [0.4, '#5F6E57'], [1, '#77856A']],
    walk: [[0, '#6E6C70'], [0.4, '#B3AEA6'], [1, '#C8C3BA']],
    road: [[0, '#2A2C31'], [1, '#3C3F44']],
    sunCore: [[0, '#FFDDB8'], [0.4, '#FFF3DC'], [1, '#FFFCF2']],
    sunGlow: [[0, '#F0A070'], [0.4, '#F6CF8E'], [1, '#FBEBC0']]
  };

  /* ---------- model (per line, = street3d.js computeShared with 3 houses) ---------- */
  var WPOS = [], MIJ = [], SUMW = 0;
  for (var q = 0; q < NL; q++) { WPOS.push(1 - Math.pow(1 - (q + 1) / NL, 2)); SUMW += WPOS[q]; }
  for (var a1 = 0; a1 < NL; a1++) { MIJ.push([]); for (var b1 = 0; b1 < NL; b1++) MIJ[a1].push(Math.min(WPOS[a1], WPOS[b1])); }
  var C_RISE = RISE / SUMW;
  function lineModel(s, act) {
    var f = Math.pow(clamp(s, 0, 1), 1.25), A = [], B = [], any = false, i, j;
    for (j = 0; j < NL; j++) if (act[j] > 1e-4) any = true;
    for (i = 0; i < NL; i++) { A.push(0); B.push(0); for (j = 0; j < NL; j++) { A[i] += MIJ[i][j] * (1 - act[j]); B[i] += MIJ[i][j] * (1 - VV_CUT) * act[j]; } }
    var k = 1;
    if (any && f > 1e-6) {
      var kn = Infinity;
      for (i = 0; i < NL; i++) if (B[i] > 1e-9) kn = Math.min(kn, ((SAFE - V0) / (C_RISE * f) - A[i]) / B[i]);
      k = clamp(kn, 1 - MAX_CUT, 1);
    }
    var v = [], out = [];
    for (i = 0; i < NL; i++) { v.push(V0 + C_RISE * f * (A[i] + B[i] * k)); out.push(f * (1 - act[i] * (1 - k))); }
    return { v: v, out: out, cut: any ? 1 - k : 0, f: f };
  }
  function model(s, act) {
    var L = lineModel(s, act.slice(0, 3)), R2 = lineModel(s, act.slice(3, 6));
    return { v: L.v.concat(R2.v), out: L.out.concat(R2.out), cut: [L.cut, R2.cut], f: L.f };
  }

  var S = { sun: 0.15, from: 0.15, to: 0.15, el: 0, dur: 0, pause: 0, froze: false, wasOver: false,
            act: [0, 0, 0, 0, 0, 0], actT: [0, 0, 0, 0, 0, 0], actAt: [0, 0, 0, 0, 0, 0], actFrom: [0, 0, 0, 0, 0, 0], lines: 0, show: false,
            active: false, flow: 0, flowSpeed: 0, last: null, raf: 0, lastT: 0, drawnSun: -1, drawnAct: '', drawnShow: null };
  var R = {};

  function build(root) {
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid slice', 'class': 'street-svg' }, null);
    var defs = el('defs', null, svg);
    var sky = el('linearGradient', { id: 'stSky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    R.skyTop = el('stop', { offset: '0' }, sky); R.skyMid = el('stop', { offset: '0.55' }, sky); R.skyHor = el('stop', { offset: '1' }, sky);
    var sg = el('radialGradient', { id: 'stSunGlow' }, defs);
    R.glow0 = el('stop', { offset: '0', 'stop-opacity': '.7' }, sg); R.glow1 = el('stop', { offset: '.35', 'stop-opacity': '.2' }, sg);
    R.glow2 = el('stop', { offset: '1', 'stop-opacity': '0' }, sg);
    var core = el('radialGradient', { id: 'stSunCore' }, defs);
    el('stop', { offset: '0', 'stop-color': '#FFFFFF' }, core); R.core1 = el('stop', { offset: '1' }, core);
    var panel = el('linearGradient', { id: 'stPanel', x1: 0, y1: 0, x2: 0.3, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#3A4A62' }, panel); el('stop', { offset: '1', 'stop-color': '#1E2A3C' }, panel);
    var glass = el('linearGradient', { id: 'stGlass', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#C9D2D8' }, glass); el('stop', { offset: '1', 'stop-color': '#7B8790' }, glass);
    var shadowG = el('linearGradient', { id: 'stShadow', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#10140F', 'stop-opacity': '.42' }, shadowG); el('stop', { offset: '1', 'stop-color': '#10140F', 'stop-opacity': '0' }, shadowG);
    var sgGlow = el('radialGradient', { id: 'stSgGlow' }, defs);
    el('stop', { offset: '0', 'stop-color': SG, 'stop-opacity': '.85' }, sgGlow); el('stop', { offset: '.45', 'stop-color': SG, 'stop-opacity': '.25' }, sgGlow); el('stop', { offset: '1', 'stop-color': SG, 'stop-opacity': '0' }, sgGlow);
    var wallShade = el('linearGradient', { id: 'stWallShade', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.06' }, wallShade); el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.16' }, wallShade);
    var vign = el('radialGradient', { id: 'stVign', cx: '.5', cy: '.45', r: '.75' }, defs);
    el('stop', { offset: '.6', 'stop-color': '#000', 'stop-opacity': '0' }, vign); el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.3' }, vign);

    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#stSky)' }, svg);
    R.sunG = el('g', null, svg);
    el('circle', { r: 280, fill: 'url(#stSunGlow)' }, R.sunG);
    el('circle', { r: 50, fill: 'url(#stSunCore)' }, R.sunG);

    R.ridgeG = el('g', null, svg);
    R.ridge = el('path', { d: 'M-60,650 L60,622 L170,634 L300,600 L420,616 L560,588 L690,610 L820,582 L960,606 L1090,576 L1220,598 L1350,570 L1480,594 L1610,576 L1740,600 L1860,582 L1990,608 L1990,730 L-60,730 Z' }, R.ridgeG);
    el('rect', { x: -60, y: 610, width: 2050, height: 120, fill: '#fff', opacity: '.14' }, R.ridgeG);
    R.farG = el('g', null, svg);
    R.far = el('path', { d: 'M-60,710 C160,660 340,680 520,672 C700,662 860,638 1040,660 C1220,682 1400,656 1600,672 C1760,684 1880,670 1990,674 L1990,790 L-60,790 Z' }, R.farG);
    R.nearG = el('g', null, svg);
    R.near = el('path', { d: 'M-60,780 C200,730 420,750 640,740 C860,730 1040,758 1240,748 C1460,736 1680,758 1990,740 L1990,900 L-60,900 Z' }, R.nearG);
    R.grass = el('rect', { x: -60, y: 820, width: 2040, height: 80 }, svg);

    R.walk = el('rect', { x: -60, y: BASE, width: 2040, height: 42 }, svg);
    el('rect', { x: -60, y: BASE + 40, width: 2040, height: 8, fill: '#8A857E' }, svg);
    R.road = el('rect', { x: -60, y: BASE + 48, width: 2040, height: 160 }, svg);
    var dashes = el('g', { opacity: '.3' }, svg);
    for (var dx = -40; dx < W + 60; dx += 150) el('rect', { x: dx, y: BASE + 128, width: 80, height: 6, rx: 3, fill: '#E6E1D6' }, dashes);

    R.shadows = [];
    var shG = el('g', null, svg);
    for (var i = 0; i < 6; i++) R.shadows.push(el('path', { fill: 'url(#stShadow)' }, shG));

    /* transformer kiosk in the middle (10 kV comes in from behind) */
    var tp = el('g', null, svg);
    el('path', { d: 'M' + (TPX - 62) + ',885 L' + (TPX - 62) + ',706 L' + (TPX + 62) + ',706 L' + (TPX + 62) + ',885 Z', fill: '#BFC3C0' }, tp);
    el('path', { d: 'M' + (TPX - 72) + ',710 L' + TPX + ',670 L' + (TPX + 72) + ',710 Z', fill: '#5E6266' }, tp);
    el('rect', { x: TPX - 44, y: 734, width: 38, height: 130, fill: '#A2A8A5' }, tp);
    el('rect', { x: TPX + 6, y: 734, width: 38, height: 130, fill: '#A2A8A5' }, tp);
    var tpl = el('text', { x: TPX, y: 652, 'text-anchor': 'middle', 'class': 'st-lbl' }, tp); tpl.textContent = 'transformer';

    R.houses = [];
    for (i = 0; i < 6; i++) R.houses.push(buildHouse(svg, i));

    /* poles + two LV lines from the transformer outwards */
    var wires = el('g', null, svg);
    POLES.forEach(function (x) {
      el('rect', { x: x - 6, y: WIRE_Y - 12, width: 12, height: BASE + 30 - WIRE_Y + 12, fill: '#77706A' }, wires);
      el('rect', { x: x - 26, y: WIRE_Y - 6, width: 52, height: 7, rx: 2, fill: '#57524C' }, wires);
    });
    function linePath(side) {
      var xs = side ? [1282, 1502, 1722] : [638, 418, 198];
      var d = 'M' + (TPX + (side ? 62 : -62)) + ',728 Q' + (TPX + (side ? 180 : -180)) + ',' + (WIRE_Y + 30) + ' ' + xs[0] + ',' + (WIRE_Y - 8);
      for (var k = 1; k < xs.length; k++) d += ' Q' + ((xs[k - 1] + xs[k]) / 2) + ',' + (WIRE_Y + 20) + ' ' + xs[k] + ',' + (WIRE_Y - 8);
      return d;
    }
    R.flow = [];
    [0, 1].forEach(function (side) {
      var d = linePath(side);
      el('path', { d: d, fill: 'none', stroke: '#22272B', 'stroke-width': 4 }, wires);
      R.flow.push(el('path', { d: d, fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': '2 28' }, wires));
    });
    for (i = 0; i < 6; i++) {
      var h = HOUSES[i], left = HX[i] - h.w / 2, pr = POLES[i], side = LINE[i];
      var hx2 = side ? left - 6 : left + h.w + 6, ht = BASE - h.h + 8;
      el('path', { d: 'M' + pr + ',' + (WIRE_Y + 10) + ' Q' + ((pr + hx2) / 2) + ',' + (ht - 20) + ' ' + hx2 + ',' + ht, fill: 'none', stroke: '#22272B', 'stroke-width': 2 }, wires);
    }

    /* SunGuard radio within each line */
    R.radio = el('g', { 'class': 'guard-off sg-hidden' }, svg);
    R.links = []; R.ripples = [];
    for (i = 0; i < 6; i++) {
      if (POS[i] < 2) {
        var p1 = boxPos(i), p2 = boxPos(i + 1);
        var ld = 'M' + p1.x + ',' + p1.y + ' Q' + ((p1.x + p2.x) / 2) + ',' + (Math.min(p1.y, p2.y) - 170) + ' ' + p2.x + ',' + p2.y;
        var lg = el('g', { opacity: '0' }, R.radio);
        el('path', { d: ld, fill: 'none', stroke: '#BFE6FA', 'stroke-width': 4, 'stroke-linecap': 'round', 'class': 'link-flow' }, lg);
        R.links.push(lg);
      } else R.links.push(null);
      var bp = boxPos(i), rg = el('g', { opacity: '0' }, R.radio);
      for (var k = 0; k < 2; k++) el('circle', { cx: bp.x, cy: bp.y, r: 150, fill: 'none', stroke: '#9FD8F5', 'stroke-width': 4, 'class': 'rip', style: 'animation-delay:' + (POS[i] * 0.25 + k * 1.3).toFixed(2) + 's' }, rg);
      R.ripples.push(rg);
    }
    R.bursts = el('g', null, R.radio);

    buildData(svg);
    R.dark = el('rect', { x: 0, y: 0, width: W, height: H, fill: '#0A1028', opacity: '0', 'pointer-events': 'none' }, svg);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#stVign)', 'pointer-events': 'none' }, svg);
    svg.appendChild(R.dataG);
    root.appendChild(svg);
    R.svg = svg;
  }

  function boxPos(i) { var h = HOUSES[i], side = LINE[i]; return { x: HX[i] + (side ? -1 : 1) * (h.w / 2 - 42), y: BASE - h.h + 62 }; }

  function buildHouse(svg, i) {
    var h = HOUSES[i], g = el('g', null, svg);
    var left = HX[i] - h.w / 2, right = left + h.w, top = BASE - h.h, roofH = 74;
    el('rect', { x: left, y: top, width: h.w, height: h.h, fill: h.wall }, g);
    var courses = el('g', { stroke: '#000', 'stroke-opacity': '.04', 'stroke-width': 1.5 }, g);
    for (var y = top + 24; y < BASE - 4; y += 24) el('line', { x1: left, y1: y, x2: right, y2: y }, courses);
    el('rect', { x: left, y: top, width: h.w, height: h.h, fill: 'url(#stWallShade)' }, g);
    el('path', { d: 'M' + (left - 14) + ',' + top + ' L' + (right + 14) + ',' + top + ' L' + (right - 30) + ',' + (top - roofH) + ' L' + (left + 30) + ',' + (top - roofH) + ' Z', fill: h.roof }, g);
    var rows = h.panels[0], cols = h.panels[1];
    var T = { bl: [left + 4, top - 8], br: [right - 4, top - 8], tl: [left + 36, top - roofH + 8], tr: [right - 36, top - roofH + 8] };
    function P(u, v) { var bx = lerp(T.bl[0], T.br[0], u), by = lerp(T.bl[1], T.br[1], u), tx = lerp(T.tl[0], T.tr[0], u), ty = lerp(T.tl[1], T.tr[1], u); return [lerp(bx, tx, v), lerp(by, ty, v)]; }
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var u0 = c / cols + 0.015, u1 = (c + 1) / cols - 0.015, v0 = r / rows + 0.05, v1 = (r + 1) / rows - 0.05;
      el('path', { d: 'M' + P(u0, v0) + ' L' + P(u1, v0) + ' L' + P(u1, v1) + ' L' + P(u0, v1) + ' Z', fill: 'url(#stPanel)', stroke: '#B8C0C8', 'stroke-width': 1.2 }, g);
    }
    var wy = top + 36, ww = 42, wh = 50, side = LINE[i];
    var wx = side ? right - 26 - ww : left + 26;
    el('rect', { x: wx - 4, y: wy - 4, width: ww + 8, height: wh + 8, rx: 3, fill: '#E8E4DC' }, g);
    el('rect', { x: wx, y: wy, width: ww, height: wh, fill: 'url(#stGlass)' }, g);
    el('rect', { x: HX[i] - 22, y: BASE - 80, width: 44, height: 80, rx: 3, fill: '#5E534B' }, g);
    var bp = boxPos(i), ix = bp.x + (side ? -40 : 40);
    el('rect', { x: ix - 17, y: bp.y - 24, width: 34, height: 46, rx: 5, fill: '#EEF0EF', stroke: '#9AA3A0', 'stroke-width': 1.5 }, g);
    var sgG = el('g', { opacity: '0' }, g);
    var halo = el('circle', { cx: bp.x, cy: bp.y, r: 62, fill: 'url(#stSgGlow)', 'class': 'sg-halo', opacity: '0' }, sgG);
    var body = el('rect', { x: bp.x - 16, y: bp.y - 22, width: 32, height: 44, rx: 6, fill: '#2A3238', stroke: '#9AA3A8', 'stroke-width': 2 }, sgG);
    var led = el('circle', { cx: bp.x, cy: bp.y + 6, r: 5, fill: '#7a8a84' }, sgG);
    return { g: g, sg: sgG, halo: halo, body: body, led: led, left: left, right: right, top: top };
  }

  function vy(v) { return PB - (v - 230) * PPV; }

  function buildData(svg) {
    var g = el('g', { 'class': 'st-data' }, svg); R.dataG = g;
    var yl = vy(LIMIT);
    R.limitL = el('line', { x1: 150, y1: yl, x2: TPX - 150, y2: yl, stroke: '#F3F1EC', 'stroke-width': 4, 'stroke-dasharray': '16 10', opacity: '.9' }, g);
    R.limitR = el('line', { x1: TPX + 150, y1: yl, x2: 1770, y2: yl, stroke: '#F3F1EC', 'stroke-width': 4, 'stroke-dasharray': '16 10', opacity: '.9' }, g);
    var lt = el('text', { x: TPX, y: yl - 4, 'text-anchor': 'middle', 'class': 'st-limit' }, g); lt.textContent = 'legal limit';
    var lt2 = el('text', { x: TPX, y: yl + 34, 'text-anchor': 'middle', 'class': 'st-limit' }, g); lt2.textContent = '242 V';
    R.pillars = []; R.outs = [];
    for (var i = 0; i < 6; i++) {
      el('line', { x1: HX[i], y1: PB + 26, x2: HX[i], y2: BASE - HOUSES[i].h - 78, stroke: 'rgba(255,255,255,.4)', 'stroke-width': 2, 'stroke-dasharray': '2 6' }, g);
      el('rect', { x: HX[i] - 20, y: PB - 2, width: 40, height: 4, rx: 2, fill: 'rgba(255,255,255,.5)' }, g);
      R.pillars.push(el('rect', { x: HX[i] - 17, y: PB, width: 34, height: 0, rx: 8 }, g));
      el('rect', { x: HX[i] - 45, y: PB + 12, width: 90, height: 10, rx: 5, fill: 'rgba(20,24,28,.45)' }, g);
      R.outs.push(el('rect', { x: HX[i] - 45, y: PB + 12, width: 0, height: 10, rx: 5, fill: SOLAR }, g));
    }
    /* one big gauge per line, above its LAST house: "last house" · "252 V" · "limit 242 V" */
    R.gauge = [];
    [2, 5].forEach(function (i, side) {
      var x = side ? 1660 : 260, gg = el('g', null, g);
      var bg = el('rect', { x: x - 170, y: 70, width: 340, height: 196, rx: 26, fill: 'rgba(14,20,26,.78)', 'stroke-width': 5 }, gg);
      var t1 = el('text', { x: x, y: 116, 'text-anchor': 'middle', 'class': 'st-g1' }, gg); t1.textContent = 'last house';
      var t2 = el('text', { x: x, y: 204, 'text-anchor': 'middle', 'class': 'st-g2' }, gg);
      var t3 = el('text', { x: x, y: 248, 'text-anchor': 'middle', 'class': 'st-g3' }, gg); t3.textContent = 'limit 242 V';
      R.gauge.push({ bg: bg, t2: t2, t3: t3, house: i });
    });
    /* line labels on the road */
    R.lineLbl = [];
    [0, 1].forEach(function (side) {
      var x = side ? 1392 : 528, gg = el('g', null, g);
      var bg = el('rect', { x: x - 175, y: 950, width: 350, height: 58, rx: 29, fill: 'rgba(14,20,26,.7)', stroke: 'rgba(255,255,255,.25)', 'stroke-width': 2 }, gg);
      var t = el('text', { x: x, y: 990, 'text-anchor': 'middle', 'class': 'st-line' }, gg);
      R.lineLbl.push({ bg: bg, t: t });
    });
  }

  /* ---------- render: only what changed ---------- */
  function renderSun() {
    var s = S.sun;
    var sunX = 330 + 630 * s, sunY = 800 - 550 * Math.sin(s * Math.PI / 2);   /* dawn: low left -> noon: above the transformer */
    setA(R.sunG, 'transform', 'translate(' + sunX.toFixed(1) + ',' + sunY.toFixed(1) + ')');
    setA(R.skyTop, 'stop-color', ramp(SKY.top, s));
    setA(R.skyMid, 'stop-color', ramp(SKY.mid, s));
    setA(R.skyHor, 'stop-color', ramp(SKY.hor, s));
    var gc = ramp(SKY.sunGlow, s);
    setA(R.glow0, 'stop-color', gc); setA(R.glow1, 'stop-color', gc); setA(R.glow2, 'stop-color', gc);
    setA(R.core1, 'stop-color', ramp(SKY.sunCore, s));
    setA(R.ridge, 'fill', ramp(SKY.ridge, s));
    setA(R.far, 'fill', ramp(SKY.far, s));
    setA(R.near, 'fill', ramp(SKY.near, s));
    setA(R.grass, 'fill', ramp(SKY.near, s));
    setA(R.walk, 'fill', ramp(SKY.walk, s));
    setA(R.road, 'fill', ramp(SKY.road, s));
    var px = s - 0.5;
    setA(R.ridgeG, 'transform', 'translate(' + (-12 * px).toFixed(1) + ',0)');
    setA(R.farG, 'transform', 'translate(' + (-26 * px).toFixed(1) + ',0)');
    setA(R.nearG, 'transform', 'translate(' + (-44 * px).toFixed(1) + ',0)');
    setA(R.dark, 'opacity', (0.28 * Math.pow(1 - s, 1.6)).toFixed(3));
    var elev = clamp((800 - sunY) / 550, 0, 1), len = 26 + 70 * (1 - elev);
    R.houses.forEach(function (hs, i) {
      var dxs = clamp((HX[i] - sunX) * (0.22 + 0.5 * (1 - elev)), -220, 220);
      setA(R.shadows[i], 'd', 'M' + (hs.left - 6) + ',' + BASE + ' L' + (hs.right + 6) + ',' + BASE + ' L' + (hs.right + 6 + dxs).toFixed(0) + ',' + (BASE + len).toFixed(0) + ' L' + (hs.left - 6 + dxs).toFixed(0) + ',' + (BASE + len).toFixed(0) + ' Z');
      setA(R.shadows[i], 'opacity', (0.5 + 0.4 * (1 - elev)).toFixed(2));
    });
  }
  function renderData() {
    var m = model(S.sun, S.act);
    S.last = m;
    for (var i = 0; i < 6; i++) {
      var v = m.v[i], lv = level(v), top = vy(v), p = R.pillars[i];
      var accent = S.show || POS[i] === 2;   /* S2: only the last houses carry colour */
      setA(p, 'y', top.toFixed(1)); setA(p, 'height', Math.max(0, PB - top).toFixed(1));
      setA(p, 'fill', accent ? COL[lv] : 'rgba(236,236,232,.55)');
      setA(p, 'class', accent && lv === 2 ? 'st-pill over' : 'st-pill');
      setA(R.outs[i], 'width', (90 * m.out[i]).toFixed(1));
      var hs = R.houses[i], a = S.act[i];
      setA(hs.led, 'fill', a > 0.5 ? SG : '#7a8a84');
      setA(hs.body, 'stroke', a > 0.5 ? SG : '#9AA3A8');
      setA(hs.halo, 'opacity', a > 0.5 ? '1' : '0');
      setA(hs.sg, 'opacity', S.show ? (a > 0.5 ? '1' : '0.35') : '0');
      setA(R.ripples[i], 'opacity', S.show && a > 0.5 ? '1' : '0');
      if (R.links[i]) setA(R.links[i], 'opacity', S.show && a > 0.5 && S.act[i + 1] > 0.5 ? '1' : '0');
    }
    R.gauge.forEach(function (gg, side) {
      var v = m.v[gg.house], lv = level(v);
      setA(gg.bg, 'stroke', COL[lv]);
      setA(gg.t2, 'fill', TXT[lv]);
      if (gg.t2.textContent !== Math.round(v) + ' V') gg.t2.textContent = Math.round(v) + ' V';
      var t3 = lv === 2 ? 'OVER the 242 V limit' : 'limit 242 V';
      if (gg.t3.textContent !== t3) gg.t3.textContent = t3;
      setA(gg.t3, 'fill', lv === 2 ? '#FF8A57' : 'rgba(255,255,255,.75)');
    });
    R.lineLbl.forEach(function (L, side) {
      var on = S.actT[side * 3] > 0.5, txt = S.show ? (on ? '✓ with SunGuard' : 'without SunGuard') : (side ? 'right line' : 'left line');
      if (L.t.textContent !== txt) L.t.textContent = txt;
      setA(L.bg, 'stroke', S.show && on ? SG : 'rgba(255,255,255,.25)');
      setA(L.t, 'fill', S.show && on ? '#BFE6FA' : '#F3F1EC');
    });
    var outL = (m.out[0] + m.out[1] + m.out[2]) / 3 - 0.3, outR = (m.out[3] + m.out[4] + m.out[5]) / 3 - 0.3;
    S.flowSpeed = [outL * 150, outR * 150];
    [outL, outR].forEach(function (net, side) {
      setA(R.flow[side], 'stroke', net > 0 ? '#F3D98A' : '#BCD4E6');
      setA(R.flow[side], 'opacity', (0.3 + 0.6 * clamp(Math.abs(net) * 1.6, 0, 1)).toFixed(2));
    });
  }

  function frame(t) {
    S.raf = 0;
    if (!S.active) return;
    var dt = S.lastT ? Math.min(0.1, (t - S.lastT) / 1000) : 0.016;
    S.lastT = t;
    if (S.dur > 0) {
      if (S.pause > 0) S.pause -= dt * 1000; else S.el += dt * 1000;
      var p = clamp(S.el / S.dur, 0, 1), e = S.dur <= 150 ? p : (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
      S.sun = lerp(S.from, S.to, e);
      if (p >= 1) S.dur = 0;
    } else S.sun = S.to;
    for (var j = 0; j < 6; j++) {
      if (t < S.actAt[j] || S.act[j] === S.actT[j]) continue;
      var p = reduced ? 1 : Math.min(1, (t - S.actAt[j]) / 450), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;   /* ease-in-out */
      S.act[j] = p >= 1 ? S.actT[j] : S.actFrom[j] + (S.actT[j] - S.actFrom[j]) * e;
    }
    var actKey = S.act.map(function (x) { return x.toFixed(3); }).join(',');
    var sunChanged = Math.abs(S.sun - S.drawnSun) > 1e-4;
    if (sunChanged) { renderSun(); S.drawnSun = S.sun; }
    if (sunChanged || actKey !== S.drawnAct || S.drawnShow !== S.show) { renderData(); S.drawnAct = actKey; S.drawnShow = S.show; }
    var over = S.last && (S.last.v[2] > LIMIT + 0.05 || S.last.v[5] > LIMIT + 0.05);
    if (over && !S.wasOver && S.dur > 2000 && !S.froze && !reduced) { S.pause = 1000; S.froze = true; }
    S.wasOver = over;
    if (!reduced) {
      S.flow -= dt;
      setA(R.flow[0], 'stroke-dashoffset', (S.flow * (S.flowSpeed ? -S.flowSpeed[0] : 0)).toFixed(1));
      setA(R.flow[1], 'stroke-dashoffset', (S.flow * (S.flowSpeed ? S.flowSpeed[1] : 0)).toFixed(1));
    }
    S.raf = requestAnimationFrame(frame);
  }
  function kick() { if (S.active && !S.raf) { S.lastT = 0; S.raf = requestAnimationFrame(frame); } }
  function redrawNow() { renderSun(); renderData(); S.drawnSun = S.sun; S.drawnAct = ''; S.drawnShow = S.show; }

  function setLines(n) {
    n = clamp(Math.round(+n || 0), 0, 2);
    var now = performance.now(), prev = S.lines;
    S.lines = n;
    for (var j = 0; j < 6; j++) {
      var on = LINE[j] < n ? 1 : 0;
      if (on !== S.actT[j]) { S.actT[j] = on; S.actFrom[j] = S.act[j]; S.actAt[j] = now + (on ? POS[j] * 250 : 0); }
    }
    R.radio.classList.toggle('guard-off', n === 0);
    if (!S.active) { for (j = 0; j < 6; j++) S.act[j] = S.actT[j]; redrawNow(); }
    kick();
    return n;
  }

  var api = {
    init: function (root) { build(root); redrawNow(); },
    setActive: function (on) { S.active = !!on; if (on) kick(); else if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } },
    setSun: function (v, ms) {
      v = clamp(+v || 0, 0, 1);
      S.from = S.sun; S.to = v; S.el = 0; S.pause = 0; S.froze = false;
      S.dur = reduced ? Math.min(ms || 0, 120) : (ms == null ? 120 : ms);
      if (!S.active) { S.sun = v; S.dur = 0; redrawNow(); }
      kick();
    },
    sweepSun: function (v, ms) { api.setSun(v, ms == null ? 6000 : ms); },
    getSun: function () { return S.to; },
    setLines: setLines,
    lines: function () { return S.lines; },
    /* same pair as street3d.js: setGuard = LEFT line (keeps the right one), setGuardRight = RIGHT line */
    setGuard: function (on) { return setLines(on ? Math.max(1, S.lines) : 0); },
    setGuardRight: function (on) { return setLines(on ? 2 : Math.min(S.lines, 1)); },
    setBoxes: function (show) { S.show = !!show; R.radio.classList.toggle('sg-hidden', !show); if (!S.active) redrawNow(); else kick(); },
    setBoxCount: function (k) { return setLines(k >= 6 ? 2 : (k >= 1 ? 1 : 0)) * 3; },
    addBox: function () { return setLines(S.lines + 1) * 3; },
    boxes: function () { return S.lines * 3; },
    cutPercent: function () { var m = model(S.sun, S.act); return Math.round(100 * Math.max(m.cut[0], m.cut[1])); },
    boxedHouses: function () { return S.actT.map(function (x) { return x > 0.5; }); },
    pulse: function () {
      for (var i = 0; i < 6; i++) {
        if (S.actT[i] < 0.5) continue;
        var bp = boxPos(i);
        var c = el('circle', { cx: bp.x, cy: bp.y, r: 230, fill: 'none', stroke: '#CDEBFA', 'stroke-width': 5, 'class': 'burst', style: 'animation-delay:' + (POS[i] * 0.14).toFixed(2) + 's;opacity:0' }, R.bursts);
        (function (c) { setTimeout(function () { c.remove(); }, 2400); })(c);
      }
    },
    volts: function () { return S.last ? S.last.v.slice() : null; },
    state: function () { var m = S.last || model(S.sun, S.act); return { sun: S.sun, target: S.to, lines: S.lines, left: S.lines >= 1, right: S.lines >= 2, boxes: S.lines * 3, cut: m.cut, out: m.out, renderer: '2d' }; }
  };
  window.Street = api;
})();
