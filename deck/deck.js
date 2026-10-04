/* Grino #27 deck engine: screens, keyboard, remote commands (via transport.js), per-screen visuals. */
(function () {
  'use strict';
  var cfg = window.GRINO, DATA = window.DECK_DATA || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var body = document.body, stage = $('#stage');
  /* slide order = GRINO.SCREENS (ids); the DOM is re-ordered to match */
  var slides = (function () {
    var all = $$('.slide'), byId = {}, st = document.getElementById('stage'), plate = document.getElementById('plate');
    all.forEach(function (s) { byId[s.dataset.id] = s; });
    var order = (cfg.SCREENS || []).map(function (x) { return byId[x.id]; }).filter(Boolean);
    all.forEach(function (s) { if (order.indexOf(s) < 0) order.push(s); });
    order.forEach(function (s) { st.insertBefore(s, plate || null); });
    return order;
  })();
  var ids = slides.map(function (s) { return s.dataset.id; });
  function clampN(x, a, b) { return Math.max(a, Math.min(b, x)); }

  var state = { i: -1, sun: (cfg.PRE_DAWN != null ? +cfg.PRE_DAWN : 0.08), guard: false, lines: 0, qr: false, black: false, help: false };
  var DAWN = (cfg.PRE_DAWN != null ? +cfg.PRE_DAWN : 0.08);   /* S2 entry: before sunrise */
  window.DECK = { state: state, log: [] }; /* for tests / debugging */

  /* ---------------- scale 1920×1080 stage to the window ---------------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty('--s', s.toFixed(5));
    var plateTop = (window.innerHeight - 1080 * s) / 2 + 984 * s;
    document.documentElement.style.setProperty('--plateVH', Math.max(0, window.innerHeight - plateTop).toFixed(1) + 'px');
  }
  window.addEventListener('resize', fit); fit();

  /* ---------------- helpers ---------------- */
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function animateCounts(slide) {
    var host = slide.closest ? (slide.closest('.slide') || slide) : slide;
    $$('.count', slide).forEach(function (el) {
      var to = +el.dataset.to, t0 = performance.now(), dur = to > 1000 ? 1700 : 900;
      if (reduced) { el.textContent = fmtInt(to); return; }
      el.textContent = '0';
      (function step(t) {
        if (!host.classList.contains('active')) { el.textContent = fmtInt(to); return; }
        var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmtInt(to * e);
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  /* ---------------- S1 cover + S11 names from config (one place) ---------------- */
  (function () {
    var c = cfg.COVER || {}, team = cfg.TEAM_FULL || [];
    var title = cfg.COVER_TITLE || c.title, line = cfg.COVER_LINE || c.description;
    if (title) $('#cvTitle').textContent = title.replace(/over-voltage/g, 'over‑voltage');
    if (line) $('#cvDesc').textContent = line;
    if (c.track) $('#cvTrack').textContent = c.track;
    if (c.team) $('#cvTeam').textContent = c.team;
    if (cfg.PRESENTER) $('#cvPresenter').textContent = cfg.PRESENTER;
    if (team.length) {   /* a line may break only between names, never inside one */
      var ct = $('#cvTeamNames'); ct.innerHTML = '';
      team.forEach(function (n, i) { var sp = document.createElement('span'); sp.className = 'nm'; sp.textContent = n + (i < team.length - 1 ? ',' : ''); ct.appendChild(sp); if (i < team.length - 1) ct.appendChild(document.createTextNode(' ')); });
    }
    var people = [cfg.PRESENTER].concat(team).filter(Boolean), study = cfg.TEAM_STUDY || {};
    var roles = people.every(function (n) { return study[n] && String(study[n]).trim(); }) ? study : {};   /* all five or none */
    var tn = $('#teamNames'); tn.innerHTML = '';
    tn.classList.toggle('with-study', roles === study);
    people.forEach(function (n) {
      var sp = document.createElement('span'); sp.className = 'tm';
      var b = document.createElement('b'); b.textContent = n; sp.appendChild(b);
      if (roles[n]) { var r = document.createElement('i'); r.textContent = roles[n]; sp.appendChild(r); }
      tn.appendChild(sp);
    });
  })();

  /* ---------------- S3: one number at a time; the earlier ones shrink into the left column ---------------- */
  (function () {
    var house = '<svg viewBox="0 0 40 40"><path class="h" d="M20 3 L37 17 V37 H3 V17 Z"/></svg>', html = '';
    for (var i = 0; i < 100; i++) html += house;
    $('#houses100').innerHTML = html;
    /* F4 month bars (hidden unless GRINO.S3_SHOW_BARS) */
    var ov = cfg.OVERVOLTAGE_PCT || [], host = $('#ovBars');
    var vmax = Math.max.apply(null, ov.map(function (o) { return o.pct; }).concat([10]));
    var scale = Math.ceil(vmax * 1.12 / 5) * 5;
    ov.forEach(function (o, i) {
      var b = document.createElement('div'); b.className = 'bar' + (o.hot ? ' hot' : (i > 0 && i < ov.length - 1 ? ' mid' : ''));
      b.style.setProperty('--h', (o.pct / scale * 100).toFixed(1) + '%');
      b.innerHTML = '<span class="bv">' + o.pct.toFixed(1) + '%</span><span class="bl">' + o.label + '</span>';
      host.appendChild(b);
    });
    $('#s3BarsWrap').hidden = !cfg.S3_SHOW_BARS;
    /* S3 headline from GRINO.S3_HEADLINE only */
    var hd = cfg.S3_HEADLINE || {}, big = $('#s3Big');
    if (hd.countTo) big.innerHTML = '<span>' + (hd.prefix || '') + '</span><span class="count" data-fmt="int" data-to="' + (+hd.countTo) + '">' + fmtInt(hd.countTo) + '</span>';
    else if (hd.big) big.textContent = hd.big;
    if (hd.pct != null) $('#s3Pct').textContent = hd.pct;
    if (hd.caption) $('#s3Cap').textContent = hd.caption.replace(/-/g, '‑');
    if (hd.footnote) $('#s3Foot').textContent = hd.footnote;
  })();
  /* S3 state k: 0 = headline only, 1..3 = beat k is current, earlier beats shrink into the left column */
  var iconTimers = [], s3Filled = false;
  function s3State(k) {
    var beats = $$('[data-id="s3"] .beat'), icons = $$('#houses100 .h'), past = $('#s3Past');
    var share = Math.max(0, Math.min(100, Math.round(parseFloat((cfg.S3_HEADLINE || {}).pct) || 36)));
    beats.forEach(function (b, j) {
      var cur = j === k - 1, wasCur = b.classList.contains('on') && !b.classList.contains('dim');
      b.classList.toggle('on', j < k);
      b.classList.toggle('dim', j < k - 1);
      if (cur && !wasCur) animateCounts(b);
    });
    while (past.children.length > Math.max(0, k - 1)) past.removeChild(past.lastChild);
    for (var j = past.children.length; j < k - 1; j++) {
      var sh = (beats[j].dataset.short || '|').split('|'), pi = document.createElement('div');
      pi.className = 'pi'; pi.innerHTML = '<b></b><span></span>'; pi.firstChild.textContent = sh[0]; pi.lastChild.textContent = sh[1];
      if (sh[2]) { var em = document.createElement('em'); em.textContent = sh[2]; pi.appendChild(em); }   /* S3: the regulator line stays visible */
      past.appendChild(pi);
      (function (pi) { requestAnimationFrame(function () { requestAnimationFrame(function () { pi.classList.add('on'); }); }); })(pi);
    }
    var fill = k >= 2;
    if (fill && !s3Filled) icons.forEach(function (h, i) {
      if (i >= share) return;
      if (reduced) h.classList.add('on'); else iconTimers.push(setTimeout(function () { h.classList.add('on'); }, 250 + i * 25));
    });
    if (!fill) { iconTimers.forEach(clearTimeout); iconTimers = []; icons.forEach(function (h) { h.classList.remove('on'); }); }
    s3Filled = fill;
  }
  var STEP = { k: 0, n: 0, timers: [] };
  function stepCount(id) {
    if (id === 's3') return 3;
    if (id === 's7') return 5;
    if (id === 's8') return 5;
    if (id === 's5' || id === 's6b') return $$('[data-id="' + id + '"] .rv').length;
    return 0;
  }
  function enterSteps(id) {
    STEP.timers.forEach(clearTimeout); STEP.timers = [];
    STEP.n = stepCount(id); STEP.k = -1;
    if (!STEP.n) { STEP.k = 0; return; }
    applyStep(0, true);
    var sc = (cfg.STEPS || {})[id] || {};
    if (reduced && id !== 's7') { applyStep(STEP.n); return; }
    var times = Array.isArray(sc.auto) ? sc.auto : (sc.auto === 'stagger' ? Array.apply(null, Array(STEP.n)).map(function (_, i) { return (sc.start || 0.5) + i * (sc.every || 0.7); }) : []);
    times.forEach(function (t, i) {
      STEP.timers.push(setTimeout(function () { if (ids[state.i] === id && STEP.k === i) { applyStep(i + 1); publishStateSoon(); } }, t * 1000));
    });
  }
  function stepTo(k) {   /* manual (remote / keyboard / autopilot): auto timers stop */
    if (!STEP.n) return;
    STEP.timers.forEach(clearTimeout); STEP.timers = [];
    applyStep(clampN(k | 0, 0, STEP.n));
  }
  function applyStep(k) {
    var id = ids[state.i]; STEP.k = k;
    if (id === 's3') s3State(k);
    else if (id === 's5' || id === 's6b') $$('[data-id="' + id + '"] .rv').forEach(function (el, i) { el.classList.toggle('on', i < k); });
    else if (id === 's7') s7Step(k);
    else if (id === 's8') partsStep(k);
  }

  /* ---------------- S6 map + hosting bars ---------------- */
  var mapBuilt = false;
  function buildMap() {
    if (mapBuilt || !DATA.marz) return; mapBuilt = true;
    var svg = $('#marzMap'), NS = 'http://www.w3.org/2000/svg';
    var rows = {}; (cfg.S6_MARZ || []).forEach(function (r) { rows[r.marz] = r; });
    var vals = Object.keys(rows).map(function (k) { return rows[k].per10k; });
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
    function col(v) {
      var t = (v - mn) / Math.max(1, mx - mn);
      var stops = [[0, [44, 64, 56]], [0.5, [138, 116, 72]], [1, [255, 181, 71]]];
      for (var i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
        var u = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]), a = stops[i - 1][1], b = stops[i][1];
        return 'rgb(' + [0, 1, 2].map(function (k) { return Math.round(a[k] + (b[k] - a[k]) * u); }).join(',') + ')';
      }
      return 'rgb(255,181,71)';
    }
    var OFF = { 'Yerevan': [-215, 215], 'Kotayk': [8, -14], 'Shirak': [6, 10], 'Armavir': [-8, 6], 'Aragatsotn': [-6, -4], 'Ararat': [14, 18],
                'Gegharkunik': [-10, 0], 'Vayots Dzor': [0, 4], 'Syunik': [-36, 20], 'Tavush': [-6, 16], 'Lori': [0, 12] };
    var gShapes = document.createElementNS(NS, 'g'), gLab = document.createElementNS(NS, 'g');
    svg.appendChild(gShapes); svg.appendChild(gLab);
    function txt(cls, x, y, s) { var t = document.createElementNS(NS, 'text'); t.setAttribute('class', cls); t.setAttribute('x', x); t.setAttribute('y', y); t.textContent = s; gLab.appendChild(t); return t; }
    DATA.marz.shapes.forEach(function (s, i) {
      var r = rows[s.name] || { per10k: 0, lines: 0 };
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', s.d); p.setAttribute('class', 'marz'); p.setAttribute('fill', col(r.per10k));
      p.style.transitionDelay = (0.2 + i * 0.06) + 's';
      var tt = document.createElementNS(NS, 'title'); tt.textContent = s.name + ': ' + Number(r.per10k).toFixed(1) + ' problem lines per 10,000 customers, ' + fmtInt(r.lines) + ' lines'; p.appendChild(tt);
      gShapes.appendChild(p);
      var off = OFF[s.name] || [0, 0], lx = s.cx + off[0], ly = s.cy + off[1];
      if (s.name === 'Yerevan') {
        var ln = document.createElementNS(NS, 'path');
        ln.setAttribute('d', 'M' + s.cx + ',' + s.cy + ' L' + (lx + 40) + ',' + (ly - 70));
        ln.setAttribute('stroke', '#FFE3A3'); ln.setAttribute('stroke-width', '3'); ln.setAttribute('fill', 'none'); gLab.appendChild(ln);
        var dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', s.cx); dot.setAttribute('cy', s.cy); dot.setAttribute('r', 8); dot.setAttribute('fill', '#FFE3A3'); gLab.appendChild(dot);
      }
      txt('mz-name', lx, ly - 34, s.name);
      txt('mz-big', lx, ly + 12, Number(r.per10k).toFixed(1));
      txt('mz-small', lx, ly + 40, fmtInt(r.lines) + ' lines');
    });
  }

  /* ---------------- S8 exploded box ---------------- */
  function buildBox() {
    var host = $('#boxIll'); if (!host || host.firstChild) return;
    var NS = 'http://www.w3.org/2000/svg', C = 0.866, Sn = 0.5;
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 960 790'); host.appendChild(svg);
    var defs = document.createElementNS(NS, 'defs'); svg.appendChild(defs);
    defs.innerHTML = '<radialGradient id="bxGlow"><stop offset="0" stop-color="#FFB547" stop-opacity=".35"/><stop offset="1" stop-color="#FFB547" stop-opacity="0"/></radialGradient>';
    var glow = document.createElementNS(NS, 'ellipse'); glow.setAttribute('cx', 330); glow.setAttribute('cy', 470); glow.setAttribute('rx', 360); glow.setAttribute('ry', 300); glow.setAttribute('fill', 'url(#bxGlow)'); svg.appendChild(glow);
    var OX = 300, OY = 505, LABEL_Y = { 'microcontroller with Wi-Fi': 200, 'link to the inverter': 345, 'power supply': 490, 'voltage sensor': 635 };
    function P(x, y, z) { return [OX + (x - y) * C, OY + (x + y) * Sn - z]; }
    function poly(g, pts, fill, extra) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M' + pts.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' L') + ' Z');
      p.setAttribute('fill', fill); if (extra) for (var k in extra) p.setAttribute(k, extra[k]);
      g.appendChild(p); return p;
    }
    function box(g, x, y, z, w, d, h, top, left, right, op) {
      var ex = op ? { 'fill-opacity': op } : null;
      poly(g, [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], left, ex);
      poly(g, [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], right, ex);
      poly(g, [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], top, ex);
    }
    function part(z0, from, delay, draw, label, sub, anchor) {
      var g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'part');
      g.style.setProperty('--from', from + 'px'); g.style.setProperty('--pd', delay + 's'); if (label) g.setAttribute('data-name', label);
      svg.appendChild(g); draw(g, z0);
      if (label) {
        var a = P(anchor[0], anchor[1], z0 + anchor[2]);
        var lx = 640, ly = LABEL_Y[label] != null ? LABEL_Y[label] : a[1];
        var ln = document.createElementNS(NS, 'path'); ln.setAttribute('class', 'lead');
        ln.setAttribute('d', 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) + ' L' + (lx - 14) + ',' + (ly - 12).toFixed(1)); g.appendChild(ln);
        var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', a[0]); c.setAttribute('cy', a[1]); c.setAttribute('r', 5); c.setAttribute('fill', '#FFD98A'); g.appendChild(c);
        var t = document.createElementNS(NS, 'text'); t.setAttribute('x', lx); t.setAttribute('y', ly + 2); t.setAttribute('class', 'pl'); t.textContent = label; g.appendChild(t);
        if (sub) { var t2 = document.createElementNS(NS, 'text'); t2.setAttribute('x', lx); t2.setAttribute('y', ly + 36); t2.setAttribute('class', 'pls'); t2.textContent = sub; g.appendChild(t2); }
      }
      return g;
    }
    /* case base */
    part(0, 60, 0.2, function (g, z) {
      box(g, 0, 0, z, 260, 170, 58, '#EEF1EF', '#C6CCC9', '#AEB6B2');
      for (var i = 0; i < 6; i++) poly(g, [P(30 + i * 34, 170, z + 18), P(48 + i * 34, 170, z + 18), P(48 + i * 34, 170, z + 40), P(30 + i * 34, 170, z + 40)], '#9AA39F');
    }, '', '', null);
    /* PSU */
    part(110, 120, 0.35, function (g, z) {
      box(g, 20, 20, z, 96, 66, 36, '#2A2F33', '#1B1F22', '#23282B');
      poly(g, [P(34, 30, z + 36), P(100, 30, z + 36), P(100, 56, z + 36), P(34, 56, z + 36)], '#E9EEF0');
    }, 'power supply', '', [116, 30, 20]);
    /* ZMPT101B */
    part(110, 140, 0.45, function (g, z) {
      box(g, 140, 20, z, 110, 62, 6, '#2667B3', '#1A4C86', '#1E5799');
      box(g, 160, 30, z + 6, 46, 40, 38, '#3A463F', '#232B26', '#2C3530');
      box(g, 222, 36, z + 6, 16, 16, 14, '#4A8CDB', '#2F65A6', '#3874BD');
    }, 'voltage sensor', '', [250, 40, 6]);
    /* RS485 */
    part(205, 180, 0.55, function (g, z) {
      box(g, 40, 90, z, 90, 52, 6, '#2667B3', '#1A4C86', '#1E5799');
      box(g, 46, 100, z + 6, 26, 34, 16, '#34B262', '#21803F', '#299A4E');
      box(g, 92, 102, z + 6, 22, 22, 5, '#22262A', '#14171A', '#1B1E21');
    }, 'link to the inverter', '', [130, 100, 4]);
    /* ESP32 */
    part(290, 220, 0.65, function (g, z) {
      box(g, 60, 10, z, 150, 76, 6, '#24282C', '#15181B', '#1C2023');
      box(g, 90, 22, z + 6, 70, 52, 10, '#D5DADD', '#A9B0B4', '#BCC3C7');
      box(g, 170, 30, z + 6, 12, 12, 4, '#E7C46A', '#B79437', '#CBA74F');
      var a = P(176, 36, z + 10), b = P(176, 36, z + 120);
      var ant = document.createElementNS(NS, 'path'); ant.setAttribute('d', 'M' + a[0] + ',' + a[1] + ' L' + b[0] + ',' + b[1]);
      ant.setAttribute('stroke', '#3B4146'); ant.setAttribute('stroke-width', 9); ant.setAttribute('stroke-linecap', 'round'); g.appendChild(ant);
      [26, 46, 66].forEach(function (r, i) {
        var arc = document.createElementNS(NS, 'path');
        arc.setAttribute('d', 'M' + (b[0] - r) + ',' + (b[1] - 4) + ' A' + r + ',' + r + ' 0 0 1 ' + (b[0] + r) + ',' + (b[1] - 4));
        arc.setAttribute('stroke', '#9BE7FF'); arc.setAttribute('stroke-width', 3.5); arc.setAttribute('fill', 'none'); arc.setAttribute('opacity', (0.9 - i * 0.25).toFixed(2));
        arc.setAttribute('class', 'blink'); arc.style.animationDelay = (i * 0.25) + 's'; arc.style.animationDuration = '1.6s';
        g.appendChild(arc);
      });
    }, 'microcontroller with Wi-Fi', '', [210, 20, 6]);
    /* lid */
    part(410, 260, 0.8, function (g, z) {
      box(g, 0, 0, z, 260, 170, 18, '#E3EAE6', '#BFC8C3', '#A9B3AE', 0.55);
      var l = P(200, 140, z + 18); var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', l[0]); c.setAttribute('cy', l[1]); c.setAttribute('r', 8); c.setAttribute('fill', '#5BE59A'); g.appendChild(c);
    }, '', '', null);
  }

  /* ---------------- S8: realistic parts (window.Parts3D) if available, else the SVG exploded view ---------------- */
  var P3 = { tried: false, ok: false, timer: 0, i: 0 };
  var PART_NAMES = ['microcontroller with Wi-Fi', 'voltage sensor', 'link to the inverter', 'power supply'];
  function tryParts3D() {
    if (P3.tried) return; P3.tried = true;
    var p = new URLSearchParams(location.search);
    /* parts3d.js is an ES module (three.js): only over http(s); file:// keeps the SVG exploded view */
    if (p.has('flat') || location.protocol === 'file:') return;
    var dyn; try { dyn = new Function('u', 'return import(u)'); } catch (e) { return; }
    dyn('./assets/parts3d.js').then(function () {
      var P = window.Parts3D;
      if (!P || typeof P.init !== 'function') return;
      $('#parts3d').hidden = false;
      return Promise.resolve(P.init($('#parts3d'), { labels: true, active: false, exploded: false })).then(function (ok) {
        if (!ok || window.Parts3DFailed) { $('#parts3d').hidden = true; return; }
        P3.ok = true; $('#boxIll').style.display = 'none';
        if (ids[state.i] === 's8') { enterParts(); partsStep(STEP.k); }
      });
    }).catch(function (e) { $('#parts3d').hidden = true; console.info('[deck] parts3d unavailable, SVG stays:', e && e.message); });
  }
  /* S8 steps (absolute, idempotent): 0 assembled, nothing highlighted · 1 explode · 2 Voltage sensor ·
     3 Microcontroller with Wi-Fi · 4 Link to the inverter · 5 Power supply 230 V -> 5 V. One press = one state. */
  var PARTS_ORDER = ['Voltage sensor', 'Microcontroller', 'Link to the inverter', 'Power supply'];
  function partsIdx(L, n) { for (var i = 0; i < L.length; i++) if (String(L[i]).indexOf(n) === 0) return i; return -1; }
  function enterParts() {
    if (!P3.ok) return;
    try { var P = window.Parts3D; if (P.setActive) P.setActive(true); } catch (e) {}
  }
  function partsStep(k) {
    var name = k >= 2 ? PARTS_ORDER[k - 2] : null;
    /* SVG fallback: the named part stays bright, the others fade a little (400 ms) */
    $$('#boxIll .part').forEach(function (g) { var n = g.getAttribute('data-name'); g.style.opacity = !name || !n || n.toLowerCase().indexOf(name.toLowerCase()) === 0 ? '' : '0.45'; });
    if (!P3.ok) return;
    var P = window.Parts3D, L = P.LABELS || PART_NAMES;
    try {
      if (k === 0) { if (P.highlight) P.highlight(-1); if (P.assemble) P.assemble(700); }
      else if (k === 1) { if (P.highlight) P.highlight(-1); if (P.explode) P.explode(1200); }
      else { var st = P.state ? P.state() : null; if (st && st.target < 1 && P.explode) P.explode(600); if (P.highlight) P.highlight(partsIdx(L, name)); }
    } catch (e) { console.warn('[deck] parts step', e); }
  }
  function stopParts() {
    clearInterval(P3.timer);
    if (P3.ok) { try { window.Parts3D.setActive(false); } catch (e) {} }
  }

  /* ---------------- QR ---------------- */
  var qrDone = false;
  function makeQR(el, text, size) {
    el.innerHTML = '';
    if (typeof QRCode === 'undefined') { el.textContent = text; return; }
    try { new QRCode(el, { text: text, width: size, height: size, colorDark: '#0E1A15', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
    catch (e) { el.textContent = text; }
  }
  function buildQR() {
    if (qrDone) return; qrDone = true;
    makeQR($('#qrSmall'), cfg.FULL_RESEARCH_URL, 600);
    makeQR($('#qrBig'), cfg.FULL_RESEARCH_URL, 900);
    var qu = $('#qrUrl'); if (qu) qu.textContent = cfg.FULL_RESEARCH_URL.replace(/^https?:\/\//, '');
    $('#qrBigUrl').textContent = cfg.FULL_RESEARCH_URL;
  }

  /* ---------------- S7 calculator ---------------- */
  var frame = $('#calcFrame'), calcLoaded = false, calcSame = false, calcFocusSince = 0;
  function calcDoc() { try { var d = frame.contentDocument; return d && d.getElementById ? d : null; } catch (e) { return null; } }
  function loadCalc() {
    if (calcLoaded) return; calcLoaded = true;
    frame.addEventListener('load', onCalcLoad);
    if (typeof window.CALC_HTML === 'string' && window.CALC_HTML.length > 1000) frame.srcdoc = window.CALC_HTML; /* same origin -> remote can drive it */
    else frame.src = 'assets/calculator.html';
  }
  function onCalcLoad() {
    var d = calcDoc(); calcSame = !!d;
    if (!d) return;
    try {
      d.documentElement.setAttribute('data-theme', 'light');
      var st = d.createElement('style');
      st.textContent = 'html{zoom:var(--deck-zoom,1);scroll-behavior:smooth} body{background:#f6f8f9} ::-webkit-scrollbar{width:10px} ::-webkit-scrollbar-thumb{background:#c5ced3;border-radius:5px}';
      d.head.appendChild(st);
      calcZoom();
      var pv = d.getElementById('pv'); if (pv) pv.dispatchEvent(new Event('input', { bubbles: true })); /* redraw chart in light theme */
      var debrand = function () { var t = d.querySelector('h1'); if (t && /FeederCheck/.test(t.textContent)) t.textContent = t.textContent.replace(/FeederCheck\s*[—-]\s*/, '').replace(/^./, function (c) { return c.toUpperCase(); }); };
      debrand();
      Array.prototype.forEach.call(d.querySelectorAll('.lang button'), function (b) { b.addEventListener('click', function () { setTimeout(debrand, 0); }); });
      calcPrepare();
      computeS7();
      d.addEventListener('keydown', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        var inField = /INPUT|SELECT|TEXTAREA/.test(tag);
        if (e.key === 'PageDown' || e.key === 'PageUp' || (!inField && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) || (!inField && /^[qQfFbB.?hHaAxX]$/.test(e.key))) {
          onKey(e);
        }
      }, true);
    } catch (e) { console.warn('calc setup', e); }
  }
  function baseZoom() {
    var w = frame.clientWidth || window.innerWidth, hh = frame.clientHeight || window.innerHeight;
    return Math.max(0.7, Math.min(1.45, w / 1320, hh / 790)).toFixed(3);
  }
  function calcZoom() {
    var d = calcDoc(); if (!d) return;
    d.documentElement.style.setProperty('--deck-zoom', SPOT.k ? '1.6' : baseZoom());
  }
  window.addEventListener('resize', calcZoom);
  function calcSet(id, val) {
    var d = calcDoc(); var e = d && d.getElementById(id); if (!e) return false;
    if (e.type === 'checkbox') e.checked = !!val; else e.value = String(val);
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function calcState() {
    var d = calcDoc(); if (!d) return { avail: false };
    var g = function (id) { var e = d.getElementById(id); return e ? e : null; };
    var sel = d.querySelector('#feeders tr.sel td:nth-child(3)');
    return { avail: true, pv: g('pv') ? +g('pv').value : null, tap: g('tap') ? +g('tap').value : null, qu: g('qu') ? g('qu').checked : null,
      hours: g('k_hours') ? g('k_hours').textContent : '', vmax: g('k_vmax') ? g('k_vmax').textContent : '', hc: g('k_hc') ? g('k_hc').textContent : '',
      feeder: sel ? sel.textContent : '' };
  }
  /* demo start state: the first real solar-type feeder, solar set just below its hosting limit (0 h outside the band) */
  function calcPrepare() {
    var d = calcDoc(); if (!d) return false;
    calcPrepared = true;
    calcCommand({ load: 'solar' });
    var hc = parseInt((d.getElementById('k_hc') || {}).textContent, 10);
    if (hc > 0) calcSet('pv', Math.max(10, Math.min(300, Math.floor(hc * 0.8 / 2) * 2)));
    body.classList.remove('calc-fixed');
    return true;
  }
  /* S7 steps: 1 real line · 2 more sun · 3 over the limit · 4 cheapest fix · 5 result. Spotlight + callout over the frame. */
  var SPOT = { k: 0, raf: 0, el: null };
  var CALC_HC = { before: null, after: null, ratio: null };   /* the shown line's own hosting capacity, live from the calculator */
  var SPOT_TXT = { 1: 'Real line from the regulator\u2019s data', 2: 'More sun', 3: 'Over the limit', 4: 'Cheapest fix', 5: '' };
  function spotTarget(k) {
    var d = calcDoc(); if (!d) return null;
    var g = function (id) { return d.getElementById(id); };
    if (k === 1) return g('obs') && g('obs').offsetHeight ? g('obs') : (d.querySelector('#feeders tr.sel') || g('obs'));
    if (k === 2) { var pv = g('pv'); return pv ? (pv.closest('label') || pv) : null; }
    if (k === 3) { var h = g('k_hours'); return h ? (h.closest('.kpi') || h) : null; }
    if (k === 4) return g('rec');
    if (k === 5) return d.querySelector('.kpis');
    return null;
  }
  function spotPaint() {
    SPOT.raf = 0;
    var box = $('#spot'), k = SPOT.k;
    if (!k || ids[state.i] !== 's7') { box.classList.remove('on'); return; }
    var t = spotTarget(k), d = calcDoc();
    if (!t || !d) { box.classList.remove('on'); return; }
    var r = t.getBoundingClientRect(), pad = 10;
    var sb = box.querySelector('.sb'), st = box.querySelector('.st');
    sb.style.left = (r.left - pad) + 'px'; sb.style.top = (r.top - pad) + 'px';
    sb.style.width = (r.width + 2 * pad) + 'px'; sb.style.height = (r.height + 2 * pad) + 'px';
    var hours = (d.getElementById('k_hours') || {}).textContent || '';
    var label = SPOT_TXT[k];
    if (k === 1) { var f = d.querySelector('#feeders tr.sel td:nth-child(3)'); label += f ? '<small>' + f.textContent + '</small>' : ''; }
    if (k === 3) label = 'Over the limit: ' + hours + ' hours a day';
    if (k === 5) label = hours + ' hours' + (CALC_HC.ratio ? ' \u00b7 \u2248 ' + CALC_HC.ratio.toFixed(1) + '\u00d7 more solar on this line' : '') +
      (CALC_HC.before && CALC_HC.after ? '<small>' + CALC_HC.before + ' \u2192 ' + CALC_HC.after + ' kWp on the same wires</small>' : '');
    st.className = 'st' + (k === 3 ? ' red' : k === 5 ? ' green' : '');
    st.querySelector('.n').textContent = ['', '\u2460', '\u2461', '\u2462', '\u2463', '\u2464'][k];
    var tt = st.querySelector('.t'); if (tt.innerHTML !== label) tt.innerHTML = label;
    var W = frame.clientWidth, H = frame.clientHeight, sw = st.offsetWidth, sh = st.offsetHeight;
    var x = r.right + pad + 18, y = r.top - pad;
    if (x + sw > W - 10) x = Math.max(10, r.left - pad - 18 - sw);
    if (x < 10 || x + sw > W - 10) { x = clampN(r.left, 10, W - sw - 10); y = r.bottom + pad + 14; if (y + sh > H - 10) y = r.top - pad - 14 - sh; }
    st.style.left = x + 'px'; st.style.top = clampN(y, 10, H - sh - 10) + 'px';
    box.classList.add('on');
    SPOT.raf = requestAnimationFrame(spotPaint);   /* follow smooth scrolling and recalculation */
  }
  function spotFocus(k) {
    var t = spotTarget(k); if (!t) return;
    try { t.scrollIntoView({ block: 'center', inline: 'center', behavior: reduced ? 'auto' : 'smooth' }); } catch (e) {}
  }
  var calcPrepared = false, stepT = 0;
  function calcStep(k) {
    clearTimeout(stepT);
    var d = calcDoc();
    SPOT.k = k;
    if (d) d.documentElement.style.setProperty('--deck-zoom', k ? '1.6' : String(baseZoom()));
    if (!k) { if (SPOT.raf) cancelAnimationFrame(SPOT.raf); SPOT.raf = 0; $('#spot').classList.remove('on'); return; }
    if (!d) return;
    if (!calcPrepared) calcPrepare();
    var fixed = body.classList.contains('calc-fixed');
    if (k < 5 && fixed) calcCommand({ reset: true });
    if (k === 3 && !(parseInt((d.getElementById('k_hours') || {}).textContent, 10) > 0)) calcAnimatePv(300, reduced ? 0 : 1600);
    if (k === 5 && !fixed) calcCommand({ fix: true });
    setTimeout(function () { spotFocus(k); }, 60);
    if (!SPOT.raf) SPOT.raf = requestAnimationFrame(spotPaint);
  }
  /* ---- S7 v7: the live demo as a 5-step sequence; numbers from the embedded calculator engine (never shown) ---- */
  var S7D = null;
  var PLACES = { '\u0584.\u0533\u0575\u0578\u0582\u0574\u0580\u056b': 'Gyumri', '\u0584.\u0535\u0580\u0587\u0561\u0576': 'Yerevan', '\u0584.\u0531\u0580\u0569\u056b\u056f': 'Artik', '\u0584.\u0540\u0580\u0561\u0566\u0564\u0561\u0576': 'Hrazdan' };
  function computeS7() {
    var d = calcDoc(); if (!d || !d.getElementById('pv') || !d.getElementById('k_hours')) return false;  /* srcdoc not parsed yet (about:blank) -> onCalcLoad runs it */
    try {
      var g = function (id) { return d.getElementById(id); };
      calcCommand({ load: 'solar' });             /* the first real solar-type line, average assumptions, no fix */
      var tds = d.querySelectorAll('#feeders tr.sel td');
      var np = tds[1] ? tds[1].textContent.trim() : '', tpf = tds[2] ? tds[2].textContent : '', homes = tds[3] ? parseInt(tds[3].textContent, 10) : null;
      var place = PLACES[np] || (tds[0] ? tds[0].textContent.split('/')[0].trim() : np);
      var tpNum = (tpf.match(/(\d{3,5})/) || [])[1] || '';
      var read = function () { return { hours: parseInt(g('k_hours').textContent, 10), vmax: g('k_vmax').textContent.trim(), hc: parseInt(g('k_hc').textContent, 10) }; };
      var pv = +g('pv').value, today = read();
      var bestTd = d.querySelector('#opts tr.best td'), best = bestTd ? bestTd.textContent : '';
      calcCommand({ fix: true });
      var fix = read();
      calcCommand({ reset: true });
      S7D = { place: place, tp: tpNum, homes: homes, pv: pv, today: today, fix: fix, best: best };
      var vv = /tap\s*[+\-]?\d\s*\+/.test(best), tap0 = /tap\s*0/.test(best);
      $('#s7Line').textContent = place + ' \u00b7 transformer ' + tpNum + ' \u00b7 ' + homes + ' homes';
      $('#s7Pv').textContent = pv;
      $('#s7FixH').innerHTML = 'Cheapest fix<small>(' + (tap0 && vv ? 'inverters\u2019 voltage control' : vv ? 'transformer tap + inverters\u2019 voltage control' : 'transformer tap') + ')</small>';
      $('#s7H0').textContent = today.hours; $('#s7H1').textContent = fix.hours;
      $('#s7V0').textContent = today.vmax; $('#s7V1').textContent = fix.vmax;
      $('#s7C0').textContent = today.hc + ' kW'; $('#s7C1').textContent = fix.hc + ' kW';
      var r = today.hc ? fix.hc / today.hc : null;
      $('#s7Concl').textContent = 'Our map finds the line; ENA adjusts the transformer: ' + fix.hours + ' hours over the limit' + (r ? ' and ' + r.toFixed(1) + '\u00d7 more solar' : '') + ' on the same wires.';
      window.DECK.s7 = S7D;
      return true;
    } catch (e) { console.warn('[deck] S7 engine', e); return false; }
  }
  function s7Step(k) {
    var sl = $('[data-id="s7"]');
    $$('.rv', sl).forEach(function (el) {
      var need = el.classList.contains('s7-line') ? 1 : el.classList.contains('s7-pv') ? 2 : (el.classList.contains('s7-noon') || el.id === 's7Table') ? 3 : 5;
      el.classList.toggle('on', k >= need);
    });
    $('#s7Table').classList.toggle('fixon', k >= 4);
    if (k === 2 && S7D) {   /* counter 0 -> pv */
      var el = $('#s7Pv'), to = S7D.pv, t0 = performance.now();
      if (reduced) el.textContent = to; else (function stp(t) { var p = Math.min(1, (t - t0) / 1200), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1 && STEP.k === 2) requestAnimationFrame(stp); else el.textContent = to; })(t0);
    }
  }
  var pvAnim = 0;
  function calcAnimatePv(to, ms) {
    var d = calcDoc(); var e = d && d.getElementById('pv'); if (!e) return;
    clearInterval(pvAnim);
    var from = +e.value, t0 = performance.now();
    pvAnim = setInterval(function () {
      var p = Math.min(1, (performance.now() - t0) / ms);
      calcSet('pv', Math.round((from + (to - from) * p) / 2) * 2);
      if (p >= 1) clearInterval(pvAnim);
    }, 120);
  }
  function calcCommand(v) {
    var d = calcDoc(); if (!d || !v) return false;
    if (v.prepare) return calcPrepare();
    if (v.load) {
      var ft = d.getElementById('f_type');
      if (ft) { ft.value = typeof v.load === 'string' ? v.load : 'solar'; ft.dispatchEvent(new Event('input', { bubbles: true })); }
      var b = d.querySelector('#feeders button.load'); if (b) b.click();
      var w = d.defaultView; if (w) w.scrollTo(0, 0);
    }
    if (v.pv != null) calcSet('pv', Math.max(0, Math.min(300, Math.round(+v.pv / 2) * 2)));
    if (v.fix) {
      CALC_HC.before = parseInt((d.getElementById('k_hc') || {}).textContent, 10) || null;   /* hosting with current settings */
      var td = d.querySelector('#opts tr.best td');
      if (td) {
        var t = td.textContent || '', m = t.match(/tap\s*([+\-]?\d)/);
        calcSet('tap', m ? parseInt(m[1], 10) : 0);
        calcSet('qu', /tap\s*[+\-]?\d\s*\+/.test(t));
      }
    }
    if (v.fix) {
      body.classList.add('calc-fixed');
      CALC_HC.after = parseInt((d.getElementById('k_hc') || {}).textContent, 10) || null;
      var rx = CALC_HC.before && CALC_HC.after ? CALC_HC.after / CALC_HC.before : null;
      CALC_HC.ratio = rx;
      var cx = $('#calcX'); if (cx && rx) cx.innerHTML = '<b>\u2248 ' + rx.toFixed(1) + '\u00d7</b> more solar on this line';
    }
    if (v.reset) { calcSet('tap', 0); calcSet('qu', false); body.classList.remove('calc-fixed'); }
    if (v.load) body.classList.remove('calc-fixed');
    if (v.scroll != null) { var ww = d.defaultView; if (ww) ww.scrollTo({ top: v.scroll === 'opts' ? (d.getElementById('opts').getBoundingClientRect().top + ww.scrollY - 20) : 0, behavior: 'smooth' }); }
    return true;
  }
  setInterval(function () { /* cross-origin fallback: give keys back to the deck after 6 s in the calculator */
    if (ids[state.i] !== 's7' || calcSame) { calcFocusSince = 0; return; }
    if (document.activeElement === frame) {
      if (!calcFocusSince) calcFocusSince = Date.now();
      else if (Date.now() - calcFocusSince > 6000) { frame.blur(); window.focus(); calcFocusSince = 0; }
    } else calcFocusSince = 0;
  }, 1000);
  $('.calc-head').addEventListener('click', function () { frame.blur(); window.focus(); });

  /* ---------------- navigation ---------------- */
  var streetInit = false, streetOffTimer = 0;
  function go(i, why) {
    i = Math.max(0, Math.min(slides.length - 1, i | 0));
    if (i === state.i) return;
    var prev = state.i;
    if (prev >= 0) slides[prev].classList.remove('active');
    state.i = i;
    var s = slides[i], id = ids[i];
    s.classList.add('active');
    body.dataset.screen = id;
    body.classList.toggle('dark-lb', id !== 's1');
    try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) {}

    var scene = isScene(id);
    clearTimeout(streetOffTimer);
    if (scene) {
      ensureStreet();
      Street.setActive(true);
      Street.setBoxes(id === 's5');
      /* defined entry states: S2 = dawn, no SunGuard · S5 = full sun, no SunGuard */
      state.lines = 0; applyLines();
      if (id === 's2') { body.classList.remove('swept'); setSun(DAWN, 0, true); }
      if (id === 's5') setSun(1, 0, true);
      try { if (typeof Street.resetView === 'function') Street.resetView(0); } catch (e) {}
      updateSceneHl(true);
    } else if (streetInit) {
      streetOffTimer = setTimeout(function () { Street.setActive(false); }, 1000);
      state.lines = 0; applyLines();
    }
    enterSteps(id);
    if (id === 's6') buildMap();
    if (id === 's8') { buildBox(); enterParts(); } else stopParts();
    if (id === 's11') buildQR();
    if (id === 's10b' && !$('#qrGit').firstChild) makeQR($('#qrGit'), 'https://github.com/vitasha10/grino-smart-grid', 300);
    if (id === 's7') { loadCalc(); if (!S7D) computeS7(); }
    else { body.classList.remove('calc-in'); if (document.activeElement === frame) { frame.blur(); window.focus(); } }
    animateCounts(s);
    if (AP.on && why !== 'auto') apResync();
    if (!why || why === 'auto') broadcastCmd('goto', { i: i, id: id });
    if (why !== 'remote') publishState();
  }
  function isScene(id) { return id === 's2' || id === 's5'; }
  function ensureStreet() {
    if (streetInit) return;
    Street.init($('#street')); streetInit = true; Street.setSun(state.sun, 0); Street.setActive(false);
  }
  function next() { go(state.i + 1); }
  function prev() { go(state.i - 1); }

  /* sun shown on the deck: a critically damped spring toward the target, speed-limited (SUN_MAX_SPEED per s), no overshoot.
     Long moves (sweeps) follow a linear ramp. jump = set at once (screen entry, reset). */
  var SUN = { x: state.sun, v: 0, target: state.sun, ramp: null, raf: 0, last: 0 };
  function sunGoal(now) {
    var r = SUN.ramp; if (!r) return SUN.target;
    var p = Math.min(1, (now - r.t0) / r.dur);
    if (p >= 1) { SUN.ramp = null; return r.to; }
    return r.from + (r.to - r.from) * p;
  }
  window.DECK.sunX = function () { return SUN.x; };
  function pushSun() { body.classList.toggle('night', SUN.x < 0.18); if (streetInit) Street.setSun(SUN.x, 0); }
  function sunTick(now) {
    SUN.raf = 0;
    var dt = SUN.last ? Math.min(0.05, (now - SUN.last) / 1000) : 1 / 60; SUN.last = now;
    var g = sunGoal(now), w = cfg.SUN_SPRING || 18, vmax = cfg.SUN_MAX_SPEED || 1.2;
    /* exact critically damped step (stable at any frame rate), then the speed limit */
    var e0 = SUN.x - g, ex = Math.exp(-w * dt), c = SUN.v + w * e0;
    var nx = g + (e0 + c * dt) * ex, nv = (SUN.v - w * c * dt) * ex;
    if (Math.abs(nx - SUN.x) > vmax * dt) { nx = SUN.x + (nx > SUN.x ? 1 : -1) * vmax * dt; nv = (nx > SUN.x ? 1 : -1) * vmax; }
    SUN.v = nv;
    if ((g - SUN.x) * (g - nx) < 0) { nx = g; SUN.v = 0; }          /* never overshoot */
    SUN.x = nx;
    if (!SUN.ramp && Math.abs(g - SUN.x) < 0.0008 && Math.abs(SUN.v) < 0.004) { SUN.x = g; SUN.v = 0; }
    pushSun();
    if (SUN.ramp || SUN.x !== g) SUN.raf = requestAnimationFrame(sunTick); else SUN.last = 0;
  }
  function setSun(v, ms, jump) {
    var nv = Math.max(Math.min(0, DAWN), Math.min(1, +v || 0));   /* pre-dawn allowed down to PRE_DAWN */
    if (ids[state.i] === 's2' && Math.abs(nv - state.sun) > 0.02) body.classList.add('swept');
    state.sun = nv;
    if (jump || reduced) { SUN.ramp = null; SUN.target = SUN.x = nv; SUN.v = 0; pushSun(); return; }
    if (ms && ms > 600) SUN.ramp = { from: SUN.x, to: nv, t0: performance.now(), dur: ms };
    else SUN.ramp = null;
    SUN.target = nv;
    if (!SUN.raf) { SUN.last = 0; SUN.raf = requestAnimationFrame(sunTick); }
  }
  /* SunGuard by LINE (team decision 04.10): state.lines 0 = none, 1 = left line, 2 = both lines. Only visible on S5. */
  /* SunGuard stages: 0 none · 1 "where it's needed" (Street.setGuard) · 2 everywhere (Street.setGuardAll / setGuardRight) */
  function hasLinesApi() { return !!(window.Street && (typeof Street.setGuardAll === 'function' || typeof Street.setGuardRight === 'function')); }
  function applyLines() {
    if (!streetInit) return;
    var n = ids[state.i] === 's5' ? state.lines : 0;
    try {
      if (typeof Street.setGuardAll === 'function') { Street.setGuard(n >= 1); Street.setGuardAll(n >= 2); }
      else if (typeof Street.setGuardRight === 'function') { Street.setGuard(n >= 1); Street.setGuardRight(n >= 2); }
      else if (typeof Street.setLines === 'function') Street.setLines(n);
      else if (typeof Street.setLineGuard === 'function') { Street.setLineGuard(0, n >= 1); Street.setLineGuard(1, n >= 2); }
      else if (typeof Street.setLine === 'function') { Street.setLine(0, n >= 1); Street.setLine(1, n >= 2); }
      else if (typeof Street.setLineBoxes === 'function') Street.setLineBoxes(n >= 1, n >= 2);
      else if (typeof Street.setBoxCount === 'function') Street.setBoxCount(n * 3);
      else Street.setGuard(n > 0);
    } catch (e) { console.warn('[deck] lines', e); }
    try { if (typeof Street.setTap === 'function') Street.setTap(n >= 3); } catch (e) { console.warn('[deck] setTap', e); }
    try { if (typeof Street.highlightPanels === 'function') Street.highlightPanels(n > 0); } catch (e) {}
    body.classList.toggle('guard', ids[state.i] === 's5' && state.lines > 0);
    body.classList.toggle('sg-all', ids[state.i] === 's5' && state.lines >= 2);
    body.classList.toggle('sg-tap', ids[state.i] === 's5' && state.lines >= 3);
    var stg = $('#s5Stage'); if (stg) stg.textContent = state.lines >= 3 ? 'Back within the legal limit — no new wires' : 'No more emergency shutdowns · panels keep working';
    body.classList.toggle('dcycle', dcycleOn());
    updateSceneHl();
  }
  function setLines(n) { state.lines = Math.max(0, Math.min(3, Math.round(+n || 0))); state.guard = state.lines > 0; applyLines(); }
  /* line D shutdown-cycle caption: 3D only (hidden in the 2D / PNG fallback), while line D has no SunGuard */
  function dcycleOn() { return ids[state.i] === 's5' && state.lines < 2 && SUN.x > 0.8 && window.DECK.renderer === '3d'; }
  function setGuard(on) { setLines(on ? Math.max(1, state.lines) : 0); }
  function addBox() { setLines(state.lines + 1); }
  /* scene headlines follow the sun / the result (S2, S5) */
  var hlText = {};
  function swapText(el, txt) {
    if (!el || hlText[el.id] === txt) return;
    hlText[el.id] = txt;
    if (reduced || !el.textContent) { el.textContent = txt; return; }
    el.classList.add('swap');
    setTimeout(function () { el.textContent = hlText[el.id]; el.classList.remove('swap'); }, 220);
  }
  function updateSceneHl(now) {
    if (!streetInit) return;
    var id = ids[state.i], v = null; try { v = Street.volts(); } catch (e) {}
    if (!v) return;
    var over = v.some(function (x) { return x > 242.05; });
    if (id === 's2') swapText($('#s2Hl'), over ? 'Noon: the last houses go over the limit' : (SUN.x >= 0.35 ? 'Late morning: voltage is rising' : SUN.x <= 0 ? 'Before sunrise (model): voltage is normal' : 'Morning: voltage is normal'));
    if (id === 's5') {
      body.classList.toggle('green5', state.lines > 0 && !over);

    } else body.classList.remove('green5');
  }
  setInterval(function () {
    if (!streetInit) return;
    if (window.DECK.renderer === '3d' && !Street.is3D) { window.DECK.renderer = '2d (3D fell back)'; body.classList.remove('r3d'); reapplyStreet(); trySnap(); }
    if (isScene(ids[state.i])) updateSceneHl();
    body.classList.toggle('dcycle', dcycleOn());
  }, 150);
  function reapplyStreet() {
    try {
      Street.setSun(SUN.x, 0);
      Street.setBoxes(ids[state.i] === 's5');
      applyLines();
      Street.setActive(isScene(ids[state.i]));
    } catch (e) { console.warn(e); }
  }
  /* PNG snapshots of the 3D street (streetsnap.js); the 2D street.js stays if they are not there */
  var snapTried = false;
  function trySnap() {
    if (snapTried || !window.StreetSnap) return; snapTried = true;
    if (window.Street && window.Street.is3D) return;
    StreetSnap.tryInstall($('#street'), function (ok) {
      if (!ok) { console.info('[deck] 3D snapshots not found, using the 2D street'); return; }
      window.DECK.renderer = 'png'; body.classList.add('rsnap'); reapplyStreet(); publishStateSoon();
    });
  }
  /* 3D street (street3d.js, three.js): only over http(s), with WebGL2, and not with ?flat / ?street=2d|png */
  function try3D() {
    var p = new URLSearchParams(location.search);
    window.DECK.renderer = '2d';
    if (p.get('street') === '2d') { window.DECK.renderer = '2d (flag)'; return; }
    if (p.has('flat') || p.get('street') === 'png') { window.DECK.renderer = '2d (flag)'; trySnap(); return; }
    if (location.protocol === 'file:') { window.Street3DFailed = true; window.DECK.renderer = '2d (file://)'; trySnap(); return; }
    var ok = false; try { ok = !!document.createElement('canvas').getContext('webgl2'); } catch (e) {}
    if (!ok) { window.Street3DFailed = true; window.DECK.renderer = '2d (no WebGL2)'; trySnap(); return; }
    var dynImport; try { dynImport = new Function('u', 'return import(u)'); } catch (e) { window.Street3DFailed = true; return; }
    dynImport('./street3d.js').then(function (m) {
      if (!m || typeof m.upgrade !== 'function') throw new Error('street3d.js has no upgrade()');
      /* stage-px areas where 3D labels must not go: title + S5 points, S5 stage caption, line-D caption, source line, partner plate */
      return m.upgrade($('#street'), { active: isScene(ids[state.i]), keepOut: [[0, 0, 1920, 306], [560, 306, 1360, 374], [360, 866, 1560, 934], [40, 940, 1880, 992], [0, 985, 1920, 1080], [1560, 0, 1920, 160]] });
    }).then(function (done) {
      if (done && Street.is3D && !window.Street3DFailed) { window.DECK.renderer = '3d'; body.classList.add('r3d'); reapplyStreet(); }
      else { window.DECK.renderer = '2d (3D declined)'; trySnap(); }
      publishStateSoon();
    }).catch(function (e) {
      window.Street3DFailed = true; window.DECK.renderer = '2d (3D failed)';
      console.info('[deck] 3D street unavailable:', e && e.message);
      trySnap();
    });
  }
  function pulse() { if (streetInit && ids[state.i] === 's5') Street.pulse(); }
  function setQR(on) { state.qr = !!on; if (state.qr) buildQR(); body.classList.toggle('qr', state.qr); }
  function setBlack(on) { state.black = !!on; body.classList.toggle('black', state.black); }
  function setHelp(on) { state.help = !!on; body.classList.toggle('help', state.help); }

  /* ---------------- autopilot (key A): the 3-minute run with the speech timings ---------------- */
  var SP = DATA.speech || [];
  var AP = { on: false, t0: 0, timer: 0, done: {} };
  function apT(n) { return SP[n - 1] ? SP[n - 1].t : 0; }           /* n = screen index + 1 */
  function spT(id) { var i = ids.indexOf(id); return SP[i] ? SP[i].t : 0; }
  function apEvents() {
    var A = cfg.AUTOPILOT || {};
    function at(k, def) { return A[k] != null ? +A[k] : def; }
    var sunUp = at('sunUp', spT('s2') + 4), sunEnd = at('sunUpEnd', sunUp + 12), pvUp = at('moreSolar', spT('s7') + 3), pvEnd = at('moreSolarEnd', pvUp + 3);
    return [
      { id: 'sweep', at: sunUp, fn: function () { if (ids[state.i] === 's2') setSun(1, Math.max(1000, (sunEnd - sunUp) * 1000)); } },
      { id: 'left', at: at('guardWhereNeeded', spT('s5') + 11), fn: function () { if (ids[state.i] === 's5') setLines(1); } },
      { id: 'right', at: at('guardEverywhere', spT('s5') + 16), fn: function () { if (ids[state.i] === 's5') setLines(2); } },
      { id: 'tap', at: at('tapFix', spT('s5') + 22), fn: function () { if (ids[state.i] === 's5') setLines(3); } },
      { id: 'p1', at: at('partsExplode', spT('s8') + 1), fn: function () { if (ids[state.i] === 's8') stepTo(1); } },
      { id: 'p2', at: at('partsExplode', spT('s8') + 1) + 1.2, fn: function () { if (ids[state.i] === 's8') stepTo(2); } },
      { id: 'p3', at: at('partsExplode', spT('s8') + 1) + 2.4, fn: function () { if (ids[state.i] === 's8') stepTo(3); } },
      { id: 'p4', at: at('partsExplode', spT('s8') + 1) + 3.6, fn: function () { if (ids[state.i] === 's8') stepTo(4); } },
      { id: 'p5', at: at('partsExplode', spT('s8') + 1) + 4.8, fn: function () { if (ids[state.i] === 's8') stepTo(5); } },
      { id: 's7a', at: spT('s7') + 1, fn: function () { if (ids[state.i] === 's7') stepTo(1); } },
      { id: 's7b', at: pvUp, fn: function () { if (ids[state.i] === 's7') stepTo(2); } },
      { id: 's7c', at: (pvUp + at('cheapestFix', spT('s7') + 7)) / 2, fn: function () { if (ids[state.i] === 's7') stepTo(3); } },
      { id: 's7d', at: at('cheapestFix', spT('s7') + 7), fn: function () { if (ids[state.i] === 's7') stepTo(4); } },
      { id: 's7e', at: at('cheapestFix', spT('s7') + 7) + 2, fn: function () { if (ids[state.i] === 's7') stepTo(5); } }
    ];
  }
  function apElapsed() { return (performance.now() - AP.t0) / 1000; }
  function apStart() {
    AP.on = true; AP.done = {};
    AP.t0 = performance.now() - apT(state.i + 1) * 1000;
    apEvents().forEach(function (ev) { if (ev.at < apT(state.i + 1)) AP.done[ev.id] = 1; });
    body.classList.add('autopilot'); apTick();
  }
  function apStop() { AP.on = false; clearTimeout(AP.timer); body.classList.remove('autopilot'); }
  /* a manual jump (clicker, keyboard, phone) moves the autopilot clock to that screen's start time */
  function apResync() {
    var t = apT(state.i + 1);
    AP.t0 = performance.now() - t * 1000;
    apEvents().forEach(function (ev) { if (ev.at < t) AP.done[ev.id] = 1; else delete AP.done[ev.id]; });
  }
  function apTick() {
    if (!AP.on) return;
    var e = apElapsed(), want = 0;
    for (var i = 0; i < SP.length; i++) if (e >= SP[i].t) want = i;
    if (want > state.i) go(want, 'auto');
    apEvents().forEach(function (ev) {
      if (AP.done[ev.id] || e < ev.at) return;
      AP.done[ev.id] = 1;
      var before = { lines: state.lines, k: STEP.k, sun: state.sun };
      try { ev.fn(); } catch (x) { console.warn(x); }
      if (state.lines !== before.lines) broadcastCmd('lines', state.lines);
      if (STEP.k !== before.k) broadcastCmd('step', { to: STEP.k });
      if (ev.id === 'sweep' && ids[state.i] === 's2') { var A = cfg.AUTOPILOT || {}; broadcastCmd('sweep', { to: 1, ms: Math.max(1000, ((A.sunUpEnd || 34) - (A.sunUp || 22)) * 1000) }); }
    });
    var m = Math.floor(e / 60), sec = Math.floor(e % 60);
    $('#auto').textContent = 'AUTO ' + m + ':' + (sec < 10 ? '0' : '') + sec;
    if (e > (cfg.PITCH_SECONDS || 180) + 60) { apStop(); return; }
    AP.timer = setTimeout(apTick, 200);
  }

  /* ---------------- full reset: S1, dawn, no SunGuard, default calculator, animations re-armed ---------------- */
  function resetAll() {
    apStop(); setQR(false); setBlack(false); setHelp(false);
    state.lines = 0; state.guard = false;
    setSun(DAWN, 0, true); if (streetInit) { applyLines(); try { if (typeof Street.resetView === 'function') Street.resetView(); } catch (e) {} }
    body.classList.remove('swept', 'green5', 'calc-fixed', 'sg-tap');
    hlText = {};
    calcPrepare(); var cd = calcDoc(); if (cd && cd.defaultView) cd.defaultView.scrollTo(0, 0);
    var cur = state.i; state.i = -1; if (cur >= 0) slides[cur].classList.remove('active');
    go(0, 'reset');
    window.DECK.resets = (window.DECK.resets || 0) + 1;
  }
  var lastR = 0;

  /* this deck's sun -> the other decks: samples <= 20 Hz to the primary relay (latest wins), the final value to both relays */
  function sunBroadcast(final) {
    clearTimeout(sunBroadcast.t);
    var now = Date.now();
    if (!final && now - lastBroadcastSun < 50) { sunBroadcast.t = setTimeout(function () { sunBroadcast(); }, 50 - (now - lastBroadcastSun)); return; }
    lastBroadcastSun = now; broadcastCmd('sun', { v: Math.round(state.sun * 1000) / 1000 }, !final);
  }
  /* keyboard Up/Down on S2/S5: one press = SUN_KEY_STEP; held = continuous SUN_KEY_HOLD units/s (OS auto-repeat ignored) */
  var KH = null;
  function keySunDown(dir, repeat) {
    if (repeat) return;
    if (KH && KH.dir === dir) return;
    keySunUp();
    setSun(state.sun + dir * (cfg.SUN_KEY_STEP || 0.08)); sunBroadcast();
    KH = { dir: dir, t0: performance.now(), last: 0, raf: 0 };
    var h = KH;
    (function hold(t) {
      if (KH !== h) return;
      if (t - h.t0 > 280) {                      /* held: glide */
        var dt = h.last ? Math.min(0.05, (t - h.last) / 1000) : 0;
        if (dt) { var nv = state.sun + dir * (cfg.SUN_KEY_HOLD || 0.6) * dt; if (nv !== state.sun) { setSun(nv); sunBroadcast(); } }
        h.last = t;
      }
      h.raf = requestAnimationFrame(hold);
    })(performance.now());
  }
  function keySunUp() {
    if (!KH) return;
    cancelAnimationFrame(KH.raf); KH = null;
    sunBroadcast(true); publishStateSoon();
  }
  document.addEventListener('keyup', function (e) { if (KH && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) keySunUp(); });
  window.addEventListener('blur', keySunUp);
  /* ---------------- v10: "Recorded live" on S11 ----------------
     build the latest session on the server (it waits for the x10 copies), then loop the fast copy muted
     (or the full one at playbackRate 10). No key / no recording / any error -> the panel stays hidden. */
  var RECV = { state: 'idle', busy: false, url: '' };
  window.DECK.rec = RECV;
  function recApi(path) { return (cfg.RELAY_URL || '').replace(/\/+$/, '') + '/rec/' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'k=' + encodeURIComponent(cfg.KEY || ''); }
  function recAbs(u) { try { return new URL(u, (cfg.RELAY_URL || '').replace(/\/+$/, '') + '/').href; } catch (e) { return u; } }
  function recFetch(url, opts, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 20000);
    opts = opts || {}; opts.cache = 'no-store'; if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  function recShow(on) { body.classList.toggle('rec-on', !!on); $('#recPanel').hidden = !on; }
  function recPlay() {
    if (!cfg.KEY || RECV.busy) return;
    RECV.busy = true; RECV.state = 'building'; publishState();
    var v = $('#recVideo');
    recFetch(recApi('latest'), null, 15000).then(function (j) {
      if (!j || !j.session) throw new Error('no recording');
      RECV.session = j.session;
      return recFetch(recApi(encodeURIComponent(j.session) + '/build'), { method: 'POST' }, 90000).catch(function () { return j; });
    }).then(function (b) {
      var fast = b && (b.fast || b.fast_full), full = b && b.full;
      if (!fast && !full) throw new Error('nothing built');
      RECV.url = recAbs(fast || full); RECV.rate = fast ? 1 : 10;
      return new Promise(function (res, rej) {
        var done = false, to = setTimeout(function () { if (!done) { done = true; rej(new Error('video did not load')); } }, 20000);
        v.onloadeddata = function () { if (done) return; done = true; clearTimeout(to); res(); };
        v.onerror = function () { if (done) return; done = true; clearTimeout(to); rej(new Error('video error')); };
        v.src = RECV.url; v.muted = true; v.loop = true; v.playbackRate = RECV.rate; v.defaultPlaybackRate = RECV.rate;
        try { v.load(); } catch (e) {}
      });
    }).then(function () {
      v.playbackRate = RECV.rate;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      recShow(true); RECV.state = 'playing';
    }).catch(function (e) {
      recShow(false); RECV.state = 'none'; RECV.err = String(e && e.message || e);
      console.info('[deck] recording:', RECV.err);
    }).then(function () { RECV.busy = false; publishState(); });
  }
  function recHide() { var v = $('#recVideo'); try { v.pause(); } catch (e) {} recShow(false); RECV.state = 'idle'; publishState(); }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key, handled = true;
    if (e.shiftKey && (k === 'V' || k === 'v')) { if (body.classList.contains('rec-on')) { recHide(); broadcastCmd('rec', 'off'); } else { recPlay(); broadcastCmd('rec', 'on'); } e.preventDefault(); return; }
    switch (k) {
      case 'ArrowUp': case 'ArrowDown':
        if (isScene(ids[state.i])) keySunDown(k === 'ArrowUp' ? 1 : -1, e.repeat);   /* smooth: the spring follows */
        else if (k === 'ArrowDown') next(); else prev();
        break;
      case 'ArrowRight': case 'PageDown': case ' ': case 'Enter': next(); break;
      case 'ArrowLeft': case 'PageUp': case 'Backspace': prev(); break;
      case 'Home': go(0); break;
      case 'End': go(slides.length - 1); break;
      case 's': case 'S': setSun(state.sun + 0.05, 260); sunBroadcast(); publishStateSoon(); break;
      case 'w': case 'W': setSun(state.sun - 0.05, 260); sunBroadcast(); publishStateSoon(); break;
      case 'n': case 'N': setSun(1, 6000); break;
      case 'g': case 'G': setLines(state.lines ? 0 : 1); broadcastCmd('lines', state.lines); publishState(); break;
      case '+': case '=': addBox(); broadcastCmd('lines', state.lines); publishState(); break;
      case '-': case '_': setLines(0); broadcastCmd('lines', 0); publishState(); break;
      case 'r': case 'R':                                   /* reset: Shift+R only */
        if (e.shiftKey) { resetAll(); broadcastCmd('reset', null); publishState(); } else handled = false;
        break;
      case 'a': case 'A': if (!e.shiftKey) { handled = false; break; } if (AP.on) apStop(); else apStart(); publishState(); break;   /* Shift+A */
      case 'v': case 'V': try { if (typeof Street.resetView === 'function') Street.resetView(); } catch (x) {} break;
      case 'x': case 'X': if (ids[state.i] === 's7') { stepTo(STEP.k >= 4 ? 3 : 5); publishState(); } else handled = false; break;
      case '[': stepTo(STEP.k - 1); broadcastCmd('step', { to: STEP.k }); publishState(); break;
      case ']': stepTo(STEP.k + 1); broadcastCmd('step', { to: STEP.k }); publishState(); break;
      case 'q': case 'Q': setQR(!state.qr); publishState(); break;
      case 'f': case 'F': toggleFs(); break;
      case 'b': case 'B': case '.': setBlack(!state.black); break;
      case 'h': case 'H': body.classList.toggle('clean'); try { localStorage.setItem('grino_clean', body.classList.contains('clean') ? '1' : '0'); } catch (x) {} break;
      case '?': case '/': if (!e.shiftKey && k !== '?') { handled = false; break; } setHelp(!state.help); break;   /* Shift+/ */
      case 'Escape': if (state.qr) setQR(false); else if (state.help) setHelp(false); else if (state.black) setBlack(false); else handled = false; break;
      default:
        if (/^[0-9]$/.test(k)) go(k === '0' ? 9 : (+k - 1)); else handled = false;   /* by position in GRINO.SCREENS */
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  document.addEventListener('keydown', onKey);
  function toggleFs() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else document.exitFullscreen();
    } catch (e) {}
  }
  try { if (localStorage.getItem('grino_clean') === '1') body.classList.add('clean'); } catch (e) {}
  /* hide the cursor when idle */
  var idleT = 0;
  document.addEventListener('mousemove', function () { body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(function () { body.classList.add('idle'); }, 2500); });
  /* click: right half = next, left = previous (only on the stage, not on S7) */
  var downAt = null;
  document.addEventListener('pointerdown', function (e) { downAt = [e.clientX, e.clientY]; }, true);
  $('#viewport').addEventListener('click', function (e) {
    if (downAt && Math.abs(e.clientX - downAt[0]) + Math.abs(e.clientY - downAt[1]) > 6) return;   /* that was a drag */
    if (body.classList.contains('r3d') && isScene(ids[state.i]) && e.target && e.target.tagName === 'CANVAS') return;   /* 3D: the canvas is for rotating */
    if (e.clientX > window.innerWidth * 0.5) next(); else prev();
  });

  /* ---------------- remote link ---------------- */
  var DECK_ID = Math.random().toString(36).slice(2, 7);
  /* keyboard / clicker / autopilot on THIS deck -> a command on <TOPIC>-cmd, so the other decks follow (remotes see the acks) */
  var DSID = 'deck-' + DECK_ID, DSEQ = 0, lastBroadcastSun = 0;
  function broadcastCmd(type, value, primaryOnly) {
    if (!(window.GrinoTransport && GrinoTransport.relayEnabled())) return;
    var c = { sid: DSID, seq: ++DSEQ, type: type, value: value };
    seen[DSID + ':' + c.seq] = 1;                       /* our own echo (SSE paths) is ignored */
    var body = JSON.stringify(c), topic = encodeURIComponent((cfg.TOPIC + '-cmd').toLowerCase());
    [cfg.RELAY_URL].filter(Boolean).forEach(function (u) {
      try { fetch(u.replace(/\/+$/, '') + '/' + topic, { method: 'POST', body: body, cache: 'no-store', keepalive: true }).catch(function () {}); } catch (e) {}
    });
  }
  var tr = null, p2pDeck = null, statusEl = $('#status'), statusTxt = $('#statusTxt');
  var lastNav = Object.create(null);
  var seen = Object.create(null), seenList = [], lastSunSeq = Object.create(null), remoteSeenAt = 0;
  var ackTimer = 0, lastAckAt = 0, ackPending = null, lastVia = null;
  function setStatus(s, info, kind, all) {
    /* dot: green if any backend is open; amber while connecting; red if all failed */
    var st = all || {}, any = false, conn = false;
    for (var k in st) { if (st[k].s === 'open') any = true; else if (st[k].s === 'connecting') conn = true; }
    statusEl.className = any ? 'open' : (conn ? 'connecting' : (s || 'error'));
    statusTxt.textContent = tr ? tr.describe() : '';
    window.DECK.links = st;
  }
  function sun242() {
    var T = cfg.SUN_242 || {}, r = String(window.DECK.renderer || '2d');
    return r === '3d' ? T['3d'] : /png/.test(r) ? T.png : T['2d'];
  }
  function snapshot() {
    var stepInfo = { k: STEP.k, n: STEP.n };
    var caps = { orbit: !!(window.Street && typeof Street.orbitBy === 'function'), autoRotate: !!(window.Street && typeof Street.setAutoRotate === 'function') ? (state.autoRotate !== false) : null, lines: hasLinesApi(), addBox: !!(window.Street && typeof Street.addBox === 'function'), renderer: window.DECK.renderer || '2d', sun242: sun242(), rec: RECV.state };
    return { screen: state.i, id: ids[state.i], step: stepInfo, sun: Math.round(state.sun * 100) / 100, guard: state.lines > 0, lines: state.lines, boxes: state.lines * 3, caps: caps, resets: window.DECK.resets || 0, auto: AP.on, qr: state.qr, black: state.black,
      calc: ids[state.i] === 's7' ? calcState() : { avail: !!calcDoc() } };
  }
  /* acks and state go to every path a remote may listen on: the relay always (all remotes, all decks stay in sync),
     plus the path the command came from (old relay / ntfy / P2P). Each path has its own coalescing timer. */
  var ACKQ = {};
  function queueAck(kind, sid, seq, via) {
    if (!tr) return;
    via = via || lastVia || 'relay';
    var targets = { relay: 1 }; targets[via] = 1;
    if (!(window.GrinoTransport && GrinoTransport.relayEnabled())) { delete targets.relay; targets[via === 'relay' ? 'ntfy' : via] = 1; }
    Object.keys(targets).forEach(function (t) {
      var q = ACKQ[t] || (ACKQ[t] = { pending: null, timer: 0, last: 0 });
      if (kind === 'ack' || !q.pending) q.pending = { kind: kind, sid: sid, seq: seq };
      if (q.timer) return;
      var iv = window.GrinoTransport.ackIntervalMs(t);
      q.timer = setTimeout(function () { flushAck(t); }, Math.max(t === 'p2p' ? 0 : 40, q.last + iv - Date.now()));
    });
  }
  function flushAck(t) {
    var q = ACKQ[t]; q.timer = 0; if (!q.pending || !tr) return;
    var a = q.pending; q.pending = null; q.last = Date.now();
    var msg = snapshot(); msg.kind = a.kind; msg.sid = a.sid; msg.seq = a.seq; msg.t = Date.now(); msg.via = t; msg.deck = DECK_ID;
    if (t === 'p2p') {
      if (p2pDeck && p2pDeck.send(msg) > 0) { window.DECK.log.push({ out: msg, r: 'p2p' }); if (window.DECK.log.length > 300) window.DECK.log.shift(); }
      return;
    }
    tr.send(msg, t).then(function (r) { window.DECK.log.push({ out: msg, r: r }); if (window.DECK.log.length > 300) window.DECK.log.shift(); });
  }
  /* local changes (keyboard) are reported only while a remote is around, to save the ntfy budget */
  function publishState() { if (tr && (GrinoTransport.relayEnabled() || (remoteSeenAt && Date.now() - remoteSeenAt < 20 * 60 * 1000))) queueAck('state', null, null, lastVia); }
  var stateSoonT = 0;
  function publishStateSoon() { clearTimeout(stateSoonT); stateSoonT = setTimeout(publishState, 1200); }

  function onCommand(c, meta) {
    if (!c || typeof c.type !== 'string') return;
    if (c.kind === 'ack' || c.kind === 'state') return;
    if (meta && meta.age > cfg.CMD_MAX_AGE_S) { window.DECK.log.push({ dropped: 'old', c: c, age: meta.age }); return; }
    var via = (meta && meta.via) || 'relay';
    var key = (c.sid || '-') + ':' + c.seq;
    if (c.seq != null) {
      if (seen[key]) { queueAck('ack', c.sid, c.seq, via); return; } /* duplicate (retry): ack again, do not re-apply */
      seen[key] = 1; seenList.push(key); if (seenList.length > 600) delete seen[seenList.shift()];
    }
    remoteSeenAt = Date.now(); lastVia = via;
    /* navigation is absolute and idempotent: a nav command older than the newest one already applied from the same remote is
       ignored (it can arrive late through another path) */
    if ((c.type === 'goto' || c.type === 'next' || c.type === 'prev') && c.sid && c.seq != null) {
      if (lastNav[c.sid] != null && c.seq < lastNav[c.sid]) { window.DECK.log.push({ dropped: 'older nav', c: c }); queueAck('ack', c.sid, c.seq, via); return; }
      lastNav[c.sid] = c.seq;
    }
    statusEl.classList.add('flash'); setTimeout(function () { statusEl.classList.remove('flash'); }, 250);
    window.DECK.log.push({ in: c, age: meta && meta.age, at: Date.now(), via: meta && meta.via });
    if (window.DECK.log.length > 300) window.DECK.log.shift();
    var v = c.value;
    switch (c.type) {
      case 'goto': {
        var gi = v && typeof v === 'object' ? (v.id && ids.indexOf(v.id) >= 0 ? ids.indexOf(v.id) : +v.i) : +v;
        if (gi !== state.i) go(gi, 'remote');
        break;
      }
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'sun':
        if (c.sid && c.seq != null && lastSunSeq[c.sid] != null && c.seq < lastSunSeq[c.sid]) break; /* out of order */
        if (c.sid && c.seq != null) lastSunSeq[c.sid] = c.seq;
        var ms = (v && typeof v === 'object') ? v.ms : null, val = (v && typeof v === 'object') ? v.v : v;
        /* relay: apply within ~100 ms (no long easing); ntfy: ease over the (slow) sample interval */
        setSun(val, via === 'p2p' ? 40 : via === 'relay' ? 100 : (ms != null ? ms : Math.round(1000 / window.GrinoTransport.sunHz(via) * 1.05)));
        break;
      case 'rec': if (v === 'off') recHide(); else recPlay(); break;
      case 'sweep': setSun(v && v.to != null ? v.to : 1, v && v.ms ? v.ms : 7000); break;
      case 'guard': setGuard(typeof v === 'boolean' ? v : !state.guard); break;
      case 'addbox': addBox(); break;
      case 'lines': setLines(v); break;
      case 'boxes': setLines(+v >= 6 ? 2 : (+v >= 3 ? 1 : +v)); break;
      case 'reset': resetAll(); break;
      case 'orbit':
        if (window.Street && typeof Street.orbitBy === 'function' && v) {
          var sc = +cfg.ORBIT_SCALE || Math.PI;
          try { Street.orbitBy((+v.dx || 0) * sc, (+v.dy || 0) * sc * 0.5); } catch (x) { console.warn(x); }
        }
        break;
      case 'view':
        try {
          if (v === 'reset' && typeof Street.resetView === 'function') Street.resetView();
          else if ((v === 'auto-on' || v === 'auto-off') && typeof Street.setAutoRotate === 'function') { state.autoRotate = v === 'auto-on'; Street.setAutoRotate(state.autoRotate); }
          else if (v && typeof v === 'object' && typeof Street.setView === 'function') Street.setView(+v.yaw || 0, +v.pitch || 30, v.ms == null ? 900 : +v.ms);
        } catch (x) { console.warn(x); }
        break;
      case 'auto': if (v === false || (v == null && AP.on)) apStop(); else if (!AP.on) apStart(); break;
      case 'step':
        if (v && typeof v === 'object' && v.to != null) stepTo(+v.to);
        else stepTo(STEP.k + (v && v.d ? +v.d : (+v || 1)));
        break;
      case 'qr': setQR(typeof v === 'boolean' ? v : !state.qr); break;
      case 'black': setBlack(typeof v === 'boolean' ? v : !state.black); break;
      case 'calc':
        if (ids[state.i] !== 's7') go(ids.indexOf('s7'), 'remote');
        loadCalc();
        if (v && v.prepare) { calcPrepare(); stepTo(1); break; }
        if (v && v.fix) { stepTo(4); clearTimeout(stepT); stepT = setTimeout(function () { stepTo(5); queueAck('state', null, null, via); }, 1200); break; }
        if (v && v.reset) { calcCommand({ reset: true }); stepTo(3); break; }
        if (!calcCommand(v)) setTimeout(function () { calcCommand(v); queueAck('state', null, null, via); }, 1200);
        if (v && v.pv != null) {
          if (STEP.k < 2) stepTo(2);
          clearTimeout(stepT);
          stepT = setTimeout(function () { var dd = calcDoc(); if (dd && parseInt((dd.getElementById('k_hours') || {}).textContent, 10) > 0 && STEP.k === 2) { stepTo(3); queueAck('state', null, null, via); } }, 700);
        }
        break;
      case 'ping': break;
      default: return;
    }
    queueAck('ack', c.sid, c.seq, via);
  }

  function startTransport() {
    if (!window.GrinoTransport) { setStatus('offline', 'no transport'); return; }
    if (!window.GrinoTransport.relayEnabled()) { setStatus('offline', 'local'); window.DECK.links = {}; return; }   /* no ?k= : no relay, no ACKs */
    try {
      tr = window.GrinoTransport.connectAll({ listen: 'cmd', publish: 'ack', onMessage: onCommand, onStatus: setStatus });
      if (window.GrinoP2P) {
        p2pDeck = GrinoP2P.deck({ onMessage: onCommand, onStatus: function (n) { window.DECK.p2pPeers = n; statusEl.classList.toggle('p2p', n > 0); } });
        window.DECK.p2p = p2pDeck;
      }
      window.DECK.transport = tr;
    } catch (e) { setStatus('error', String(e)); }
  }

  /* help overlay: never shows the link key, the topic or the remote QR */
  (function () {
    $('#helpRemote').textContent = window.GrinoTransport && window.GrinoTransport.relayEnabled() ? 'Remote: open the link from the team chat on the phone.' : 'No link key: this deck runs locally (keyboard / clicker).';
  })();

  /* ---------------- start ---------------- */
  var start = 0, h = (location.hash || '').replace('#', '');
  if (h) { var ix = ids.indexOf(h); if (ix < 0 && /^\d+$/.test(h)) ix = +h - 1; if (ix >= 0) start = ix; }
  ensureStreet();
  go(start, 'init');
  setLines(0);
  setTimeout(try3D, 300);   /* build the 3D street behind the cover */
  setTimeout(tryParts3D, 900);
  setTimeout(loadCalc, 1500); /* pre-render the calculator so S7 is instant */
  startTransport();
  window.DECK.go = go; window.DECK.setSun = setSun; window.DECK.setGuard = setGuard; window.DECK.setLines = setLines; window.DECK.addBox = addBox; window.DECK.resetAll = resetAll; window.DECK.ap = { start: apStart, stop: apStop, state: AP }; window.DECK.snapshot = snapshot; window.DECK.onCommand = onCommand;
})();
