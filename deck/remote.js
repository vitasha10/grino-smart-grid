/* Phone remote for the Grino #27 deck. Sends commands on <TOPIC>-cmd, listens to deck acks on <TOPIC>-ack. */
(function () {
  'use strict';
  var cfg = window.GRINO, DATA = window.DECK_DATA || {}, SP = DATA.speech || [];
  var $ = function (id) { return document.getElementById(id); };
  var N = cfg.SCREENS.length, TOTAL = cfg.PITCH_SECONDS;
  var sid = Math.random().toString(36).slice(2, 8);
  var seq = 0, sentAt = {};
  var rtts = [];
  var R = { cur: 0, deck: null, sun: 0.15, sunLocalAt: 0, guard: false, lines: 0, caps: null, auto: false, resets: null, qr: false, black: false, calc: null, pv: 48, pvLocalAt: 0,
            lastSent: 0, lastAcked: 0, lastSentAt: 0, lastAckAt: 0, lat: null, tstate: 'connecting', tinfo: '', open: false,
            rl: false, rlUntil: 0, deckSeen: false, sentRun: 0, acksRun: 0, sendErr: '', pinged: false };
  var inflight = { sun: 0, calc: 0 };
  var p2p = null;
  function viaP2P() { return !!(p2p && p2p.isOpen()); }
  window.REMOTE = { R: R, sentAt: sentAt };

  function buzz() { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(12); } catch (e) {} }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mmss(s) { var neg = s < 0; s = Math.abs(Math.round(s)); return (neg ? '-' : '') + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  /* ---------- message budget (ntfy.sh: 250 / day / IP, reset 00:00 UTC) ---------- */
  var dayKey = 'grino_sent_' + new Date().toISOString().slice(0, 10) + '_' + cfg.TOPIC;
  function bumpCount() { R.sentRun++; try { localStorage.setItem(dayKey, String((+localStorage.getItem(dayKey) || 0) + 1)); } catch (e) {} }
  function dayCount() { try { return +localStorage.getItem(dayKey) || 0; } catch (e) { return 0; } }

  /* ---------- transport ---------- */
  var tr = null;
  function onStatus(s, info) {
    R.tstate = s; R.tinfo = info || '';
    R.open = s === 'open';
    if (s === 'ratelimited') enterRL();
    if (R.open && !R.pinged) { R.pinged = true; setTimeout(function () { send('ping', null, { discrete: true }); }, 300); }
    render();
  }
  function enterRL() {
    if (!tr || tr.kind() !== 'ntfy') return;
    R.rl = true; R.rlUntil = Date.now() + 60000;
    sunPending = null; pvPending = null;
    render();
  }
  function doSend(msg, retries) {
    var kind = msg.type === 'sun' ? 'sun' : (msg.type === 'calc' && msg.value && msg.value.pv != null ? 'calc' : null);
    if (kind) inflight[kind]++;
    bumpCount();
    tr.send(msg).then(function (r) {
      if (kind) inflight[kind]--;
      if (r.status === 429) { R.sendErr = 'HTTP 429'; enterRL(); }
      else if (!r.ok) {
        R.sendErr = r.status ? ('HTTP ' + r.status) : 'network error';
        if (retries > 0 && msg.seq === R.lastSent) setTimeout(function () { doSend(msg, retries - 1); }, 1200);
      } else R.sendErr = '';
      render();
    });
  }
  /* opt.discrete: screen changes / toggles (always allowed, retried on a failed POST).
     Continuous samples (sun, pv) are dropped while rate-limited and never queued. */
  /* Every command goes through the relay, so ALL decks (and all other remotes) on the topic stay in sync.
     P2P is only an extra fast path to the paired deck: sun/orbit samples at 50/s on 'fast', discrete commands also on 'ctl'.
     The deck de-duplicates by (remote id, seq), so a command arriving twice is applied once. */
  var lastRelaySample = 0;
  function send(type, value, opt) {
    opt = opt || {};
    seq++;
    var msg = { sid: sid, seq: seq, type: type, value: value === undefined ? null : value };
    var now = Date.now(); sentAt[seq] = now;
    var sample = (type === 'sun' || type === 'orbit') && !opt.discrete;
    if (viaP2P()) {
      var ok = sample ? p2p.sendFast(msg) : p2p.sendCtl(msg);
      if (ok) R.sentP2P = (R.sentP2P || 0) + 1;
    }
    if (sample) {
      /* relay copy of samples at most SUN_HZ_RELAY per second (the paired deck already has them over P2P) */
      var iv = 1000 / window.GrinoTransport.sunHz(tr ? tr.kind() : null);
      if (now - lastRelaySample < iv * 0.9 || R.rl) { render(); return true; }
      lastRelaySample = now;
      doSend(msg, 0);
      render();
      return true;
    }
    R.lastSent = seq; R.lastSentAt = now;
    doSend(msg, 2);
    /* not acked in time (a path dropped it): send the same seq once more */
    setTimeout(function () { if (R.lastAcked < msg.seq && R.lastSent === msg.seq) { R.resent = (R.resent || 0) + 1; doSend(msg, 0); } }, 1300);
    setTimeout(render, cfg.ACK_TIMEOUT_MS + 50);
    render();
    return true;
  }
  function onMessage(m) {
    if (!m || (m.kind !== 'ack' && m.kind !== 'state')) return;
    R.acksRun++; R.deckSeen = true; R.lastAckAt = Date.now();
    if (m.kind === 'ack' && m.sid === sid && m.seq > R.lastAcked) {
      R.lastAcked = m.seq;
      if (sentAt[m.seq]) { R.lat = R.lastAckAt - sentAt[m.seq]; rtts.push(R.lat); if (rtts.length > 8) rtts.shift(); }
    }
    R.deck = m;
    var settled = R.lastAcked >= R.lastSent;
    /* the latest deck state wins (by screen id, so a deck with another screen order still maps correctly) */
    if ((typeof m.screen === 'number' || m.id) && (settled || m.kind === 'state' || m.sid !== sid)) {
      var byId = -1; if (m.id) cfg.SCREENS.forEach(function (x, i) { if (x.id === m.id) byId = i; });
      var ns = clamp(byId >= 0 ? byId : m.screen, 0, N - 1); if (ns !== R.cur) enterScreenLocal(ns); R.cur = ns;
    }
    if (typeof m.guard === 'boolean' && settled) R.guard = m.guard;
    if (typeof m.lines === 'number' && settled) R.lines = m.lines;
    if (m.step && (settled || m.kind === 'state')) R.step = { k: m.step.k, n: m.step.n, id: m.id };
    if (typeof m.resets === 'number') { if (R.resets != null && m.resets > R.resets) resetTimer(); R.resets = m.resets; }
    if (m.caps) R.caps = m.caps;
    if (typeof m.auto === 'boolean') R.auto = m.auto;
    if (typeof m.qr === 'boolean' && settled) R.qr = m.qr;
    if (typeof m.black === 'boolean' && settled) R.black = m.black;
    if (typeof m.sun === 'number' && Date.now() - R.sunLocalAt > 4000) R.sun = m.sun;
    if (m.calc) { R.calc = m.calc; if (m.calc.pv != null && Date.now() - R.pvLocalAt > 4000) R.pv = m.calc.pv; }
    render();
  }

  /* ---------- navigation ---------- */
  var PRE = cfg.PRE_DAWN != null ? +cfg.PRE_DAWN : 0.08;
  function enterScreenLocal(i) {   /* mirror the deck's defined entry states on the phone at once */
    var id = cfg.SCREENS[i] && cfg.SCREENS[i].id;
    if (id === 's2') { R.sun = PRE; R.sunLocalAt = Date.now(); R.lines = 0; }
    if (id === 's5') { R.sun = 1; R.sunLocalAt = Date.now(); R.lines = 0; }
    R.step = { k: 0, n: R.step && R.step.id === id ? R.step.n : 0, id: id };
  }
  /* absolute navigation: always 'go to screen X' (id + index), computed from the latest known deck state */
  function goto(i) { i = clamp(i, 0, N - 1); R.cur = i; enterScreenLocal(i); send('goto', { i: i, id: cfg.SCREENS[i].id }, { discrete: true }); buzz(); }
  $('prev').onclick = function () { goto(R.cur - 1); };
  $('next').onclick = function () { if (R.cur === 0) autoStartTimer(); goto(R.cur + 1); };
  var list = $('list');
  cfg.SCREENS.forEach(function (s, i) {
    var b = document.createElement('button'); b.innerHTML = '<b>' + (i + 1) + '</b>' + s.name; b.onclick = function () { goto(i); };
    list.appendChild(b);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { $('next').click(); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { $('prev').click(); e.preventDefault(); }
  });

  /* ---------- sliders (pointer events, thumb-friendly) ---------- */
  function slider(el, onMove, onUp) {
    var drag = false;
    function val(e) { var r = el.getBoundingClientRect(); return clamp((e.clientX - r.left - 36) / Math.max(1, r.width - 72), 0, 1); }
    el.addEventListener('pointerdown', function (e) { if (el.classList.contains('off')) return; drag = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} onMove(val(e)); e.preventDefault(); });
    el.addEventListener('pointermove', function (e) { if (drag) onMove(val(e)); });
    function end() { if (drag) { drag = false; onUp && onUp(); } }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  }
  function paintSlider(el, v, label) {
    var th = el.querySelector('.thumb'), f = el.querySelector('.fill');
    th.style.left = 'calc(36px + ' + (v * 100).toFixed(2) + '% - ' + (v * 72).toFixed(1) + 'px)';
    f.style.left = th.style.left; f.style.right = '0'; f.style.width = 'auto';
    if (label != null) th.textContent = label;
  }
  /* sun: latest value only, at most SUN_HZ messages per second; the deck eases between samples */
  var sunPending = null, sunTimer = 0, lastSunSend = 0, sunDue = 0;
  function sunIv() { return 1000 / (viaP2P() ? (cfg.SUN_HZ_P2P || 50) : window.GrinoTransport.sunHz(tr ? tr.kind() : null)); }
  function fireSun() {
    clearTimeout(sunTimer); sunTimer = 0;
    if (sunPending == null || R.rl) return;
    /* latest value wins; POST paths: at most 2 requests in flight (no queue behind a slow request), ntfy: 1 */
    if (!viaP2P() && inflight.sun >= (tr.kind() === 'relay' ? 2 : 1)) { sunDue = Date.now() + 15; sunTimer = setTimeout(fireSun, 15); return; }
    var v = sunPending; sunPending = null; lastSunSend = Date.now();
    send('sun', { v: Math.round(v * 1000) / 1000, ms: Math.round(sunIv() * 1.05) });
  }
  /* due now -> sent inside this input event / frame (timers can fire ~100 ms late on a busy phone); otherwise at the next slot */
  function scheduleSun() {
    var now = Date.now();
    if (sunTimer) { if (now >= sunDue) fireSun(); return; }
    var wait = lastSunSend + sunIv() - now;
    if (wait <= 0) { fireSun(); return; }
    sunDue = now + wait; sunTimer = setTimeout(fireSun, wait);
  }
  /* rotate the 3D view: deltas (fraction of the pad) accumulate between sends; <= ORBIT_HZ per second */
  (function () {
    var pad = $('viewPad'), drag = null, acc = { dx: 0, dy: 0 }, timer = 0, last = 0;
    function flush() {
      timer = 0;
      if (Math.abs(acc.dx) + Math.abs(acc.dy) < 0.002) return;
      if (R.rl) { acc.dx = acc.dy = 0; return; }
      var v = { dx: Math.round(acc.dx * 1000) / 1000, dy: Math.round(acc.dy * 1000) / 1000 };
      acc.dx = acc.dy = 0; last = Date.now();
      send('orbit', v);
    }
    function queue() {
      if (timer) return;
      var hz = viaP2P() ? (cfg.SUN_HZ_P2P || 50) : tr && tr.kind() === 'relay' ? (cfg.ORBIT_HZ_RELAY || 20) : (cfg.ORBIT_HZ_NTFY || 0.5);
      timer = setTimeout(flush, Math.max(0, last + 1000 / hz - Date.now()));
    }
    pad.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY }; pad.classList.add('active'); try { pad.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
    pad.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var r = pad.getBoundingClientRect();
      acc.dx += (e.clientX - drag.x) / r.width; acc.dy += (e.clientY - drag.y) / r.height;
      drag = { x: e.clientX, y: e.clientY }; queue();
    });
    function end() { drag = null; pad.classList.remove('active'); }
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
    $('viewReset').onclick = function () { send('view', 'reset', { discrete: true }); buzz(); };
    $('viewAuto').onclick = function () { var on = !(R.caps && R.caps.autoRotate); if (R.caps) R.caps.autoRotate = on; send('view', on ? 'auto-on' : 'auto-off', { discrete: true }); buzz(); render(); };
  })();

  /* ---------- v8 sun strip: vertical, ABSOLUTE (touch height = sun height, bottom = pre-dawn, top = noon) ----------
     1:1 with a light low-pass (time constant 35 ms) only against finger jitter; a 5 px dead-zone only while the finger
     rests after the touch; targets go out at <= SUN_HZ (30/s on the relay WebSocket), latest wins; the release value goes reliably. */
  var SUNMIN = Math.min(0, PRE), STRIP_PAD = 42, TAU = 35, DEAD = 5;
  function sun242() { return R.caps && typeof R.caps.sun242 === 'number' ? R.caps.sun242 : ((cfg.SUN_242 || {})['3d'] || 0.4); }
  function stripFrac(v) { return 1 - (clamp(v, SUNMIN, 1) - SUNMIN) / (1 - SUNMIN); }      /* 0 = top (noon) .. 1 = bottom */
  function stripY(v) { var el = $('sunStrip'); return STRIP_PAD + stripFrac(v) * Math.max(1, el.clientHeight - 2 * STRIP_PAD); }
  function stripValue(clientY) {
    var el = $('sunStrip'), rc = el.getBoundingClientRect(), hgt = Math.max(1, rc.height - 2 * STRIP_PAD);
    return SUNMIN + (1 - SUNMIN) * clamp(1 - (clientY - rc.top - STRIP_PAD) / hgt, 0, 1);
  }
  function paintStrip(v, deckV) {
    var el = $('sunStrip'); if (!el.clientHeight) return;
    var ly = stripY(sun242());
    $('stripKnob').style.top = stripY(v).toFixed(1) + 'px';
    $('stripLim').style.top = ly.toFixed(1) + 'px'; $('stripOver').style.height = ly.toFixed(1) + 'px';
    var g = $('stripGhost'); g.style.display = deckV == null ? 'none' : ''; if (deckV != null) g.style.top = stripY(deckV).toFixed(1) + 'px';
  }
  function vibe(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  var sunSide = null;                                   /* above / below the 242 V mark: a short vibration when crossing */
  function setSunLocal(v) {
    v = Math.round(v * 1000) / 1000;
    var side = v > sun242(); if (sunSide !== null && side !== sunSide) vibe(18); sunSide = side;
    R.sun = v; R.sunLocalAt = Date.now();
    window.REMOTE.sunLog.push([Date.now(), v]); if (window.REMOTE.sunLog.length > 4000) window.REMOTE.sunLog.shift();
    if (!R.rl) { sunPending = v; scheduleSun(); }
    paintStrip(v, R.deck && typeof R.deck.sun === 'number' ? R.deck.sun : null);
    scheduleRender();
  }
  window.REMOTE.sunLog = [];
  var rT = 0; function scheduleRender() { if (!rT) rT = setTimeout(function () { rT = 0; render(); }, 120); }
  (function () {
    var el = $('sunStrip'), drag = false, pid = null, x0 = 0, y0 = 0, moved = false, raw = 0, filt = 0, lastT = 0, raf = 0;
    function loop(t) {
      raf = 0; if (!drag) return;
      var dt = Math.max(0, t - lastT); lastT = t;
      filt += (raw - filt) * (1 - Math.exp(-dt / TAU));
      if (Math.abs(raw - filt) < 0.0005) filt = raw;
      if (Math.abs(filt - R.sun) >= 0.0005) setSunLocal(filt);
      raf = requestAnimationFrame(loop);
    }
    el.addEventListener('pointerdown', function (e) {
      if (el.classList.contains('off') || drag) return;
      drag = true; pid = e.pointerId; moved = false; x0 = e.clientX; y0 = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      raw = filt = stripValue(e.clientY); setSunLocal(raw);               /* absolute: the touch point IS the sun height */
      lastT = performance.now(); raf = requestAnimationFrame(loop);
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== pid) return;
      if (!moved) { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) < DEAD) return; moved = true; }
      raw = stripValue(e.clientY);
    });
    function end(e) {
      if (!drag || (e && e.pointerId != null && e.pointerId !== pid)) return;
      drag = false; pid = null; if (raf) cancelAnimationFrame(raf); raf = 0;
      if (moved) { filt = raw; setSunLocal(raw); }                          /* the deck ends exactly where the finger stopped */
      R.sunLocalAt = Date.now();
      sunPending = null; clearTimeout(sunTimer); sunTimer = 0;               /* sent now, not on a (possibly late) timer */
      send('sun', { v: R.sun, ms: 0 }, { discrete: true });
    }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  })();
  function preset(v) {                                   /* one reliable command; the deck eases there at 1.2 units/s */
    sunPending = null; clearTimeout(sunTimer); sunTimer = 0;
    R.sun = v; R.sunLocalAt = Date.now(); sunSide = v > sun242(); window.REMOTE.sunLog.push([Date.now(), v]);
    send('sun', { v: v, ms: 0 }, { discrete: true }); buzz(); render();
  }
  $('pNoon').onclick = function () { preset(1); };
  $('pMorn').onclick = function () { preset((cfg.SUN_PRESETS && cfg.SUN_PRESETS.morning) || 0.3); };
  $('pDawn').onclick = function () { preset(PRE); };

  /* calculator pv slider */
  var pvPending = null, pvTimer = 0, lastPvSend = 0;
  function schedulePv() {
    if (pvTimer) return;
    var iv = 1000 / window.GrinoTransport.sunHz(tr ? tr.kind() : null);
    pvTimer = setTimeout(function () {
      pvTimer = 0;
      if (pvPending == null || R.rl) return;
      if (inflight.calc >= (tr.kind() === 'relay' ? 2 : 1)) { schedulePv(); return; }
      var v = pvPending; pvPending = null; lastPvSend = Date.now();
      send('calc', { pv: v });
    }, Math.max(0, lastPvSend + iv - Date.now()));
  }
  slider($('pvSlider'), function (v) { R.pv = Math.round(v * 150) * 2; R.pvLocalAt = Date.now(); if (!R.rl) { pvPending = R.pv; schedulePv(); } render(); },
    function () { R.pvLocalAt = Date.now(); if (R.rl) send('calc', { pv: R.pv }, { discrete: true }); });

  /* ---------- toggles ---------- */
  $('guard').onclick = function () { R.lines = R.lines ? 0 : 1; R.guard = R.lines > 0; send('lines', R.lines, { discrete: true }); buzz(); };
  $('addBox').onclick = function () { R.lines = 2; R.guard = true; send('lines', 2, { discrete: true }); buzz(); };
  $('tapBtn').onclick = function () { R.lines = 3; R.guard = true; send('lines', 3, { discrete: true }); buzz(); };
  function stepSend(v) { send('step', v, { discrete: true }); buzz(); }
  $('stepPrev').onclick = function () { if (R.step) R.step.k = Math.max(0, R.step.k - 1); stepSend({ d: -1 }); render(); };
  $('stepNext').onclick = function () { if (R.step) R.step.k = Math.min(R.step.n, R.step.k + 1); stepSend({ d: 1 }); render(); };
  $('resetBoxes').onclick = function () { R.lines = 0; R.guard = false; send('lines', 0, { discrete: true }); buzz(); };
  $('resetAll').onclick = function () {
    if (!window.confirm('Reset everything?\n\nDeck back to screen 1, sun at dawn, SunGuard off on both lines, calculator back to its default line, timer reset.')) return;
    R.cur = 0; R.lines = 0; R.sun = 0.08; R.sunLocalAt = Date.now(); R.auto = false; resetTimer();
    send('reset', null, { discrete: true }); buzz();
  };
  $('auto').onclick = function () { R.auto = !R.auto; send('auto', R.auto, { discrete: true }); buzz(); };
  $('qr').onclick = function () { R.qr = !R.qr; send('qr', R.qr, { discrete: true }); buzz(); };
  $('black').onclick = function () { R.black = !R.black; send('black', R.black, { discrete: true }); buzz(); };
  $('ping').onclick = function () { send('ping', null, { discrete: true }); buzz(); };
  $('cLoad').onclick = function () { send('calc', { prepare: true }, { discrete: true }); buzz(); };
  $('cFix').onclick = function () { send('calc', { fix: true }, { discrete: true }); buzz(); };
  $('cReset').onclick = function () { send('calc', { reset: true }, { discrete: true }); buzz(); };
  $('cTop').onclick = function () { send('calc', { scroll: 'top' }, { discrete: true }); buzz(); };
  $('cOpts').onclick = function () { send('calc', { scroll: 'opts' }, { discrete: true }); buzz(); };

  /* keep the phone awake during the pitch */
  var wake = null;
  function wakeUp() {
    if (!('wakeLock' in navigator) || wake) return;
    navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; render(); }); render(); }).catch(function () {});
  }
  $('wake').onclick = function () { wakeUp(); buzz(); };
  document.addEventListener('pointerdown', wakeUp, { once: true });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { wakeUp(); if (tr.reconnect && !R.open) tr.reconnect(); } });

  /* ---------- 3:00 timer (survives a reload) ---------- */
  var TK = 'grino_timer_' + cfg.TOPIC, T = { running: false, startAt: 0, acc: 0 };
  try { var tt = JSON.parse(localStorage.getItem(TK) || 'null'); if (tt && typeof tt.acc === 'number') T = tt; } catch (e) {}
  function saveT() { try { localStorage.setItem(TK, JSON.stringify(T)); } catch (e) {} }
  function elapsed() { return (T.acc + (T.running ? Date.now() - T.startAt : 0)) / 1000; }
  function autoStartTimer() { if (!T.running && T.acc === 0) { T.running = true; T.startAt = Date.now(); saveT(); } }
  $('tStart').onclick = function () { if (!T.running) { T.running = true; T.startAt = Date.now(); saveT(); } buzz(); render(); };
  $('tPause').onclick = function () { if (T.running) { T.acc += Date.now() - T.startAt; T.running = false; saveT(); } buzz(); render(); };
  function resetTimer() { T = { running: false, startAt: 0, acc: 0 }; saveT(); render(); }
  $('tReset').onclick = function () { resetTimer(); buzz(); };

  /* ---------- render ---------- */
  var lastSpeech = -1;
  function render() {
    var now = Date.now();
    if (R.rl && now > R.rlUntil) R.rl = false;
    /* connection indicator: green only when the deck acknowledged our last command */
    var c = $('conn'), t, s, cls;
    if (!cfg.TOPIC) { cls = 'bad'; t = 'Open the link from the team chat'; s = 'this page needs its link key (?k=…)'; }
    else if (!R.open) { cls = 'bad'; t = R.tstate === 'ratelimited' ? 'Rate-limited (subscribe)' : (R.tstate === 'offline' ? 'Offline' : 'Connecting…'); s = R.tinfo; }
    else if (R.rl) { cls = 'bad'; t = 'Rate-limited (ntfy 429)'; s = 'only screen changes and toggles for ' + Math.ceil((R.rlUntil - now) / 1000) + ' s'; }
    else if (R.lastSent > R.lastAcked) {
      if (now - R.lastSentAt < cfg.ACK_TIMEOUT_MS) { cls = 'wait'; t = 'Sent · waiting for deck'; s = R.sendErr || ('cmd #' + R.lastSent); }
      else { cls = 'bad'; t = 'No ack from deck'; s = R.sendErr || 'is the deck open with the same topic?'; }
    } else if (R.deckSeen) { cls = 'ok'; t = 'Deck ✓'; s = 'last ack ' + Math.round((now - R.lastAckAt) / 1000) + ' s ago'; }
    else { cls = 'wait'; t = 'Linked · no deck yet'; s = 'tap Ping'; }
    /* status line: active transport + measured round trip (cmd -> ack, median of the last 8) */
    var kindNow = viaP2P() ? 'p2p' : (tr ? tr.kind() : '…');
    var med = null;
    if (kindNow === 'p2p') med = p2p.rtt() != null ? Math.round(p2p.rtt()) : null;
    else if (rtts.length) { var ss = rtts.slice().sort(function (a, b) { return a - b; }); med = ss[Math.floor(ss.length / 2)]; }
    var p2pNote = p2p && !viaP2P() && p2p.state() === 'connecting' ? ' (P2P…)' : '';
    var tl = (kindNow === 'p2p' ? 'P2P' : kindNow === 'relay' ? 'relay' + p2pNote : kindNow === 'ntfy' ? 'ntfy' + (tr.fellBack() ? ' (fallback)' : '') : kindNow) + (med != null ? ' · rtt ' + (med < 1000 ? med + ' ms' : (med / 1000).toFixed(1) + ' s') : '');
    c.className = 'conn ' + cls; $('connT').textContent = t + ' · ' + tl; $('connS').textContent = s;

    var w = $('warn');
    if (R.rl) { w.className = 'warn on'; w.textContent = '⚠ ntfy.sh rate limit (HTTP 429). Sun / solar sliders are paused; screen changes, toggles and "Sweep" still go through. Back to normal in ' + Math.ceil((R.rlUntil - now) / 1000) + ' s. Keyboard on the laptop always works.'; }
    else if (!cfg.TOPIC) { w.className = 'warn on'; w.textContent = 'Open the link from the team chat — this remote has no link key and is not connected.'; }
    else if (!R.open && R.tstate !== 'connecting') { w.className = 'warn on'; w.textContent = '⚠ No connection to the relay. Use the laptop keyboard / clicker meanwhile.'; }
    else if (tr && tr.fellBack()) { w.className = 'warn on'; w.style.background = 'rgba(245,165,36,.14)'; w.style.borderColor = 'rgba(245,165,36,.6)'; w.style.color = '#FFD9A0'; w.textContent = 'Relay WebSocket unreachable — using SSE / long-poll on the same relay.'; }
    else w.className = 'warn';

    /* current screen */
    var sc = cfg.SCREENS[R.cur], sp = SP[R.cur] || {};
    $('curK').textContent = 'Screen ' + (R.cur + 1) + ' / ' + N;
    $('curT').textContent = sc.name;
    var d = R.deck;
    $('deckLine').textContent = d ? ('deck shows: ' + (d.screen + 1) + ' · ' + cfg.SCREENS[d.screen].name + (d.lines ? ' · SunGuard ' + (d.lines >= 3 ? 'everywhere + transformer' : d.lines >= 2 ? 'everywhere' : 'where needed') : '') + (d.auto ? ' · AUTOPILOT' : '') + (d.qr ? ' · QR' : '') + (d.black ? ' · BLACK' : '')) : 'deck: —';
    $$('#list button').forEach(function (b, i) { b.classList.toggle('cur', i === R.cur); b.classList.toggle('deck', !!d && d.screen === i); });

    /* timer + per-screen target */
    var e = elapsed(), t0 = sp.t || 0, t1 = SP[R.cur + 1] ? SP[R.cur + 1].t : TOTAL;
    var tm = $('timer'), state = 'ontime', note = '';
    if (!T.running && T.acc === 0) { state = ''; note = 'not started'; }
    else if (e > t1) { var late = e - t1; state = late > 5 ? 'late' : 'behind'; note = '+' + Math.round(late) + ' s behind'; }
    else if (e < t0 - 3) { state = 'ahead'; note = Math.round(t0 - e) + ' s ahead'; }
    else note = 'on time';
    if (e > TOTAL) state = 'late';
    tm.className = 'timer ' + state;
    $('tLeft').textContent = mmss(TOTAL - e);
    $('tInfo').textContent = (T.running ? '' : (T.acc ? 'paused · ' : '')) + note;
    $('curTgt').textContent = 'target ' + mmss(t0) + ' → ' + mmss(t1) + (T.running || T.acc ? ' · now ' + mmss(e) : '');
    $('curTgt').style.color = state === 'late' ? 'var(--red)' : state === 'behind' ? 'var(--amber)' : state === 'ahead' ? 'var(--blue)' : 'var(--ok2)';

    /* context panels */
    $('pSun').classList.toggle('on', !!sc.sun);
    $('pGuard').classList.toggle('on', !!sc.guard);
    $('pGuard').style.order = sc.guard ? '-1' : '';          /* S5: SunGuard buttons right under Next, the sun strip below them */
    $('pCalc').classList.toggle('on', !!sc.calc);
    $('sunStrip').classList.toggle('off', R.rl);
    $('pvSlider').classList.toggle('off', R.rl);
    paintStrip(R.sun, d && typeof d.sun === 'number' ? d.sun : null);
    var isS2 = sc.id === 's2', pre = R.sun <= 0.001;
    $('sunH').textContent = isS2 && pre ? 'Raise the sun ↑' : 'Sun';
    $('sunStrip').classList.toggle('hint', isS2 && pre);
    var pm = (cfg.SUN_PRESETS && cfg.SUN_PRESETS.morning) || 0.3;
    $('pNoon').classList.toggle('on', R.sun >= 0.999); $('pMorn').classList.toggle('on', Math.abs(R.sun - pm) < 0.005); $('pDawn').classList.toggle('on', R.sun <= PRE + 0.001);
    var dv = d && typeof d.sun === 'number' ? (d.sun <= 0 ? 'pre-dawn' : Math.round(d.sun * 100) + '%') : null, lv = R.sun <= 0 ? 'pre-dawn' : Math.round(R.sun * 100) + '%';
    $('sunV').textContent = lv + (dv && dv !== lv ? ' · deck ' + dv : '');
    paintSlider($('pvSlider'), R.pv / 300, String(R.pv));
    var g = $('guard'); g.textContent = R.lines ? 'SunGuard OFF' : 'SunGuard ON · where needed'; g.classList.toggle('on', R.lines > 0);
    $('boxV').textContent = (R.lines >= 3 ? 'everywhere + transformer' : R.lines >= 2 ? 'everywhere' : R.lines >= 1 ? 'where needed' : 'off') + (d && d.caps && d.caps.renderer ? ' · ' + d.caps.renderer : '');
    var ab = $('addBox'); ab.hidden = !(R.caps && (R.caps.lines || R.caps.addBox)); ab.disabled = R.lines < 1 || R.lines >= 2; ab.classList.toggle('on', R.lines >= 2);
    ab.textContent = R.lines >= 2 ? 'SunGuard everywhere ✓' : '+ SunGuard everywhere';
    var tb = $('tapBtn'); tb.disabled = R.lines < 2 || R.lines >= 3; tb.classList.toggle('on', R.lines >= 3); tb.textContent = R.lines >= 3 ? 'Transformer adjusted ✓' : 'ENA adjusts the transformer';
    $('pView').hidden = !(sc.sun && R.caps && R.caps.orbit);
    /* steps inside the screen (S3 numbers, S5 points, S6b rows, S7 callouts) */
    var stp = sc.steps && R.step && R.step.id === sc.id ? R.step : null, conf = (cfg.STEPS || {})[sc.id] || {};
    $('pStep').classList.toggle('on', !!sc.steps);
    if (sc.steps) {
      var n = stp ? stp.n : (conf.chips ? conf.chips.length - 1 : 0), k = stp ? stp.k : 0;
      $('stepH').textContent = sc.id === 's7' ? 'Demo steps' : 'State';
      $('stepV').textContent = stp ? (k + ' / ' + n) : '—';
      var chipsEl = $('stepChips'), want = sc.id + ':' + n;
      if (chipsEl.dataset.k !== want) {
        chipsEl.dataset.k = want; chipsEl.innerHTML = '';
        var labels = conf.chips || [];
        if (n <= 6) for (var ci = 0; ci <= n; ci++) {
          var b = document.createElement('button'); b.textContent = labels[ci] || String(ci);
          (function (ci) { b.onclick = function () { if (R.step) R.step.k = ci; stepSend({ to: ci }); render(); }; })(ci);
          chipsEl.appendChild(b);
        }
      }
      Array.prototype.forEach.call(chipsEl.children, function (b, ci) { b.classList.toggle('on', ci === k); });
    }
    var va = $('viewAuto'); va.hidden = !(R.caps && R.caps.autoRotate != null); va.classList.toggle('on', !!(R.caps && R.caps.autoRotate)); va.textContent = 'Auto-rotate ' + (R.caps && R.caps.autoRotate ? 'ON' : 'off');
    $('auto').classList.toggle('on', !!R.auto);
    $('qr').classList.toggle('on', R.qr); $('black').classList.toggle('on', R.black);
    $('wake').classList.toggle('on', !!wake);
    var cc = R.calc;
    $('calcV').textContent = cc && cc.avail ? ('deck ' + (cc.pv != null ? cc.pv + ' kWp' : '')) : 'not reachable';
    $('calcKv').innerHTML = cc && cc.avail && cc.hours !== undefined ? ('<span>hours outside</span><b>' + (cc.hours || '–') + '</b><span>max voltage</span><b>' + (cc.vmax || '–') + '</b><span>hosting now</span><b>' + (cc.hc || '–') + '</b><span>tap / volt-var</span><b>' + (cc.tap != null ? cc.tap : '–') + ' / ' + (cc.qu ? 'on' : 'off') + '</b>' + (cc.feeder ? '<span>feeder</span><b>' + cc.feeder + '</b>' : '')) : '';

    /* speech prompt */
    if (lastSpeech !== R.cur) {
      lastSpeech = R.cur;
      $('speech').innerHTML = (sp.direction ? '<span class="dir">(' + esc(sp.direction) + ')</span>' : '') + esc(sp.text || '');
    }
    /* footer */
    var kind = kindNow;
    $('foot').innerHTML = 'Transport: <b>' + (kind === 'p2p' ? 'P2P (WebRTC, direct) + relay ' + esc(cfg.RELAY_URL) + ' as fallback' : kind === 'relay' ? 'own relay · ' + esc(cfg.RELAY_URL) : 'not connected') + '</b> · remote id ' + sid +
      '<br>This session: ' + R.sentRun + ' sent, ' + R.acksRun + ' acks received' + (kind === 'ntfy' ? ' · sent today from this phone: <b>' + dayCount() + '</b><br>ntfy.sh allows 250 messages / day per IP (phone + laptop share it on one Wi-Fi; reset 04:00 Yerevan) and 60 requests, then 1 per 5 s.' : '');
  }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  if (window.GrinoP2P) {
    window.REMOTE.p2pLog = [];
    p2p = GrinoP2P.remote({ onMessage: onMessage, onStatus: function (s, i) { window.REMOTE.p2pLog.push([Date.now(), s, i]); if (window.REMOTE.p2pLog.length > 50) window.REMOTE.p2pLog.shift(); render(); } });
    window.REMOTE.p2p = p2p;
  }
  window.REMOTE.rtts = function () { return rtts.slice(); };
  tr = window.GrinoTransport.connect({ listen: 'ack', publish: 'cmd', onMessage: onMessage, onStatus: onStatus,
    onFallback: function () { R.pinged = false; R.open = false; render(); } });
  window.REMOTE.transport = tr;
  setInterval(render, 500);
  render();
})();
