"""Finger -> screen latency over the relay (WebSocket): deck and remote in two separate headless Edge instances (same clock).
Needs the deck served on 127.0.0.1:8027 (cd site/deck && python -m http.server 8027 --bind 127.0.0.1).
Usage: python tools/latency.py [--dbg]   (extra deck URL params as the first argument, e.g. "&street=png")
Touches the remote's sun strip: 16 taps, 6 flicks dawn<->noon, 3 slow drags; prints p50/p90."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser
import secrets
TOPIC = 'lat' + secrets.token_hex(6)   # throwaway test key
Q = sys.argv[1] if len(sys.argv) > 1 else ''
DBG = '--dbg' in sys.argv
if Q == '--dbg': Q = ''
d = Browser(port=9671); r = Browser(port=9672)
def both(t):
    end = time.time() + t
    while time.time() < end: d.pump(0.01); r.pump(0.01)
def wait(fn, t=20):
    end = time.time() + t
    while time.time() < end:
        try:
            if fn(): return True
        except Exception: pass
        both(0.1)
    return False
def touch(kind, x=0, y=0):
    r.call('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})
def pct(a, p):
    a = sorted(a); return a[min(len(a) - 1, int(round(p / 100.0 * (len(a) - 1))))] if a else None
try:
    d.viewport(1280, 720); d.goto('http://127.0.0.1:8027/index.html?k=' + TOPIC + Q + '#s1', 3)
    r.viewport(390, 844, scale=2, mobile=True); r.goto('http://127.0.0.1:8027/remote.html?k=' + TOPIC, 1)
    print('linked:', wait(lambda: 'ok' in r.js("document.getElementById('conn').className"), 30), '|', r.js('REMOTE.transport.describe()'))
    r.js("document.querySelectorAll('#list button')[1].click()"); wait(lambda: d.js('DECK.state.i') == 1, 10); both(2.5)
    print('deck renderer:', d.js('DECK.renderer'), '| caps.sun242 on remote:', r.js('REMOTE.R.caps && REMOTE.R.caps.sun242'))
    d.js("window.TR=[];(function f(){TR.push([Date.now(),DECK.sunX()]);if(TR.length>40000)TR.shift();requestAnimationFrame(f)})()")
    rc = json.loads(r.js("JSON.stringify((function(){var b=document.getElementById('sunStrip').getBoundingClientRect();return [b.left,b.top,b.width,b.height]})())"))
    L, T, W, H = rc; X = L + W * 0.7
    def y_of(v): return T + 42 + (1 - (v + 0.12) / 1.12) * (H - 84)
    marks = []
    RECV = {}
    def drain():
        for seq, at, via in json.loads(d.js("JSON.stringify(DECK.log.filter(function(x){return x.in && x.in.type==='sun' && String(x.in.sid).indexOf('deck-')!==0}).map(function(x){return [x.in.seq,x.at,x.via]}))")): RECV[seq] = (at, via)
    # 1) taps (absolute jumps)
    taps = [0.2, 0.8, 0.1, 0.9, 0.35, 0.65, 0.05, 0.95, 0.25, 0.75, 0.15, 0.85, 0.3, 0.7, 0.2, 0.9]
    for v in taps:
        t0 = int(time.time() * 1000)
        touch('touchStart', X, y_of(v)); both(0.06); touch('touchEnd'); both(1.7)
        marks.append(('tap', t0, v)); drain()
    # 2) fast flicks (dawn -> noon in ~0.25 s, then noon -> dawn)
    for k in range(6):
        a, b = (0.0, 1.0) if k % 2 == 0 else (1.0, 0.0)
        t0 = int(time.time() * 1000)
        touch('touchStart', X, y_of(a)); r.pump(0.016)
        for i in range(1, 16): touch('touchMove', X, y_of(a + (b - a) * i / 15)); r.pump(0.016)
        both(1.2); touch('touchEnd'); both(0.8)
        marks.append(('flick', t0, b)); drain()
    # 3) slow precise drags (0.1 -> 0.6 in ~2.5 s)
    for k in range(3):
        a, b = (0.1, 0.6) if k % 2 == 0 else (0.6, 0.1)
        t0 = int(time.time() * 1000)
        touch('touchStart', X, y_of(a)); both(0.05)
        for i in range(1, 101): touch('touchMove', X, y_of(a + (b - a) * i / 100)); r.pump(0.025)
        both(1.0); touch('touchEnd'); both(0.8)
        marks.append(('slow', t0, b)); drain()
    TR = d.js('JSON.stringify(TR)'); TR = json.loads(TR)
    SL = json.loads(r.js('JSON.stringify(REMOTE.sunLog)'))
    SENT = json.loads(r.js('JSON.stringify(REMOTE.sentAt)'))
    drain(); INS = [[q, a, v] for q, (a, v) in RECV.items()]
    # fps on the deck
    dts = [TR[i + 1][0] - TR[i][0] for i in range(len(TR) - 1)]
    print('deck frames: %d, frame interval p50 %d ms, p90 %d ms' % (len(TR), pct(dts, 50), pct(dts, 90)))
    # transport: send -> deck receive
    net = [at - SENT[str(seq)] for seq, at, via in INS if str(seq) in SENT]
    vias = sorted(set(v for _, _, v in INS))
    print('transport (remote send -> deck receive), %d sun msgs via %s: p50 %d ms, p90 %d ms, max %d ms' % (len(net), vias, pct(net, 50), pct(net, 90), max(net)))
    print('   relay stalls > 300 ms: %d of %d' % (sum(1 for x in net if x > 300), len(net)))
    # sample rate during flicks/slow drags
    def deck_at(t):  # last frame at or before t
        lo = None
        for fr in TR:
            if fr[0] <= t: lo = fr
            else: break
        return lo
    res = {'tap_first': [], 'tap_arrive': [], 'flick_arrive': [], 'track_flick': [], 'track_slow': []}
    for idx, (kind, t0, v) in enumerate(marks):
        t_end = marks[idx + 1][1] if idx + 1 < len(marks) else TR[-1][0]
        seg = [s for s in SL if t0 <= s[0] < t_end]
        if not seg: continue
        tf = seg[0][0]
        fr0 = deck_at(tf); x0 = fr0[1] if fr0 else None
        frames = [f for f in TR if f[0] >= tf and f[0] < t_end]
        if kind == 'tap':
            tgt = seg[0][1]; dirn = 1 if tgt > x0 else -1
            first = next((f[0] for f in frames if (f[1] - x0) * dirn > 0.01), None)
            arr = next((f[0] for f in frames if abs(f[1] - tgt) <= 0.02), None)
            if first: res['tap_first'].append(first - tf)
            sends = sorted((int(k), t) for k, t in SENT.items() if tf - 5 <= t < t_end)
            recv = {seq: at for seq, at, via in INS}
            if DBG: print('  tap v=%.2f x0=%.3f | send +%s | recv +%s | move +%s | arrive +%s' % (tgt, x0, [t - tf for _, t in sends][:3], [recv.get(q, 0) - tf for q, _ in sends][:3], (first - tf) if first else None, (arr - tf) if arr else None))
            if arr: res['tap_arrive'].append(arr - tf)
        else:
            dirn = 1 if seg[-1][1] > seg[0][1] else -1
            key = 'track_flick' if kind == 'flick' else 'track_slow'
            # each finger sample (after the first): when does the deck's displayed sun reach it?
            for s in seg[1:]:
                hit = next((f[0] for f in frames if f[0] >= s[0] and (f[1] - s[1]) * dirn >= -0.002), None)
                if hit is not None: res[key].append(hit - s[0])
            if kind == 'flick':
                tgt = seg[-1][1]; arr = next((f[0] for f in frames if abs(f[1] - tgt) <= 0.02), None)
                if arr: res['flick_arrive'].append(arr - tf)
    names = {'tap_first': 'tap -> deck sun starts moving', 'tap_arrive': 'tap -> deck sun within 0.02 of the target (incl. 1.2/s easing)',
             'flick_arrive': 'flick dawn<->noon (0.25 s) -> deck sun within 0.02 of the end', 'track_flick': 'finger -> screen while flicking (each finger sample)',
             'track_slow': 'finger -> screen during a slow drag (each finger sample)'}
    for k in ('tap_first', 'track_slow', 'track_flick', 'tap_arrive', 'flick_arrive'):
        a = res[k]
        if a: print('%-75s n=%3d  p50 %4d ms  p90 %4d ms' % (names[k], len(a), pct(a, 50), pct(a, 90)))
    # remote -> deck end state agrees
    print('final: remote sun', r.js('REMOTE.R.sun'), '| deck target', round(d.js('DECK.state.sun'), 3), '| deck shown', round(d.js('DECK.sunX()'), 3))
    for name, b in (('deck', d), ('remote', r)):
        e = [x for x in b.errors() if 'favicon' not in x]
        print(name, 'console:', e or 'clean')
finally:
    d.close(); r.close()
