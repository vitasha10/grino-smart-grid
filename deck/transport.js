/* Pluggable sync transport for the deck <-> phone remote.
 *
 * Two channels with the same JSON message format (topic names lowercase):
 *   <TOPIC>-cmd : remote -> deck  {"sid":"ab12","seq":7,"type":"goto|next|prev|sun|sweep|guard|pulse|qr|black|calc|ping","value":...}
 *   <TOPIC>-ack : deck -> remote  {"kind":"ack"|"state","sid":"ab12","seq":7,"screen":4,"sun":0.8,"guard":true,...}
 *
 * One relay only (GRINO.RELAY_URL, ntfy wire format, see RELAY_CONTRACT.md): WebSocket -> SSE -> long-poll.
 * The topic comes ONLY from ?k= (config.js); without it nothing connects (deck: local keyboard / clicker; remote: "open the link").
 *   GrinoTransport.connect(opts)    -> remote: one path at a time, next stage after 2 failures in a row.
 *   GrinoTransport.connectAll(opts) -> deck: the relay with its own ws -> sse -> poll chain.
 *   GrinoTransport.signal(opts)     -> relay channel <TOPIC>-sig for the optional WebRTC handshake (p2p.js).
 *   state: 'connecting' | 'open' | 'error' | 'ratelimited' | 'offline'
 */
