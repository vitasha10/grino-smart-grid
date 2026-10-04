# -*- coding: utf-8 -*-
"""Screenshots of every deck screen (1920x1080 and 1366x768) and of the phone remote (390x844) into ../screens/.
Uses headless Edge/Chrome over CDP (tools/cdp.py). Runs on the TEST topic, sends no commands.
    python tools/shoot.py            # all (file:// -> 2D street)
    python tools/shoot.py deck       # deck only
    set DECK_BASE=http://127.0.0.1:8027 & python tools/shoot.py deck3d   # 3D street (needs http, see README)
"""
import os, secrets, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Browser

DECK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(DECK, "screens")
URL = os.environ.get("DECK_BASE") or ("file:///" + DECK.replace("\\", "/"))
Q = "?"   # no link key: the deck runs locally, no relay needed for pictures


def deck(sizes=((1920, 1080), (1366, 768)), tag="deck", only=None):
    """every screen (by id) at each size; overwrites only its own files (never deletes anything in screens/)"""
    b = Browser(port=9341)
    errs = []
    try:
        for w, h in sizes:
            b.viewport(w, h)
            b.goto(URL + "/index.html" + Q + "#s1", 2.5)
            if URL.startswith("http"):
                for _ in range(40):
                    if b.js("DECK.renderer && DECK.renderer !== '2d'"): break
                    b.pump(0.5)
            print("renderer:", b.js("DECK.renderer"))
            ids = b.js("Array.prototype.map.call(document.querySelectorAll('.slide'), function (s) { return s.dataset.id; })")
            for i, sid in enumerate(ids):
                if only and sid not in only: continue
                b.js(f"DECK.go({i})")
                b.pump(13 if sid == "s3" else (4.5 if sid == "s7" else 2.8))
                if sid == "s2":
                    b.shot(os.path.join(OUT, f"{tag}_{w}x{h}_s02_dawn.png"))
                    b.js("DECK.setSun(1, 900)"); b.pump(2.2)
                if sid == "s5":
                    b.js("DECK.setLines(1)"); b.pump(1.6)
                    b.shot(os.path.join(OUT, f"{tag}_{w}x{h}_s05_guard_where_needed.png"))
                    b.js("DECK.setLines(2)"); b.pump(1.6)
                name = sid if len(sid) > 2 else "s0" + sid[1:]
                if sid == "s5": name = "s05_guard_everywhere"
                b.shot(os.path.join(OUT, f"{tag}_{w}x{h}_{name}.png"))
            if (w, h) == (1920, 1080) and not only:
                b.js("DECK.go(%d)" % (len(ids) - 1)); b.pump(1)
                b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'q'}))"); b.pump(1.2)
                b.shot(os.path.join(OUT, "deck_1920x1080_qr_overlay.png"))
                b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'q'}))")
                b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'?'}))"); b.pump(1.0)
                b.shot(os.path.join(OUT, "deck_1920x1080_help.png"))
                b.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'?'}))")
        errs = [e for e in b.errors() if "parts3d" not in e and "ERR_FILE_NOT_FOUND" not in e and "favicon" not in e]
    finally:
        b.close()
    return errs


def remote():
    """remote + a live deck on the test topic over the relay, so the indicator shows a real ack"""
    q = "?k=shoot" + secrets.token_hex(6)   # throwaway test key (the real key is never in files)
    d = Browser(port=9343)
    b = Browser(port=9342)
    errs = []
    try:
        d.viewport(1366, 768)
        d.goto(URL + "/index.html" + q + "#s1", 3)
        b.viewport(390, 844, scale=2, mobile=True)
        b.goto(URL + "/remote.html" + q, 1)
        for _ in range(40):
            d.pump(0.25); b.pump(0.25)
            if "ok" in (b.js("document.getElementById('conn').className") or ""):
                break
        for i, name in [(0, "s01"), (1, "s02_sun"), (4, "s05_guard"), (7, "s07_calc")]:
            b.js(f"document.querySelectorAll('#list button')[{i}].click()")
            for _ in range(16):
                d.pump(0.25); b.pump(0.25)
            b.shot(os.path.join(OUT, f"remote_390x844_{name}.png"))
        errs = b.errors() + d.errors()
    finally:
        b.close(); d.close()
    return errs


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("all", "deck"):
        print("deck console:", deck() or "clean")
    if what == "deck3d":
        print("deck 3D console:", deck(tag="deck3d", only=("s2", "s5")) or "clean")
    if what in ("all", "remote"):
        print("remote console:", remote() or "clean")
    print("saved to", OUT)
