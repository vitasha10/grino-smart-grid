# -*- coding: utf-8 -*-
"""Builds the JS data files the deck loads with <script> (works on file:// where fetch() is blocked).

Inputs (read-only):
  ../SPEECH_beta_EN.md                -> SPEECH (per-screen operator prompt + target times)
  assets/armenia_marz.geojson         -> MARZ_SHAPES (pre-projected SVG paths)
  assets/feeder_types_by_marz.json    -> MARZ_COUNTS
  assets/calculator.html              -> assets/calculator-embed.js (srcdoc copy, same-origin -> remote can drive it)
Outputs:
  assets/deck-data.js, assets/calculator-embed.js

Run again whenever the speech, the data or calculator.html change:
  python tools/build_data.py
"""
import json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DECK = os.path.dirname(HERE)
SITE = os.path.dirname(DECK)
A = os.path.join(DECK, "assets")


def screen_ids():
    """screen order from config.js (single source of truth)"""
    cfg = open(os.path.join(DECK, "config.js"), encoding="utf-8").read()
    block = cfg[cfg.index("SCREENS:"):]
    return re.findall(r"\{\s*id:\s*'(s\d+b?)'", block)


def parse_speech():
    path = os.path.join(SITE, "SPEECH_beta_EN.md")
    txt = open(path, encoding="utf-8").read()
    blocks = re.split(r"\n(?=\*\*\[S\d+)", txt)
    found = {}
    for b in blocks:
        m = re.match(r"\*\*\[S(\d+b?)\s*·\s*(.+?)\s*—\s*(\d+):(\d+)\]\*\*\s*(.*)", b, re.S)
        if not m:
            continue
        n, title, mm, ss, rest = m.groups()
        rest = rest.strip()
        direction = ""
        d = re.match(r"\*\((.+?)\)\*\s*(.*)", rest, re.S)
        if d:
            direction, rest = d.group(1).strip(), d.group(2).strip()
        text = re.sub(r"\s+", " ", rest).strip()
        found["s" + n.lower()] = {"title": title.strip(), "t": int(mm) * 60 + int(ss), "direction": direction, "text": text}
    ids = screen_ids()
    if "s6b" in ids and "s6b" not in found and "s6" in found:
        # split the S6 block in two at "For each one" (or the middle sentence); s6b starts halfway to S7
        s6 = found["s6"]
        sents = re.split(r"(?<=[.!?])\s+", s6["text"])
        cut = next((i for i, x in enumerate(sents) if x.startswith("For each")), max(1, len(sents) // 2))
        t7 = found.get("s7", {"t": s6["t"] + 20})["t"]
        found["s6b"] = {"title": "Cheapest fix", "t": (s6["t"] + t7) // 2, "direction": "", "text": " ".join(sents[cut:])}
        s6["text"] = " ".join(sents[:cut])
    out = []
    for i, sid in enumerate(ids):
        assert sid in found, f"no speech block for {sid}"
        x = dict(found[sid]); x["id"] = sid; x["n"] = i + 1
        out.append(x)
    return out


def project_marz():
    g = json.load(open(os.path.join(A, "armenia_marz.geojson"), encoding="utf-8"))
    lat0 = 40.1
    k = math.cos(math.radians(lat0))
    pts = []
    for f in g["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            for ring in poly:
                pts.extend(ring)
    xs = [p[0] * k for p in pts]
    ys = [-p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    W = 1000.0
    s = W / (maxx - minx)
    H = (maxy - miny) * s

    def P(p):
        return ((p[0] * k - minx) * s, (-p[1] - miny) * s)

    shapes = []
    for f in g["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        d = []
        best_area, best_c = -1, (0, 0)
        for poly in polys:
            for ri, ring in enumerate(poly):
                q = [P(p) for p in ring]
                # drop near-duplicate points (< 0.6 px) to keep the file small
                r2 = [q[0]]
                for x, y in q[1:]:
                    if abs(x - r2[-1][0]) + abs(y - r2[-1][1]) >= 0.6:
                        r2.append((x, y))
                if len(r2) < 3:
                    continue
                d.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in r2) + "Z")
                if ri == 0:
                    a = cx = cy = 0.0
                    for i in range(len(q) - 1):
                        x1, y1 = q[i]; x2, y2 = q[i + 1]
                        c = x1 * y2 - x2 * y1
                        a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c
                    if abs(a) > 1e-9 and abs(a) > best_area:
                        best_area = abs(a); best_c = (cx / (3 * a), cy / (3 * a))
        shapes.append({"name": f["properties"]["shapeName"], "iso": f["properties"].get("shapeISO", ""),
                       "d": "".join(d), "cx": round(best_c[0], 1), "cy": round(best_c[1], 1)})
    return {"w": W, "h": round(H, 1), "shapes": shapes}


def main():
    speech = parse_speech()
    marz = project_marz()
    feeders = json.load(open(os.path.join(A, "feeders.json"), encoding="utf-8"))
    # v9: the map numbers live in config.js S6_MARZ (strict filter, 2,614 lines); no per-marz counts here
    total = "see config.js S6_MARZ"
    data = {"speech": speech, "marz": marz, "feederCount": len(feeders)}
    with open(os.path.join(A, "deck-data.js"), "w", encoding="utf-8") as fh:
        fh.write("/* generated by tools/build_data.py — do not edit by hand */\n")
        fh.write("window.DECK_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    calc = open(os.path.join(A, "calculator.html"), encoding="utf-8").read()
    with open(os.path.join(A, "calculator-embed.js"), "w", encoding="utf-8") as fh:
        fh.write("/* generated by tools/build_data.py from calculator.html — do not edit by hand */\n")
        fh.write("window.CALC_HTML=" + json.dumps(calc, ensure_ascii=False) + ";\n")
    print("speech screens:", len(speech), "| marz:", len(marz["shapes"]), "| solar total:", total,
          "| feeders:", len(feeders), "| map h:", marz["h"])
    print("deck-data.js", os.path.getsize(os.path.join(A, "deck-data.js")), "bytes;",
          "calculator-embed.js", os.path.getsize(os.path.join(A, "calculator-embed.js")), "bytes")


if __name__ == "__main__":
    main()
