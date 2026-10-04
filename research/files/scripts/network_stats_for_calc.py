# 03.10: network averages for the calculator. Official totals (PSRC 2025) + TP share by marz and feeders-per-TP shape from the PSRC voltage database (Dec 2025).
import openpyxl, sys, io, collections, statistics, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
CUST = {"Երևան":414332,"Արարատ":87832,"Վայոց ձոր":20485,"Արագածոտն":46420,"Արմավիր":85588,"Կոտայք":122413,"Գեղարքունիք":68002,"Տավուշ":49559,"Շիրակ":88402,"Սյունիք":50410,"Լոռի":102094}  # PSRC interruptions summary 2025 Q4
TP_TOTAL = 9975; LV_KM = 14386.73 + 2893.64  # PSRC reliability summary 2025 Q3: TP 10(6)/0.4, overhead + cable 0.4 kV
ws = openpyxl.load_workbook("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx", read_only=True, data_only=True).worksheets[0]
tp_mz = {}; feed = {}
for r in ws.iter_rows(values_only=True):
    v = list(r)
    try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
    except StopIteration: continue
    row = v[k:k + 18]
    if len(row) < 18 or not str(row[0]).strip().isdigit() or str(row[1]).strip() == "2": continue
    tp = str(row[5]).strip(); fd = str(row[6]).strip(); tp_mz[tp] = str(row[3]).strip()
    # 03.10 23:25 fix: one count per nominal-voltage group (0.4 / 0.2 kV), summed per feeder (was: last row wins)
    try: feed[(tp, fd, str(row[12]).strip())] = float(row[15] or 0)
    except (TypeError, ValueError): pass
per_feeder = collections.Counter()
for (tp, fd, _g), n in feed.items(): per_feeder[(tp, fd)] += n
tp_feeders = collections.defaultdict(list)
for (tp, fd), n in per_feeder.items(): tp_feeders[tp].append(n)
main = [sum(1 for n in v if n >= 10) for v in tp_feeders.values()]
mz_tp = collections.Counter(tp_mz.values())
scale = TP_TOTAL / len(tp_mz)
print(f"TOTAL: customers {sum(CUST.values()):,} | TP 10(6)/0.4 kV {TP_TOTAL:,} | LV lines {LV_KM:,.0f} km")
print(f"  avg customers per TP {sum(CUST.values())/TP_TOTAL:.0f} | avg LV km per TP {LV_KM/TP_TOTAL:.2f}")
print(f"  feeders per TP with >=10 customers (PSRC db): median {statistics.median(main):.0f}, mean {statistics.mean(main):.1f}")
mf = statistics.mean([m for m in main if m > 0])
print(f"  -> avg LV length per main feeder ~ {LV_KM/TP_TOTAL/mf*1000:.0f} m (all LV km attributed to main feeders)")
print("BY MARZ (TP count = PSRC db share scaled to 9,975):")
out = []
for m, c in sorted(CUST.items(), key=lambda x: -x[1]):
    tps = mz_tp.get(m, 0) * scale
    out.append((m, c, round(tps), round(c / tps) if tps else None)); print(f"  {m:12s} customers {c:7,} | TP ~{tps:5.0f} | customers/TP ~{c/tps:4.0f}")
PV_MW, PV_N = 640.1, 50059  # autonomous producers end-2025 (PSRC annual report 2025)
print(f"SOLAR (autonomous, end 2025): {PV_N:,} sites, {PV_MW} MW | avg {PV_MW*1000/PV_N:.1f} kW/site | {PV_N/sum(CUST.values())*100:.1f}% of customers | avg {PV_MW*1000/TP_TOTAL:.0f} kW per TP | {PV_MW*1000/sum(CUST.values()):.2f} kW per customer")
