// Small interactive SVG charts for the research page. No libraries; the page reads fine without JS
// (every chart has a data table in <noscript>/<details> next to it).
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmt(v) { return (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('en-US'); }
  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) if (m <= steps[i] + 1e-9) return steps[i] * p;
    return 10 * p;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function tooltip(host) {
    var t = document.createElement('div');
    t.className = 'chart-tip';
    t.hidden = true;
    host.appendChild(t);
    return {
      show: function (html, x, y) {
        t.innerHTML = html; t.hidden = false;
        var r = host.getBoundingClientRect();
        t.style.left = Math.min(Math.max(x - r.left + 12, 4), r.width - t.offsetWidth - 4) + 'px';
        t.style.top = Math.max(y - r.top - t.offsetHeight - 10, 4) + 'px';
      },
      hide: function () { t.hidden = true; }
    };
  }

  // Vertical bars. series: [{label, value, note}], opts: {unit, max, color, refLine:{value,label}}
  function bars(host, series, opts) {
    host.querySelectorAll('svg, .chart-tip').forEach(function (n) { n.remove(); });
    var W = 640, H = 300, L = 66, R = 12, T = 18, B = 46;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.aria || '' }, host);
    var tip = tooltip(host);
    var max = niceMax(opts.max || Math.max.apply(null, series.map(function (s) { return s.value; })) * 1.08);
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var v = max * i / ticks, yy = y(v);
      el('line', { x1: L, x2: W - R, y1: yy, y2: yy, stroke: css('--rule'), 'stroke-width': 1 }, svg);
      var tx = el('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end', 'class': 'ax' }, svg);
      tx.textContent = fmt(v) + (opts.unit === '%' ? '%' : '');
    }
    var bw = (W - L - R) / series.length;
    series.forEach(function (s, k) {
      var x = L + k * bw + bw * 0.18, w = bw * 0.64;
      var r = el('rect', { x: x, y: y(s.value), width: w, height: Math.max(0, y(0) - y(s.value)), rx: 3,
        fill: s.color || opts.color || css('--accent-ink'), 'class': 'bar' }, svg);
      var lab = el('text', { x: x + w / 2, y: H - B + 18, 'text-anchor': 'middle', 'class': 'ax' }, svg);
      lab.textContent = s.label;
      var val = el('text', { x: x + w / 2, y: y(s.value) - 6, 'text-anchor': 'middle', 'class': 'val' }, svg);
      val.textContent = fmt(s.value) + (opts.unit === '%' ? '%' : '');
      function on(ev) { tip.show('<b>' + s.label + '</b><br>' + fmt(s.value) + ' ' + (opts.unitLong || opts.unit || '') + (s.note ? '<br><span>' + s.note + '</span>' : ''), ev.clientX, ev.clientY); }
      r.addEventListener('mousemove', on); r.addEventListener('mouseleave', tip.hide);
      r.addEventListener('click', on);
    });
    if (opts.refLine) {
      var ry = y(opts.refLine.value);
      el('line', { x1: L, x2: W - R, y1: ry, y2: ry, stroke: css('--bad'), 'stroke-width': 2, 'stroke-dasharray': '6 5' }, svg);
      var rt = el('text', { x: W - R, y: ry - 6, 'text-anchor': 'end', 'class': 'ref' }, svg);
      rt.textContent = opts.refLine.label;
    }
  }

  // Horizontal stacked bars. rows: [{label, parts:[...]}], keys: [{name,color}]
  function stacked(host, rows, keys, opts) {
    host.querySelectorAll('svg, .chart-tip').forEach(function (n) { n.remove(); });
    var W = 640, rowH = 26, T = 34, L = 110, R = 52;
    var H = T + rows.length * rowH + 10;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.aria || '' }, host);
    var tip = tooltip(host);
    var max = Math.max.apply(null, rows.map(function (r) { return r.parts.reduce(function (a, b) { return a + b; }, 0); }));
    var sx = function (v) { return (W - L - R) * v / max; };
    keys.forEach(function (k, i) {
      var lx = L + i * 150;
      el('rect', { x: lx, y: 8, width: 14, height: 14, rx: 2, fill: k.color }, svg);
      var t = el('text', { x: lx + 20, y: 20, 'class': 'ax' }, svg); t.textContent = k.name;
    });
    rows.forEach(function (r, i) {
      var yy = T + i * rowH;
      var t = el('text', { x: L - 8, y: yy + 16, 'text-anchor': 'end', 'class': 'ax' }, svg); t.textContent = r.label;
      var x = L, total = 0;
      r.parts.forEach(function (v, j) {
        total += v;
        var rect = el('rect', { x: x, y: yy + 3, width: Math.max(0, sx(v)), height: rowH - 8, fill: keys[j].color, 'class': 'bar' }, svg);
        (function (v, j) {
          function on(ev) { tip.show('<b>' + r.label + '</b><br>' + keys[j].name + ': ' + fmt(v) + ' feeders', ev.clientX, ev.clientY); }
          rect.addEventListener('mousemove', on); rect.addEventListener('mouseleave', tip.hide); rect.addEventListener('click', on);
        })(v, j);
        x += sx(v);
      });
      var tt = el('text', { x: x + 6, y: yy + 16, 'class': 'val' }, svg); tt.textContent = fmt(total);
    });
  }

  function init() {
    // 1. Growth of net-metered rooftop solar
    var g = document.getElementById('chart-growth');
    if (g) {
      var data = { count: [['2018', 784], ['2020', 4144], ['2023', 17112], ['2024', 31249], ['2025', 50059], ['Sep 2026', 58700]],
                   mw: [['2018', 9], ['2020', 77], ['2023', 268], ['2024', 420], ['2025', 640.1], ['Sep 2026', 750]] };
      var draw = function (k) {
        bars(g.querySelector('.plot'), data[k].map(function (d) { return { label: d[0], value: d[1], note: d[0] === 'Sep 2026' ? 'ENA statement, approximate' : 'PSRC annual report' }; }),
          { unit: k === 'mw' ? 'MW' : 'plants', unitLong: k === 'mw' ? 'MW' : 'plants', aria: 'Autonomous solar producers in Armenia' });
      };
      g.querySelectorAll('button[data-k]').forEach(function (b) {
        b.addEventListener('click', function () { g.querySelectorAll('button[data-k]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); draw(b.dataset.k); });
      });
      draw('count');
    }
    // 2. Feeders above +10% by time block, per month
    var f = document.getElementById('chart-blocks');
    if (f) {
      var m = { 'Dec 2025': [1770, 1791, 1730, 2988], 'Apr 2026': [3809, 4956, 4834, 3114], 'May 2026': [4629, 5156, 4507, 3691], 'Jun 2026': [3348, 5594, 4353, 3549] };
      var blocks = ['01–08 h', '09–13 h', '14–18 h', '19–24 h'];
      var drawF = function (k) {
        bars(f.querySelector('.plot'), m[k].map(function (v, i) { return { label: blocks[i], value: v, color: i === 1 ? css('--warn-rule') : css('--accent-ink') }; }),
          { unit: 'feeders', unitLong: 'feeders above +10% (> 242 V)', max: 6000, aria: 'Feeders above 242 V by time of day' });
      };
      f.querySelectorAll('button[data-k]').forEach(function (b) {
        b.addEventListener('click', function () { f.querySelectorAll('button[data-k]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); drawF(b.dataset.k); });
      });
      drawF('Jun 2026');
    }
    // 3. Feeder types by marz
    var s = document.getElementById('chart-types');
    if (s) {
      var rows = [['Yerevan', 1528, 1002, 161], ['Kotayk', 207, 75, 55], ['Shirak', 350, 32, 8], ['Armavir', 232, 0, 151], ['Syunik', 12, 113, 21],
        ['Ararat', 110, 67, 171], ['Gegharkunik', 7, 251, 11], ['Lori', 64, 7, 29], ['Tavush', 26, 90, 64], ['Vayots Dzor', 35, 90, 2], ['Aragatsotn', 43, 43, 70]];
      stacked(s.querySelector('.plot'), rows.map(function (r) { return { label: r[0], parts: [r[1], r[2], r[3]] }; }),
        [{ name: 'solar-type', color: css('--warn-rule') }, { name: 'tap-type', color: css('--tag-model') }, { name: 'overload-type', color: css('--tag-data') }],
        { aria: 'Problem feeders by type and marz' });
    }
    // 4. Hosting capacity (model)
    var h = document.getElementById('chart-hosting');
    if (h) {
      var hc = { 'Mountain village': [32, 59, 45, 87], 'Ararat-valley village': [68, 95, 106, 157], 'Urban block': [96, 225, 222, 600] };
      var vars = ['as is', 'tap −5%', 'volt-var', 'tap + volt-var'];
      var drawH = function (k) {
        bars(h.querySelector('.plot'), hc[k].map(function (v, i) { return { label: vars[i], value: v, note: (k === 'Ararat-valley village' && i % 2 === 1) ? 'not admissible: evening voltage already below 198 V' : (k === 'Urban block' && i === 3 ? 'search bound: at least 600' : 'model') }; }),
          { unit: 'kWp', unitLong: 'kWp of rooftop solar before anyone exceeds 242 V', aria: 'Hosting capacity by measure' });
      };
      h.querySelectorAll('button[data-k]').forEach(function (b) {
        b.addEventListener('click', function () { h.querySelectorAll('button[data-k]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); drawH(b.dataset.k); });
      });
      drawH('Mountain village');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
