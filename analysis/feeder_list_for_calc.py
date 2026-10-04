# 03.10: per-feeder list for the FeederCheck calculator (PSRC open voltage database, Dec 2025 + Jun 2026).
# hours = duration column of the matching row (hours in that band within the time block over the month).
# 03.10 23:30 fix: a feeder has one row group per nominal supply voltage (0.4 / 0.2 kV) with its own customer
# count; customers = SUM over groups (was: last row wins -> e.g. 40 instead of 350), affected = per-group max, summed.
import openpyxl, json, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
def scan(p):
    ws = openpyxl.load_workbook(p, read_only=True, data_only=True).worksheets[0]; d = {}
    for r in ws.iter_rows(values_only=True):
        v = list(r)
        try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
        except StopIteration: continue
        row = v[k:k + 18]
        if len(row) < 18 or not str(row[0]).strip().isdigit() or str(row[1]).strip() == "2": continue
        key = (str(row[5]).strip(), str(row[6]).strip())
        e = d.setdefault(key, {"br": str(row[1]).strip(), "mz": str(row[3]).strip(), "np": str(row[4]).strip(), "ng": {}, "b": collections.defaultdict(float), "ag": collections.defaultdict(float)})
        grp = str(row[12]).strip()
        try: e["ng"][grp] = int(float(row[15] or 0))
        except (TypeError, ValueError): pass
        blk = str(row[9]).replace(" ", ""); band = str(row[11]).replace(" ", "")
        try: hrs = float(row[10] or 0); aff = float(row[13] or 0)
        except (TypeError, ValueError): hrs = aff = 0
        hi = band == ">1.1U"; lo = band in ("<-1.1U", "<-1.15U", "<-1.2U")
        if hi or lo:
            tag = blk + ("H" if hi else "L"); e["b"][tag] = max(e["b"][tag], hrs); e["ag"][(tag, grp)] = max(e["ag"][(tag, grp)], aff)
    for e in d.values():
        e["n"] = sum(e["ng"].values()); e["a"] = collections.defaultdict(float)
        for (tag, _g), x in e["ag"].items(): e["a"][tag] += x
    return d
dec = scan("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx")
jun = scan("sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-06.xlsx")
rows = []
for key in set(dec) | set(jun):
    a = jun.get(key) or dec.get(key); dj = jun.get(key, {"b": {}, "a": {}, "n": 0}); dd = dec.get(key, {"b": {}, "a": {}, "n": 0})
    noonH = dj["b"].get("9÷13H", 0); nightH = dd["b"].get("1÷8H", 0); eveL = dd["b"].get("19÷24L", 0)
    affected = max(dj["a"].get("9÷13H", 0), dd["a"].get("19÷24L", 0), dd["a"].get("1÷8H", 0))
    if not (noonH or nightH or eveL): continue
    n = max(dj.get("n", 0), dd.get("n", 0))
    typ = "solar" if noonH and not nightH else ("tap" if nightH else "")
    if eveL: typ = (typ + "+overload") if typ else "overload"
    rows.append({"tp": key[0], "f": key[1], "br": a["br"], "mz": a["mz"], "np": a["np"], "n": n, "noonH": round(noonH), "nightH": round(nightH), "eveL": round(eveL), "aff": int(affected), "type": typ})
rows = [r for r in rows if r["n"] >= 20]
rows.sort(key=lambda r: -r["aff"])
top = rows[:400]
json.dump(top, open("stand/calculator/feeders.json", "w", encoding="utf-8"), ensure_ascii=False)
print("feeders with >=20 customers and a voltage problem:", len(rows), "| exported:", len(top))
print(collections.Counter(r["type"] for r in rows).most_common())
for r in top[:5]: print(r)
