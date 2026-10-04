/* Grino #27 · phone recorder (rec.html?k=<key>). Ported from vector-146 front-y12/src/lib/video
   (capture.ts: pickMime, rotating MediaRecorder per segment, canvas scaling; cameras.ts: rear camera;
   queue.ts: IndexedDB queue; engine.ts / transport.ts: upload pump with retries and backoff).
   Every ~4 s a NEW MediaRecorder starts before the previous one stops, so each segment is an independent file:
   POST <relay>/rec/<session>/<seq>?k=<key>&ext=mp4|webm  (body = the file, no Content-Type -> no CORS preflight).
   Stop: the last segment is flushed, the queue drains, then POST <relay>/rec/<session>/build?k=<key>. */
(function () {
  'use strict';
  var cfg = window.GRINO || {};
  var $ = function (id) { return document.getElementById(id); };
  var KEY = cfg.KEY || '';
  var API = (cfg.RELAY_URL || '').replace(/\/+$/, '') + '/rec';
  var SEGMENT_MS = 4000, MAX_LONG = 1920, FPS = 30;
  var REC = { on: false, session: '', seq: 0, recorded: 0, uploaded: 0, failed: 0, mime: '', ext: '', mode: '', w: 0, h: 0 };
  window.REC = REC;

  function msg(t, cls) { var m = $('msg'); m.textContent = t || ''; m.className = cls || ''; }
  function hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  if (!KEY) {
    document.body.innerHTML = '<div class="nokey">Open the link from the team chat.<br><span style="font-size:15px;color:rgba(244,241,232,.6)">This page needs its link key (?k=…).</span></div>';
    return;
  }

  /* ---------- format: MP4 / H.264 first (iOS Safari; recent Chrome / Edge), WebM fallback ---------- */
  var MIMES = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
               'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (var i = 0; i < MIMES.length; i++) { try { if (MediaRecorder.isTypeSupported(MIMES[i])) return MIMES[i]; } catch (e) {} }
    return '';   /* let the browser choose (older Safari) */
  }

  /* ---------- IndexedDB queue (survives a reload / network loss); memory if IndexedDB is unavailable ---------- */
  var dbP = null, memQ = new Map();
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res) {
      try {
        if (typeof indexedDB === 'undefined') return res(null);
        var r = indexedDB.open('grino27-rec', 1);
        r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('parts')) r.result.createObjectStore('parts', { keyPath: 'id' }); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbP;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      if (!d) return null;
      return new Promise(function (res) {
        try { var t = d.transaction('parts', mode), q = fn(t.objectStore('parts')); q.onsuccess = function () { res(q.result); }; q.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    });
  }
  function qPut(p) { memQ.set(p.id, p); return idb('readwrite', function (s) { return s.put(p); }); }
  function qDel(id) { memQ.delete(id); return idb('readwrite', function (s) { return s.delete(id); }); }
  function qAll() {
    return idb('readonly', function (s) { return s.getAll(); }).then(function (items) {
      var by = new Map(); (items || []).forEach(function (x) { by.set(x.id, x); }); memQ.forEach(function (x) { by.set(x.id, x); });
      return Array.from(by.values()).sort(function (a, b) { return a.createdAt - b.createdAt || a.seq - b.seq; });
    });
  }

  /* ---------- upload pump: one at a time, exponential backoff, never gives up while the page is open ---------- */
  var pumping = false, queued = 0;
  function countQueue() { return qAll().then(function (a) { queued = a.length; render(); return a; }); }
  function upload(p) {
    var url = API + '/' + encodeURIComponent(p.session) + '/' + p.seq + '?k=' + encodeURIComponent(KEY) + '&ext=' + p.ext;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null, to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 60000);
    return fetch(url, { method: 'POST', body: new Blob([p.blob]), cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(to); return r.status; }, function () { clearTimeout(to); return 0; });
  }
  function pump() {
    if (pumping) return; pumping = true;
    (function loop() {
      countQueue().then(function (all) {
        var now = Date.now(), next = all.filter(function (p) { return (p.nextTryAt || 0) <= now; })[0];
        if (!next) { pumping = false; if (all.length) setTimeout(pump, 1000); return; }
        upload(next).then(function (st) {
          if (st >= 200 && st < 300 || st === 409) { REC.uploaded++; return qDel(next.id).then(loop); }
          if (st === 400 || st === 401 || st === 403 || st === 413) { msg('Upload refused (HTTP ' + st + ') — check the link key', 'bad'); REC.failed++; }
          next.attempts = (next.attempts || 0) + 1;
          next.nextTryAt = Date.now() + Math.min(15000, 800 * Math.pow(2, Math.min(5, next.attempts - 1)));
          return qPut(next).then(function () { setTimeout(loop, 300); });
        });
      });
    })();
  }
  window.addEventListener('online', pump);

  /* ---------- camera: rear (environment) by default, ideal 1920x1080 ---------- */
  var stream = null, vTrack = null, aTrack = null, output = null, canvas = null, drawT = 0, srcVideo = null;
  function openCamera() {
    var v = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    return navigator.mediaDevices.getUserMedia({ video: v, audio: { echoCancellation: true, noiseSuppression: true } })
      .catch(function (e) { if (e && e.name === 'NotAllowedError') throw e; return navigator.mediaDevices.getUserMedia({ video: v, audio: false }); })
      .then(function (s) {
        stream = s; vTrack = s.getVideoTracks()[0] || null; aTrack = s.getAudioTracks()[0] || null;
        var pv = $('preview'); pv.srcObject = new MediaStream(vTrack ? [vTrack] : []); try { pv.play(); } catch (e) {}
        var st = {}; try { st = vTrack.getSettings(); } catch (e) {}
        REC.w = st.width || 0; REC.h = st.height || 0;
        $('badge').textContent = 'camera ' + (REC.w ? REC.w + '×' + REC.h : 'on') + (aTrack ? ' · mic' : ' · no mic');
        $('go').disabled = false;
      });
  }
  /* canvas only when the camera gives more than FullHD: scale the long side down to 1920 */
  function buildOutput() {
    var w = REC.w, h = REC.h;
    var canCanvas = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    if (Math.max(w, h) > MAX_LONG && canCanvas) {
      var k = MAX_LONG / Math.max(w, h);
      canvas = document.createElement('canvas'); canvas.width = Math.round(w * k / 2) * 2; canvas.height = Math.round(h * k / 2) * 2;
      var ctx = canvas.getContext('2d', { alpha: false });
      srcVideo = document.createElement('video'); srcVideo.muted = true; srcVideo.playsInline = true; srcVideo.setAttribute('playsinline', '');
      srcVideo.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'; srcVideo.srcObject = new MediaStream([vTrack]);
      document.body.appendChild(srcVideo); try { srcVideo.play(); } catch (e) {}
      drawT = setInterval(function () {
        if (srcVideo.readyState < 2) return;
        var sw = srcVideo.videoWidth || canvas.width, sh = srcVideo.videoHeight || canvas.height, s = Math.min(canvas.width / sw, canvas.height / sh);
        if (sw * s < canvas.width || sh * s < canvas.height) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(srcVideo, (canvas.width - sw * s) / 2, (canvas.height - sh * s) / 2, sw * s, sh * s);
      }, Math.round(1000 / FPS));
      var ct = canvas.captureStream(FPS).getVideoTracks()[0];
      REC.mode = 'canvas ' + canvas.width + '×' + canvas.height;
      return new MediaStream(aTrack ? [ct, aTrack] : [ct]);
    }
    REC.mode = 'direct ' + (w ? w + '×' + h : '');
    return new MediaStream(aTrack ? [vTrack, aTrack] : [vTrack]);
  }

  /* ---------- rotating recorders: the next one starts before the current one stops ---------- */
  var cur = null, rotT = 0, pendingStops = 0;
  function newRecorder() {
    var opts = { videoBitsPerSecond: 6000000, audioBitsPerSecond: 96000 }; if (REC.mime) opts.mimeType = REC.mime;
    var r = new MediaRecorder(output, opts), run = { r: r, chunks: [], seq: REC.seq++, session: REC.session, t0: performance.now(), startedAt: Date.now() };
    r.ondataavailable = function (e) { if (e.data && e.data.size) run.chunks.push(e.data); };
    r.onstop = function () { pendingStops--; finish(run); };
    r.onerror = function () { msg('Recorder error — continuing with the next segment', 'bad'); };
    r.start(); pendingStops++; saveSess();
    return run;
  }
  function finish(run) {
    if (!run.chunks.length) return;
    var type = run.chunks[0].type || REC.mime || '';
    var ext = /mp4/i.test(type || REC.mime) ? 'mp4' : 'webm';
    var blob = new Blob(run.chunks, { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' });
    if (blob.size < 1024) return;
    REC.recorded++; REC.ext = ext;
    var p = { id: run.session + ':' + run.seq, session: run.session, seq: run.seq, ext: ext, blob: blob, durationMs: Math.round(performance.now() - run.t0), createdAt: Date.now(), attempts: 0, nextTryAt: 0 };
    qPut(p).then(function () { render(); pump(); });
  }
  function rotate() {
    if (!REC.on) return;
    var prev = cur;
    try { cur = newRecorder(); }
    catch (e) {   /* Safari: a second recorder on the same stream may fail -> stop, then start */
      if (prev && prev.r.state !== 'inactive') { prev.r.addEventListener('stop', function () { if (REC.on) cur = newRecorder(); }); prev.r.stop(); }
      return;
    }
    if (prev && prev.r.state !== 'inactive') { try { prev.r.stop(); } catch (e) {} }
  }

  var wake = null;
  function wakeLock() { try { if ('wakeLock' in navigator && !wake) navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {}); } catch (e) {} }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && REC.on) wakeLock(); });

  /* the current session survives Record / Stop / a reload; only "New recording" starts a new one (the deck shows the newest) */
  var SK = 'grino27_rec_session';
  function loadSess() { try { var s = JSON.parse(localStorage.getItem(SK) || 'null'); if (s && /^[a-f0-9]{16}$/.test(s.session)) return s; } catch (e) {} return null; }
  function saveSess() { try { localStorage.setItem(SK, JSON.stringify({ session: REC.session, next: REC.seq })); } catch (e) {} }
  var saved = loadSess(); if (saved) { REC.session = saved.session; REC.seq = saved.next || 0; }
  function start(fresh) {
    if (!vTrack) return;
    REC.mime = pickMime();
    if (REC.mime === null) { msg('This browser cannot record video (no MediaRecorder)', 'bad'); return; }
    if (fresh || !REC.session) { REC.session = hex(8); REC.seq = 0; REC.recorded = 0; REC.uploaded = 0; REC.server = 0; }
    REC.on = true; saveSess(); render();
    output = buildOutput();
    try { cur = newRecorder(); } catch (e) { REC.on = false; msg('Recorder did not start: ' + (e && e.message || e), 'bad'); return; }
    rotT = setInterval(rotate, SEGMENT_MS);
    wakeLock();
    $('go').textContent = '■ Stop'; $('go').classList.add('stop'); $('go').disabled = false;
    $('badge').textContent = 'REC · ' + (REC.mime || 'auto') .replace(/;.*/, '') + ' · ' + REC.mode; $('badge').classList.add('rec');
    msg('Recording · session ' + REC.session.slice(0, 6) + '…', 'ok');
  }
  function stop() {
    REC.on = false; clearInterval(rotT);
    var last = cur; cur = null;
    $('go').disabled = true; $('go').textContent = 'Finishing…'; $('badge').classList.remove('rec');
    try { if (last && last.r.state !== 'inactive') last.r.stop(); } catch (e) {}
    var session = REC.session, t0 = Date.now();
    /* wait for the last segment, then for the queue of this session to drain, then build */
    (function waitDrain() {
      qAll().then(function (all) {
        var mine = all.filter(function (p) { return p.session === session; }).length;
        if ((pendingStops > 0 || mine > 0) && Date.now() - t0 < 120000) { msg('Uploading the last segments… ' + mine + ' left'); pump(); setTimeout(waitDrain, 400); return; }
        msg('Building the replay on the server…');
        fetch(API + '/' + encodeURIComponent(session) + '/build?k=' + encodeURIComponent(KEY), { method: 'POST', cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
          .then(function (j) { REC.built = j; msg('Uploaded: ' + REC.recorded + ' segments · ' + (j && typeof j.fast === 'string' && j.fast ? 'replay ×10 ready' : 'the deck builds the replay on s10b'), 'ok'); })
          .catch(function (e) { msg('Build failed (' + (e && e.message || e) + ') — the deck can build it again', 'bad'); })
          .then(function () { if (canvas) { clearInterval(drawT); canvas = null; } if (srcVideo) { srcVideo.remove(); srcVideo = null; } $('go').disabled = false; $('go').textContent = '● Record'; $('go').classList.remove('stop'); render(); });
      });
    })();
  }
  $('go').onclick = function () { if (REC.on) stop(); else start(false); };
  $('newRec').onclick = function () {
    if (!window.confirm('Start a NEW recording?\n\nThe deck will show the new one (the previous recording stays on the server).')) return;
    if (REC.on) { REC.on = false; clearInterval(rotT); var last = cur; cur = null; try { if (last && last.r.state !== 'inactive') last.r.stop(); } catch (e) {} }
    start(true); msg('New recording · session ' + REC.session.slice(0, 6) + '…', 'ok');
  };
  /* segments the server has for the current session */
  setInterval(function () {
    if (!REC.session || !(REC.uploaded > 0 || REC.server > 0)) return;   /* nothing uploaded yet -> the server has no list (404) */
    fetch(API + '/' + REC.session + '/list?k=' + encodeURIComponent(KEY), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (x) { if (x && x.segments) { REC.server = x.segments.length; render(); } }).catch(function () {});
  }, 4000);

  function render() {
    $('nRec').textContent = REC.recorded; $('nUp').textContent = REC.uploaded; $('nQ').textContent = queued;
    $('sess').innerHTML = REC.session ? 'session <b>' + REC.session.slice(0, 6) + '…</b> · on the server: <b>' + (REC.server != null ? REC.server : '…') + '</b> segments' + (REC.on ? ' · recording' : '') : 'session: — (Record starts one)';
  }
  setInterval(render, 500);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg('No camera access here (needs https)', 'bad'); return; }
  openCamera().catch(function (e) { msg('Camera: ' + (e && e.name || e) + ' — allow camera access and reload', 'bad'); });
  pump();   /* segments left from an earlier run go up first */
})();
