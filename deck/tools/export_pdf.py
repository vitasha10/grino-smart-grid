"""Offline package: every screen in its FINAL state (all steps shown) -> export/Grino27_deck.pdf, 1920x1080 pages.
Needs the deck served locally:  cd site/deck && python -m http.server 8027 --bind 127.0.0.1
Usage: python tools/export_pdf.py   (frames also saved to export/frames/)"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser
from PIL import Image

DECK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXP = os.path.join(DECK, "export"); FR = os.path.join(EXP, "frames")
BASE = os.environ.get("DECK_BASE", "http://127.0.0.1:8027")
os.makedirs(FR, exist_ok=True)
b = Browser(port=9741)
seq = [0]
def cmd(t, v):
    seq[0] += 1
    b.js("DECK.onCommand({sid:'export',seq:%d,type:'%s',value:%s},{via:'relay'})" % (seq[0], t, json.dumps(v)))
try:
    b.viewport(1920, 1080)
    b.goto(BASE + "/index.html#s1", 3)
    for _ in range(60):                      # 3D street + 3D parts ready (falls back to PNG/2D by itself)
        if b.js("!!(window.Street && Street.is3D) && !!(window.Parts3D && Parts3D.state && Parts3D.state().ready)"): break
        b.pump(0.5)
    print("renderer:", b.js("DECK.renderer"), "| parts3d:", b.js("!!(window.Parts3D && Parts3D.state && Parts3D.state().ready)"))
    ids = b.js("Array.prototype.map.call(document.querySelectorAll('.slide'), function(s){return s.dataset.id})")
    frames = []
    for i, sid in enumerate(ids):
        b.js("DECK.go(%d)" % i); b.pump(1.2)
        if sid in ("s2", "s5"): cmd("sun", {"v": 1, "ms": 0}); b.pump(1.8)
        if sid == "s5": cmd("lines", 3); b.pump(3.0)
        n = b.js("DECK.snapshot().step.n") or 0
        if n: cmd("step", {"to": n}); b.pump(2.6 if sid not in ("s8",) else 3.0)
        b.pump(2.2)
        f = os.path.join(FR, "%02d_%s.png" % (i + 1, sid)); b.shot(f); frames.append(f)
        print("%2d %-4s steps %s -> %s" % (i + 1, sid, n, os.path.basename(f)))
    ext = b.js("JSON.stringify(performance.getEntriesByType('resource').map(function(e){return e.name}).filter(function(u){return !/^(http:\\/\\/127\\.0\\.0\\.1|data:|blob:)/.test(u)}))")
    print("non-local requests:", ext)
    print("console:", [e for e in b.errors() if "favicon" not in e] or "clean")
finally:
    b.close()
imgs = [Image.open(f).convert("RGB") for f in frames]
imgs = [im if im.size == (1920, 1080) else im.resize((1920, 1080)) for im in imgs]
out = os.path.join(EXP, "Grino27_deck.pdf")
imgs[0].save(out, save_all=True, append_images=imgs[1:], resolution=72.0)   # 72 dpi -> 1920 x 1080 pt pages
print("saved", out, len(imgs), "pages")
