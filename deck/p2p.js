/* p2p.js — WebRTC DataChannel link between the phone remote and the deck (lowest latency path).
 *
 * Signalling: the existing relay, channel <TOPIC>-sig (same POST + SSE as cmd/ack), messages
 *   {sig:'offer'|'answer'|'ice', from:'remote'|'deck', pid, did?, sdp?, cand?, t}
 * The remote is the offerer; every deck tab that sees the offer answers, the remote keeps the first answer.
 * ICE: STUN only (GRINO.ICE_SERVERS, Google stun..stun3), no TURN — on one Wi-Fi the host candidates connect directly.
 * Channels: 'fast' (ordered:false, maxRetransmits:0) for sun / orbit samples, 'ctl' (ordered, reliable) for discrete
 *   commands, acks and a 1 Hz ping (live RTT). Message format = the cmd/ack JSON of transport.js (sid/seq/ack unchanged).
 * Fallback: if the channels are not open within P2P_TIMEOUT_MS (4 s) or drop later, the remote goes back to the relay
 *   at once and re-negotiates with back-off (1, 3, 8, 15, 30 s). ?p2p=off disables P2P on that page.
 *
 *   GrinoP2P.enabled()
 *   GrinoP2P.remote({onMessage(msg, meta), onStatus(state, info)}) -> {isOpen, sendFast, sendCtl, rtt, rtts, state, restart, close}
 *     state: 'off' | 'connecting' | 'open' | 'fallback'
 *   GrinoP2P.deck({onMessage(msg, meta), onStatus(openCount)})     -> {send(obj) -> n peers, count, close}
 */