(function () {
  'use strict';
  var cfg = window.GRINO;
  var P = new URLSearchParams(location.search);
  function nowS() { return Date.now() / 1000; }
  /* the relay is used only with a topic from ?k= (no public fallbacks) */
  function relayOn() { return !!cfg.RELAY_URL && !!cfg.TOPIC; }

  /* ---------- SSE backend (the relay speaks the ntfy wire format) ---------- */
  function SseBackend(kind, base, opts) {
    base = base.replace(/\/+$/, '');
    var subUrl = base + '/' + encodeURIComponent((cfg.TOPIC + '-' + opts.listen).toLowerCase()) + '/sse';
    var pubUrl = base + '/' + encodeURIComponent((cfg.TOPIC + '-' + opts.publish).toLowerCase());
    var es = null, lastId = null, closed = false, retry = 0, retryTimer = null, watchdog = null;
    var serverSkew = 0, openedThis = false, failsInRow = 0, postFails = 0;

    function status(s, info) { try { opts.onStatus && opts.onStatus(s, info || '', kind); } catch (e) { console.error(e); } }
    function fail(why) {
      failsInRow++;
      try { opts.onFail && opts.onFail(failsInRow, why, kind); } catch (e) {}
    }
    function armWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(function () { reconnect(); }, 75000); /* keepalive every 25–45 s */
    }
    function handle(raw) {
      var ev;
      try { ev = JSON.parse(raw); } catch (e) { return; }
      if (ev.event === 'open') {
        if (ev.time) serverSkew = ev.time - nowS();
        markOpen(); return;
      }
      if (ev.event === 'keepalive') return;
      if (ev.event && ev.event !== 'message') return;
      if (ev.id) lastId = ev.id;
      var msg;
      try { msg = JSON.parse(ev.message); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      var age = ev.time ? (nowS() + serverSkew - ev.time) : 0;
      try { opts.onMessage(msg, { id: ev.id, time: ev.time, age: age, via: kind }); } catch (e) { console.error(e); }
    }
    function markOpen() {
      if (!openedThis) { openedThis = true; retry = 0; failsInRow = 0; }
      status('open', base);
    }
    function open() {
      if (closed) return;
      if (typeof EventSource === 'undefined') { status('offline', 'no EventSource'); return; }
      openedThis = false;
      status('connecting', kind);
      var url = subUrl + (lastId ? ('?since=' + encodeURIComponent(lastId)) : '');
      try { es = new EventSource(url); } catch (e) { fail('construct'); scheduleRetry(); return; }
      armWatchdog();
      var onAny = function (e) { armWatchdog(); if (e && e.data) handle(e.data); };
      es.onopen = function () { armWatchdog(); markOpen(); };
      es.onmessage = onAny;
      es.addEventListener('open', function (e) { if (e && e.data) onAny(e); });
      es.addEventListener('keepalive', onAny);
      es.onerror = function () {
        if (!openedThis) fail('connect');
        openedThis = false;
        if (!es || es.readyState === 2) scheduleRetry(); /* browser gave up (HTTP error, e.g. 429) */
        else status('connecting', 'reconnecting');
        /* EventSource reconnects by itself but WITHOUT ?since=; reconnect ourselves to resume after lastId */
        if (es && es.readyState === 0 && lastId) { try { es.close(); } catch (x) {} es = null; scheduleRetry(); }
      };
    }
    function scheduleRetry() {
      if (closed) return;
      if (es) { try { es.close(); } catch (e) {} es = null; }
      clearTimeout(retryTimer);
      retry = Math.min(retry + 1, 6);
      var delay = [0, 800, 1500, 3000, 6000, 10000, 15000][retry];
      status(navigator.onLine === false ? 'offline' : 'error', 'retry in ' + (delay / 1000).toFixed(1) + ' s');
      retryTimer = setTimeout(open, delay);
    }
    function reconnect() { if (closed) return; if (es) { try { es.close(); } catch (e) {} es = null; } retry = 0; clearTimeout(retryTimer); open(); }
    function onOnline() { reconnect(); }
    window.addEventListener('online', onOnline);
    open();
    return {
      kind: kind,
      describe: function () { return kind + ' ' + base.replace(/^https?:\/\//, ''); },
      send: function (obj) {
        var body = JSON.stringify(obj);
        /* text/plain body -> "simple" CORS request, no preflight */
        return fetch(pubUrl, { method: 'POST', body: body, cache: 'no-store', keepalive: body.length < 4000 })
          .then(function (r) {
            if (r.status === 429) status('ratelimited', kind + ' rate limit (429)');
            if (r.ok) postFails = 0; else if (r.status >= 500 || r.status === 404) { postFails++; if (postFails >= 2) fail('post ' + r.status); }
            return { ok: r.ok, status: r.status, via: kind };
          })
          .catch(function (e) { postFails++; if (postFails >= 2) fail('post'); return { ok: false, status: 0, error: String(e), via: kind }; });
      },
      reconnect: reconnect,
      close: function () { closed = true; clearTimeout(retryTimer); clearTimeout(watchdog); window.removeEventListener('online', onOnline); if (es) es.close(); }
    };
  }

  /* ---------- relay long-poll backend (optional, ?relaymode=poll) ---------- */
  function PollBackend(kind, base, opts) {
    base = base.replace(/\/+$/, '');
    var topic = (cfg.TOPIC + '-' + opts.listen).toLowerCase();
    var pubUrl = base + '/' + encodeURIComponent((cfg.TOPIC + '-' + opts.publish).toLowerCase());
    var closed = false, lastId = null, sinceTime = null, ctrl = null, timer = null, fails = 0, serverSkew = 0, wasOpen = false;
    var seen = Object.create(null), seenList = [];
    function status(s, i) { try { opts.onStatus && opts.onStatus(s, i || '', kind); } catch (e) {} }
    function deliver(ev) {
      if (!ev || (ev.event && ev.event !== 'message')) return;
      if (ev.id) { if (seen[ev.id]) return; seen[ev.id] = 1; seenList.push(ev.id); if (seenList.length > 400) delete seen[seenList.shift()]; lastId = ev.id; }
      if (ev.time) serverSkew = ev.time - nowS();
      var msg; try { msg = JSON.parse(ev.message); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      opts.onMessage(msg, { id: ev.id, time: ev.time, age: ev.time ? (nowS() + serverSkew - ev.time) : 0, via: kind });
    }
    function poll() {
      if (closed) return;
      var q = 'poll=1&wait=20';
      if (lastId) q += '&since=' + encodeURIComponent(lastId); else if (sinceTime) q += '&since=' + Math.floor(sinceTime);
      var started = nowS() + serverSkew - 1;
      ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var killer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 32000);
      if (!wasOpen) status('connecting', kind + ' poll');
      fetch(base + '/' + encodeURIComponent(topic) + '/json?' + q, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (txt) {
          clearTimeout(killer); fails = 0; wasOpen = true; status('open', kind + ' (poll)');
          if (!lastId) sinceTime = started;
          txt.split('\n').forEach(function (l) { l = l.trim(); if (l) { try { deliver(JSON.parse(l)); } catch (e) {} } });
          timer = setTimeout(poll, 0);
        })
        .catch(function (e) {
          clearTimeout(killer); if (closed) return;
          fails++; wasOpen = false; try { opts.onFail && opts.onFail(fails, 'poll', kind); } catch (x) {}
          status(navigator.onLine === false ? 'offline' : 'error', kind + ': ' + (e && e.message || e));
          timer = setTimeout(poll, fails < 3 ? 1000 : 3000);
        });
    }
    poll();
    return {
      kind: kind,
      describe: function () { return 'relay (poll) ' + base.replace(/^https?:\/\//, ''); },
      send: function (obj) {
        return fetch(pubUrl, { method: 'POST', body: JSON.stringify(obj), cache: 'no-store', keepalive: true })
          .then(function (r) { return { ok: r.ok, status: r.status, via: kind }; })
          .catch(function (e) { return { ok: false, status: 0, error: String(e), via: kind }; });
      },
      reconnect: function () { if (ctrl) ctrl.abort(); clearTimeout(timer); timer = setTimeout(poll, 50); },
      close: function () { closed = true; clearTimeout(timer); if (ctrl) ctrl.abort(); }
    };
  }

  /* ---------- WebSocket backend (new relay, primary): wss://<relay>/<topic>/ws, ntfy-format events, no self-echo ---------- */
  function WsBackend(kind, base, opts) {
    base = base.replace(/\/+$/, '');
    var wsBase = base.replace(/^http/, 'ws');
    var subTopic = (cfg.TOPIC + '-' + opts.listen).toLowerCase(), pubTopic = (cfg.TOPIC + '-' + opts.publish).toLowerCase();
    var pubUrl = base + '/' + encodeURIComponent(pubTopic);
    var ws = null, pws = null, closed = false, retry = 0, retryT = 0, failsInRow = 0, opened = false, serverSkew = 0, pingT = 0, lastMsgAt = 0;
    function status(s, i) { try { opts.onStatus && opts.onStatus(s, i || '', kind); } catch (e) {} }
    function fail(why) { failsInRow++; try { opts.onFail && opts.onFail(failsInRow, why, kind); } catch (e) {} }
    function handle(raw) {
      var ev; try { ev = JSON.parse(raw); } catch (e) { return; }
      lastMsgAt = Date.now();
      if (ev.event === 'open') { if (ev.time) serverSkew = ev.time - nowS(); return; }
      if (ev.event && ev.event !== 'message') return;
      var msg; try { msg = JSON.parse(ev.message); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      var age = ev.time ? (nowS() + serverSkew - ev.time) : 0;
      try { opts.onMessage(msg, { id: ev.id, time: ev.time, age: age, via: kind }); } catch (e) { console.error(e); }
    }
    function open() {
      if (closed) return;
      if (typeof WebSocket === 'undefined') { fail('no WebSocket'); return; }
      status('connecting', kind + ' ws');
      opened = false;
      var sock;
      try { sock = new WebSocket(wsBase + '/' + encodeURIComponent(subTopic) + '/ws'); } catch (e) { fail('ws construct'); retryLater(); return; }
      ws = sock;
      var openT = setTimeout(function () { if (!opened && ws === sock) { try { sock.close(); } catch (e) {} } }, 5000);
      sock.onopen = function () {
        clearTimeout(openT); opened = true; retry = 0; failsInRow = 0; lastMsgAt = Date.now();
        status('open', kind + ' · ' + base.replace(/^https?:\/\//, '') + ' (ws)');
        openPub();
      };
      sock.onmessage = function (e) { handle(e.data); };
      sock.onclose = function () {
        clearTimeout(openT);
        if (ws !== sock) return;
        ws = null;
        if (!opened) fail('ws connect');
        if (!closed) { status('connecting', 'reconnecting'); retryLater(); }
      };
      sock.onerror = function () {};
    }
    /* a second socket on the publish topic: sends without an HTTP round trip (incoming messages there are ignored) */
    function openPub() {
      if (closed || pubTopic === subTopic) return;
      if (pws && (pws.readyState === 0 || pws.readyState === 1)) return;
      try { pws = new WebSocket(wsBase + '/' + encodeURIComponent(pubTopic) + '/ws'); } catch (e) { pws = null; return; }
      var me = pws;
      me.onclose = function () { if (pws === me) pws = null; if (!closed) setTimeout(openPub, 1500); };
      me.onerror = function () {};
    }
    function retryLater() {
      clearTimeout(retryT);
      retry = Math.min(retry + 1, 5);
      retryT = setTimeout(open, [0, 600, 1500, 3000, 6000, 10000][retry]);
    }
    /* liveness: the relay sends keepalives; nothing for 70 s = reconnect */
    pingT = setInterval(function () { if (ws && opened && Date.now() - lastMsgAt > 70000) { try { ws.close(); } catch (e) {} } }, 10000);
    open();
    return {
      kind: kind,
      describe: function () { return kind + ' ' + base.replace(/^https?:\/\//, '') + ' (ws)'; },
      send: function (obj) {
        var body = JSON.stringify(obj);
        var sock = pubTopic === subTopic ? ws : pws;
        if (sock && sock.readyState === 1) { try { sock.send(body); return Promise.resolve({ ok: true, status: 200, via: kind }); } catch (e) {} }
        return fetch(pubUrl, { method: 'POST', body: body, cache: 'no-store', keepalive: body.length < 4000 })
          .then(function (r) { return { ok: r.ok, status: r.status, via: kind }; })
          .catch(function (e) { return { ok: false, status: 0, error: String(e), via: kind }; });
      },
      reconnect: function () { if (ws) { try { ws.close(); } catch (e) {} } else { retry = 0; open(); } },
      close: function () { closed = true; clearTimeout(retryT); clearInterval(pingT); try { ws && ws.close(); } catch (e) {} try { pws && pws.close(); } catch (e) {} }
    };
  }

  /* relay stages: WebSocket -> SSE -> long-poll (the same relay) */
  function relayStages() {
    var m = P.get('relaymode'), s = [];
    if (!m || m === 'ws') s.push(function (o) { return WsBackend('relay', cfg.RELAY_URL, o); });
    if (!m || m === 'ws' || m === 'sse') s.push(function (o) { return SseBackend('relay', cfg.RELAY_URL, o); });
    s.push(function (o) { return PollBackend('relay', cfg.RELAY_URL, o); });
    return s;
  }
  function offline(opts) {   /* no ?k= : nothing connects */
    setTimeout(function () { try { opts.onStatus && opts.onStatus('offline', 'no link key', 'relay', {}); } catch (e) {} }, 0);
    var no = function () { return Promise.resolve({ ok: false, status: 0, via: 'none' }); };
    return { kind: function () { return 'none'; }, kinds: function () { return []; }, states: function () { return {}; }, fellBack: function () { return false; }, stage: function () { return 0; },
      describe: function () { return 'offline (no link key)'; }, send: no, sendHttp: no, reconnect: function () {}, close: function () {} };
  }

  /* ---------- remote: one path at a time, falls down the stages after 2 failures in a row ---------- */
  function connect(opts) {
    if (!relayOn()) return offline(opts);
    var stages = relayStages(), idx = 0, cur = null, fellBack = false;
    var api = {
      kind: function () { return cur ? cur.kind : 'none'; },
      fellBack: function () { return fellBack; },
      stage: function () { return idx; },
      describe: function () { return cur ? cur.describe() + (fellBack ? ' (fallback)' : '') : '—'; },
      send: function (obj) { return cur.send(obj); },
      sendHttp: function (obj) { return cur.send(obj); },
      reconnect: function () { if (cur) cur.reconnect(); },
      close: function () { if (cur) cur.close(); }
    };
    function startStage() {
      var o = {}; for (var k in opts) o[k] = opts[k];
      var mine = idx;
      o.onFail = function (n, why) { if (n >= 2 && mine === idx && idx < stages.length - 1) setTimeout(function () { next(why); }, 0); };
      cur = stages[idx](o);
    }
    function next(why) {
      try { cur.close(); } catch (e) {}
      idx++; fellBack = true;
      console.warn('transport stage failed (' + why + '), now: stage ' + idx);
      startStage();
      try { opts.onFallback && opts.onFallback(why); } catch (e) {}
    }
    startStage();
    return api;
  }

  /* ---------- deck: listen on every path at once (new relay with its own ws->sse->poll chain, old relay, ntfy);
     answers go to every path a remote may be on ---------- */
  function connectAll(opts) {
    var backs = {}, st = {};
    function onStatus(s, info, kind) { st[kind] = { s: s, info: info }; try { opts.onStatus && opts.onStatus(s, info, kind, st); } catch (e) {} }
    if (!relayOn()) return offline(opts);
    var o = {}; for (var k in opts) o[k] = opts[k]; o.onStatus = onStatus;
    {
      var rs = [], m = P.get('relaymode');
      if (!m || m === 'ws') rs.push(function (x) { return WsBackend('relay', cfg.RELAY_URL, x); });
      if (!m || m === 'ws' || m === 'sse') rs.push(function (x) { return SseBackend('relay', cfg.RELAY_URL, x); });
      rs.push(function (x) { return PollBackend('relay', cfg.RELAY_URL, x); });
      var ri = 0, startR = function () {
        var x = {}; for (var kk in o) x[kk] = o[kk];
        var mine = ri;
        x.onFail = function (n) { if (n >= 2 && mine === ri && ri < rs.length - 1) setTimeout(function () { try { backs.relay.close(); } catch (e) {} ri++; startR(); }, 0); };
        backs.relay = rs[ri](x);
      };
      startR();
    }
    return {
      kinds: function () { return Object.keys(backs); },
      states: function () { return st; },
      describe: function () { return Object.keys(backs).map(function (k) { return backs[k].describe() + ' [' + (st[k] ? st[k].s : '…') + ']'; }).join(' + '); },
      send: function (obj, via) { return backs.relay.send(obj); },
      reconnect: function () { for (var k in backs) backs[k].reconnect(); },
      close: function () { for (var k in backs) backs[k].close(); }
    };
  }

  /* ---------- WebRTC signalling (p2p.js): new relay only, channel <TOPIC>-sig; null if the relay is off ---------- */
  function signal(opts) {
    if (!relayOn()) return null;
    var o = {}; for (var k in opts) o[k] = opts[k];
    o.listen = 'sig'; o.publish = 'sig';
    var m = P.get('relaymode');
    return m === 'poll' ? PollBackend('relay', cfg.RELAY_URL, o) : m === 'sse' ? SseBackend('relay', cfg.RELAY_URL, o) : WsBackend('relay', cfg.RELAY_URL, o);
  }

  window.GrinoTransport = {
    connect: connect,
    connectAll: connectAll,
    signal: signal,
    relayEnabled: relayOn,
    sunHz: function () { return cfg.SUN_HZ_RELAY || 30; },
    ackIntervalMs: function (kind) { return kind === 'p2p' ? (cfg.ACK_MIN_INTERVAL_P2P_MS || 30) : cfg.ACK_MIN_INTERVAL_RELAY_MS; }
  };
})();
