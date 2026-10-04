# 03.10 (site build, check of FACTS F4/F5): customers outside +-10% in the PSRC voltage database,
# counted per NOMINAL-VOLTAGE ROW GROUP. Each feeder (TP code, feeder code) has one row group per
# "nominal supply voltage of consumers" (0.4 kV and/or 0.2 kV); the column "number of consumers in the
# network of the feeder" is constant inside a group and differs between groups (rows: 0.4 kV first, then 0.2 kV).
# quality_energy_summary.py kept the LAST row's count (= the 0.2 kV group where both exist), which understated
# the denominator (405-429 k instead of 980 k-1.02 M customers). Here: per group, customers = that count,
# affected = max over time blocks/bands of "consumers who received poor-quality electricity"; then sum.
import openpyxl, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
FILES = {"2025-12": "sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx",
         "2026-04": "sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-04.xlsx",
         "2026-05": "sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-05.xlsx",
         "2026-06": "sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-06.xlsx"}
LOW10 = {"<-1.1U", "<-1.15U", "<-1.2U"}
def f(x):
    try: return float(x or 0)
    except (TypeError, ValueError): return 0.0
for m, p in FILES.items():
    ws = openpyxl.load_workbook(p, read_only=True, data_only=True).worksheets[0]
    n = {}; hi = collections.defaultdict(float); lo = collections.defaultdict(float); feeders = set(); rows = 0
    for r in ws.iter_rows(values_only=True):
        v = list(r)
        try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
        except StopIteration: continue
        row = v[k:k + 18]
        if len(row) < 18 or not str(row[0]).strip().isdigit() or str(row[1]).strip() == "2": continue
        rows += 1
        key = (str(row[5]).strip(), str(row[6]).strip()); g = (key, str(row[12]).strip()); feeders.add(key)
        n[g] = f(row[15]); band = str(row[11]).replace(" ", "")
        if band == ">1.1U": hi[g] = max(hi[g], f(row[13]))
        if band in LOW10: lo[g] = max(lo[g], f(row[13]))
    N = sum(n.values()); H = sum(hi.values()); L = sum(lo.values())
    print(f"{m}: data rows {rows:,} | feeders {len(feeders):,} | row groups {len(n):,} | customers {N:,.0f} | "
          f">+10% {H:,.0f} ({H/N*100:.1f}%) | <-10% {L:,.0f} ({L/N*100:.1f}%)")
