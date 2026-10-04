/* streetsnap.js — fallback for S2/S5 when the 3D street (street3d.js) cannot run (file://, no WebGL2, watchdog):
 * crossfades the PNG snapshots exported by the 3D street (GRINO.STREET_SNAPSHOTS):
 *   dawn · noon_off (no SunGuard) · noon_guard (SunGuard where needed: lines A + B) · noon_all (SunGuard everywhere).
 * StreetSnap.tryInstall(el, cb): preloads the four images; if ALL load, swaps the window.Street methods in place
 * (same calls as street.js / street3d.js) and calls cb(true); otherwise cb(false) and the 2D street.js stays.
 * volts() is a coarse MODEL for the deck's headline logic only (last home of lines A, B, C, D):
 *   long lines A, B, D: 236 V at dawn -> 252 V at noon (F13); short line C stays <= 240 V; SunGuard holds a line at <= 240 V.
 */
(function () {
  'use strict';
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  var KEYS = ['init', 'setSun', 'sweepSun', 'getSun', 'setActive', 'setBoxes', 'setGuard', 'setGuardAll', 'setGuardRight', 'addBox',
              'setBoxCount', 'boxes', 'pulse', 'volts', 'state', 'cutPercent', 'boxedHouses', 'setLines', 'lines'];

  function tryInstall(el, cb) {
    var cfg = window.GRINO || {}, P = cfg.STREET_SNAPSHOTS || {};
    var names = ['dawn', 'noon_off', 'noon_guard', 'noon_all'], imgs = {}, left = names.length, failed = false;
    if (!el || names.some(function (n) { return !P[n]; })) { cb(false); return; }
    names.forEach(function (n) {
      var im = new Image();
      im.onload = function () { if (--left === 0 && !failed) done(); };
      im.onerror = function () { if (!failed) { failed = true; cb(false); } };
      im.decoding = 'async'; im.src = P[n]; im.alt = ''; im.className = 'snap snap-' + n;
      imgs[n] = im;
    });
    function done() {
      var host = window.Street || (window.Street = {});
      var saved = {}; KEYS.forEach(function (k) { if (typeof host[k] === 'function') saved[k] = host[k]; });
      var wrap = document.createElement('div'); wrap.className = 'snapwrap';
      names.forEach(function (n) { wrap.appendChild(imgs[n]); });
      Array.prototype.forEach.call(el.children, function (c) { c.style.display = 'none'; });
      el.appendChild(wrap);
      var S = { sun: 0.08, to: 0.08, mode: 0, show: false, active: false };
      function paint(ms) {
        var t = (ms == null ? 300 : ms) + 'ms';
        names.forEach(function (n) { imgs[n].style.transitionDuration = t; });
        var noon = clamp((S.to - 0.15) / 0.7, 0, 1);
        imgs.dawn.style.opacity = '1';
        imgs.noon_off.style.opacity = String(noon);
        imgs.noon_guard.style.opacity = S.show && S.mode === 1 ? String(noon) : '0';
        imgs.noon_all.style.opacity = S.show && S.mode >= 2 ? String(noon) : '0';
      }
      function setMode(m) { S.mode = clamp(Math.round(+m || 0), 0, 2); paint(700); return S.mode; }
      function volts() {
        var f = Math.pow(clamp(S.to, 0, 1), 1.25), longV = 236 + 16 * f, shortV = 236 + 4 * f;
        var g = S.show ? S.mode : 0;
        return [g >= 1 ? Math.min(longV, 240) : longV, g >= 1 ? Math.min(longV, 240) : longV, shortV, g >= 2 ? Math.min(longV, 240) : longV];
      }
      var api = {
        init: function () {},
        setSun: function (v, ms) { S.to = S.sun = clamp(+v || 0, 0, 1); paint(ms == null ? 120 : Math.min(+ms || 0, 8000)); },
        sweepSun: function (v, ms) { api.setSun(v, ms == null ? 6000 : ms); },
        getSun: function () { return S.to; },
        setActive: function (on) { S.active = !!on; },
        setBoxes: function (show) { S.show = !!show; paint(250); },
        setGuard: function (on) { return setMode(on ? Math.max(1, S.mode) : 0); },
        setGuardAll: function (on) { return setMode(on ? 2 : Math.min(S.mode, 1)); },
        setGuardRight: function (on) { return setMode(on ? 2 : Math.min(S.mode, 1)); },
        setLines: function (n) { return setMode(n); },
        lines: function () { return S.mode; },
        addBox: function () { return setMode(S.mode + 1); },
        setBoxCount: function (k) { return setMode(k >= 6 ? 2 : (k >= 1 ? 1 : 0)); },
        boxes: function () { return S.mode; },
        pulse: function () {},
        volts: volts,
        cutPercent: function () { return 0; },
        boxedHouses: function () { return []; },
        state: function () { return { sun: S.to, target: S.to, mode: S.mode, renderer: 'png' }; }
      };
      KEYS.forEach(function (k) { if (api[k]) host[k] = api[k]; });
      host.isSnap = true;
      host._restore2D = function () {
        KEYS.forEach(function (k) { if (saved[k]) host[k] = saved[k]; else delete host[k]; });
        delete host.isSnap; wrap.remove();
        Array.prototype.forEach.call(el.children, function (c) { if (c.matches && c.matches('svg.street-svg')) c.style.display = ''; });
      };
      paint(0);
      cb(true);
    }
  }
  window.StreetSnap = { tryInstall: tryInstall };
})();