(function () {
  'use strict';
  var cfg = window.GRINO || {};
  var P = new URLSearchParams(location.search);
  function ice() { return cfg.ICE_SERVERS || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]; }
  function rid() { return Math.random().toString(36).slice(2, 10); }
  /* OFF by default since v7 (Firefox: "ICE failed, add a TURN server"; the WebSocket relay is fast and syncs every device).
     On only with ?p2p=on (or GRINO.P2P === true and no ?p2p=off). */
  function enabled() {
    var want = P.get('p2p') === 'on' || (cfg.P2P === true && P.get('p2p') !== 'off');
    return want && typeof RTCPeerConnection !== 'undefined' &&
      !!(window.GrinoTransport && GrinoTransport.relayEnabled && GrinoTransport.relayEnabled());
  }
  function candJSON(c) { try { return c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }; } catch (e) { return null; } }
  function median(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor(s.length / 2)]; }

  /* ======================= remote (offerer) ======================= */
  function Remote(opts) {
    var sigOpen = false, pc = null, fast = null, ctl = null, pid = null, did = null, st = 'off', info = '';
    var openTimer = 0, retryT = 0, retryN = 0, pingT = 0, rtts = [], pendingIce = [], closed = false, lastPong = 0;
    var sig = GrinoTransport.signal({
      onMessage: onSig,
      onStatus: function (s) { sigOpen = s === 'open'; if (sigOpen && !pc && !retryT && !closed) start(); }
    });
    if (!sig) return null;
    function status(s, i) { st = s; info = i || ''; try { opts.onStatus && opts.onStatus(s, info); } catch (e) {} }
    function sigSend(m) { m.t = Date.now(); return sig.send(m); }
    function cleanup() {
      clearTimeout(openTimer); clearInterval(pingT);
      var old = pc; pc = null; fast = ctl = null; pendingIce = [];
      if (old) { try { old.onconnectionstatechange = null; old.close(); } catch (e) {} }
    }
    function start() {
      cleanup(); clearTimeout(retryT); retryT = 0;
      pid = rid(); did = null;
      var mine;
      try {
        pc = new RTCPeerConnection({ iceServers: ice() }); mine = pc;
        fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
        ctl = pc.createDataChannel('ctl', { ordered: true });
      } catch (e) { pc = null; status('fallback', 'WebRTC unavailable'); return; }
      [fast, ctl].forEach(function (ch) {
        ch.onopen = checkOpen;
        ch.onclose = function () { if (pc === mine) drop('channel closed'); };
        ch.onmessage = onData;
      });
      pc.onicecandidate = function (e) { if (e.candidate && pc === mine) { var c = candJSON(e.candidate); if (c) sigSend({ sig: 'ice', from: 'remote', pid: pid, cand: c }); } };
      pc.onconnectionstatechange = function () {
        if (pc !== mine) return;
        var cs = pc.connectionState;
        if (cs === 'failed' || cs === 'closed') drop('ice ' + cs);
        else if (cs === 'disconnected') setTimeout(function () { if (pc === mine && pc.connectionState === 'disconnected') drop('ice disconnected'); }, 1500);
      };
      status('connecting', 'offer');
      pc.createOffer().then(function (o) { return mine.setLocalDescription(o); }).then(function () {
        if (pc === mine) sigSend({ sig: 'offer', from: 'remote', pid: pid, sdp: mine.localDescription.sdp });
      }).catch(function (e) { if (pc === mine) drop('offer: ' + (e && e.message)); });
      openTimer = setTimeout(function () { if (pc === mine && st !== 'open') drop('timeout'); }, cfg.P2P_TIMEOUT_MS || 4000);
    }
    function onSig(m) {
      if (!m || m.from !== 'deck') return;
      /* a deck (re)appeared: negotiate now instead of waiting for the back-off; a new deck id while open = it was reloaded */
      if (m.sig === 'hello' && !closed) {
        if (st !== 'open' || (did && m.did !== did)) { retryN = 0; clearTimeout(retryT); retryT = 0; if (sigOpen) start(); }
        return;
      }
      if (!pc || m.pid !== pid) return;
      if (m.sig === 'answer') {
        if (did) return;                         /* another deck tab answered first */
        did = m.did;
        var mine = pc;
        mine.setRemoteDescription({ type: 'answer', sdp: m.sdp }).then(function () {
          pendingIce.filter(function (x) { return x.did === did; }).forEach(function (x) { mine.addIceCandidate(x.cand).catch(function () {}); });
          pendingIce = [];
        }).catch(function (e) { if (pc === mine) drop('answer: ' + (e && e.message)); });
      } else if (m.sig === 'ice' && m.cand) {
        if (did && m.did !== did) return;
        if (pc.remoteDescription) pc.addIceCandidate(m.cand).catch(function () {});
        else pendingIce.push({ did: m.did, cand: m.cand });
      }
    }
    function checkOpen() {
      if (fast && ctl && fast.readyState === 'open' && ctl.readyState === 'open' && st !== 'open') {
        clearTimeout(openTimer); retryN = 0; status('open', 'p2p'); startPing();
      }
    }
    function drop(why) {
      if (!pc && st !== 'connecting') return;
      cleanup();
      status('fallback', why);
      retryN++;
      var d = [1000, 3000, 8000, 15000, 30000][Math.min(retryN - 1, 4)];
      clearTimeout(retryT);
      retryT = setTimeout(function () { retryT = 0; if (sigOpen && !closed) start(); }, d);
    }
    function onData(e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m && m.p2pPong != null) { lastPong = performance.now(); rtts.push(lastPong - m.p2pPong); if (rtts.length > 20) rtts.shift(); return; }
      if (m && m.p2pBye) { drop('deck closed'); return; }
      try { opts.onMessage(m, { via: 'p2p', age: 0 }); } catch (x) { console.error(x); }
    }
    /* 2 Hz ping = live RTT + liveness: no pong for P2P_DEAD_MS (a reloaded / sleeping deck does not always close the
       connection) -> back to the relay at once and re-negotiate */
    function startPing() {
      clearInterval(pingT); lastPong = performance.now();
      var ping = function () {
        if (performance.now() - lastPong > (cfg.P2P_DEAD_MS || 2500)) { drop('no answer from deck'); return; }
        if (ctl && ctl.readyState === 'open') { try { ctl.send(JSON.stringify({ p2pPing: performance.now() })); } catch (e) {} }
      };
      ping(); pingT = setInterval(ping, 500);
    }
    function isOpen() { return st === 'open' && !!ctl && ctl.readyState === 'open'; }
    return {
      isOpen: isOpen,
      sendFast: function (obj) {
        var ch = fast && fast.readyState === 'open' ? fast : null;
        if (!ch || !isOpen()) return false;
        if (ch.bufferedAmount > 16384) return true;   /* congested: drop this sample, the next one carries the latest value */
        try { ch.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
      },
      sendCtl: function (obj) { if (!isOpen()) return false; try { ctl.send(JSON.stringify(obj)); return true; } catch (e) { return false; } },
      rtt: function () { return median(rtts); },
      rtts: function () { return rtts.slice(); },
      state: function () { return st; },
      info: function () { return info; },
      restart: function () { retryN = 0; cleanup(); start(); },
      close: function () { closed = true; cleanup(); clearTimeout(retryT); sig.close(); status('off', 'closed'); }
    };
  }

  /* ======================= deck (answerer) ======================= */
  function Deck(opts) {
    var did = rid(), peers = {}, orphanIce = {}, helloSent = false;
    var sig = GrinoTransport.signal({ onMessage: onSig, onStatus: function (s) {
      if (s === 'open' && !helloSent) { helloSent = true; setTimeout(function () { sigSend({ sig: 'hello', from: 'deck', did: did }); }, 50); }
    } });
    if (!sig) return null;
    function sigSend(m) { m.t = Date.now(); return sig.send(m); }
    function report() { try { opts.onStatus && opts.onStatus(count()); } catch (e) {} }
    function count() { var n = 0; for (var k in peers) if (peers[k].ctl && peers[k].ctl.readyState === 'open') n++; return n; }
    function closePeer(pid) {
      var p = peers[pid]; if (!p) return;
      delete peers[pid];
      try { p.pc.close(); } catch (e) {}
      report();
    }
    function onSig(m, meta) {
      if (!m || m.from !== 'remote' || !m.pid) return;
      if (m.sig === 'offer') {
        if (meta && meta.age > 20) return;                      /* replayed after a reconnect: stale */
        if (peers[m.pid]) return;
        var pc;
        try { pc = new RTCPeerConnection({ iceServers: ice() }); } catch (e) { return; }
        var p = { pc: pc, fast: null, ctl: null, t: Date.now() };
        peers[m.pid] = p;
        var keys = Object.keys(peers);                           /* keep at most 4 peers (newest) */
        if (keys.length > 4) keys.sort(function (a, b) { return peers[a].t - peers[b].t; }).slice(0, keys.length - 4).forEach(closePeer);
        pc.ondatachannel = function (e) {
          var ch = e.channel;
          p[ch.label] = ch;
          ch.onopen = report;
          ch.onclose = function () { if (ch.label === 'ctl') closePeer(m.pid); };
          ch.onmessage = function (ev) { onData(p, ev, m.pid); };
        };
        pc.onicecandidate = function (e) { if (e.candidate) { var c = candJSON(e.candidate); if (c) sigSend({ sig: 'ice', from: 'deck', did: did, pid: m.pid, cand: c }); } };
        pc.onconnectionstatechange = function () { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(m.pid); };
        pc.setRemoteDescription({ type: 'offer', sdp: m.sdp }).then(function () {
          (orphanIce[m.pid] || []).forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
          delete orphanIce[m.pid];
          return pc.createAnswer();
        }).then(function (a) { return pc.setLocalDescription(a); }).then(function () {
          sigSend({ sig: 'answer', from: 'deck', did: did, pid: m.pid, sdp: pc.localDescription.sdp });
        }).catch(function () { closePeer(m.pid); });
      } else if (m.sig === 'ice' && m.cand) {
        var q = peers[m.pid];
        if (q && q.pc.remoteDescription) q.pc.addIceCandidate(m.cand).catch(function () {});
        else { (orphanIce[m.pid] = orphanIce[m.pid] || []).push(m.cand); setTimeout(function () { delete orphanIce[m.pid]; }, 15000); }
      }
    }
    function onData(p, ev, pid) {
      var m; try { m = JSON.parse(ev.data); } catch (x) { return; }
      if (m && m.p2pPing != null) { try { p.ctl.send(JSON.stringify({ p2pPong: m.p2pPing })); } catch (e) {} return; }
      try { opts.onMessage(m, { via: 'p2p', age: 0, pid: pid }); } catch (x) { console.error(x); }
    }
    /* leaving / reloading the page: tell the remotes at once (they go back to the relay without waiting for ICE) */
    window.addEventListener('pagehide', function () {
      for (var k in peers) { var c = peers[k].ctl; if (c && c.readyState === 'open') { try { c.send('{"p2pBye":1}'); } catch (e) {} } try { peers[k].pc.close(); } catch (e) {} }
    });
    return {
      send: function (obj) {
        var s = JSON.stringify(obj), n = 0;
        for (var k in peers) { var c = peers[k].ctl; if (c && c.readyState === 'open') { try { c.send(s); n++; } catch (e) {} } }
        return n;
      },
      count: count,
      did: did,
      close: function () { for (var k in peers) closePeer(k); sig.close(); }
    };
  }

  window.GrinoP2P = {
    enabled: enabled,
    remote: function (opts) { try { return enabled() ? Remote(opts) : null; } catch (e) { console.info('[p2p] off:', e && e.message); return null; } },
    deck: function (opts) { try { return enabled() ? Deck(opts) : null; } catch (e) { console.info('[p2p] off:', e && e.message); return null; } }
  };
})();
