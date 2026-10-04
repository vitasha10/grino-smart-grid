# 03.10: сводка по базе КРОУ «Լարման շեղում» за 4 месяца — сколько энергии и потребителей получили напряжение вне нормы,
# и грубая оценка потерь в сети на энергии, отпущенной при U ниже -10% (ΔP/P ≈ k·ΔU/U, k≈0,5–1, ΔU≥10% → 5–10%).
import openpyxl, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
FILES = {"2025-12": "sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx",
         "2026-04": "sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-04.xlsx",
         "2026-05": "sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-05.xlsx",
         "2026-06": "sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-06.xlsx"}
LOW10 = {"<-1.1U", "<-1.15U", "<-1.2U"}; HIGH10 = {">1.1U"}; NORM = "-1.05U÷1.05U"
def f(x):
    try: return float(x or 0)
    except (TypeError, ValueError): return 0.0
for m, p in FILES.items():
    ws = openpyxl.load_workbook(p, read_only=True, data_only=True).worksheets[0]
    cons = {}; sup = {}; marz = {}
    kwh = collections.Counter(); aff = collections.defaultdict(lambda: collections.defaultdict(float))
    fset = collections.defaultdict(set); blk = collections.defaultdict(set)
    for r in ws.iter_rows(values_only=True):
        v = list(r)
        try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
        except StopIteration: continue
        row = v[k:k + 18]
        if len(row) < 18 or not str(row[0]).strip().isdigit() or str(row[1]).strip() == "2": continue
        key = (str(row[5]).strip(), str(row[6]).strip()); band = str(row[11]).replace(" ", ""); b = str(row[9]).replace(" ", "")
        cons[key] = f(row[15]); sup[key] = f(row[17]); marz[key] = str(row[3]).strip()
        if band == NORM: continue
        cat = "low10" if band in LOW10 else "high10" if band in HIGH10 else "low5_10" if band.startswith("<") else "high5_10"
        kwh[cat] += f(row[14]); kwh["any"] += f(row[14])
        for c in (cat, "any"):
            aff[c][key] = max(aff[c][key], f(row[13])); fset[c].add(key); blk[(c, b)].add(key)
    S = sum(sup.values()); C = sum(cons.values())
    print(f"=== {m}: фидеров {len(sup)}, потребителей {C:,.0f}, отпуск {S/1e6:,.1f} млн кВт·ч")
    for c in ("any", "low10", "low5_10", "high10", "high5_10"):
        print(f"  {c:8s}: фидеров {len(fset[c]):5d} | потребителей (max по фидеру) {sum(aff[c].values()):9,.0f} ({sum(aff[c].values())/C*100:4.1f}%) | кВт·ч {kwh[c]/1e6:7.2f} млн ({kwh[c]/S*100:4.1f}% отпуска)")
    for c in ("low10", "high10"):
        print("   ", c, "по блокам:", {b: len(blk[(c, b)]) for b in ("1÷8", "9÷13", "14÷18", "19÷24")})
    lo = kwh["low10"]
    print(f"  оценка потерь на энергии при U<-10%: {lo*0.05/1e3:,.0f}–{lo*0.10/1e3:,.0f} МВт·ч/мес ≈ ${lo*0.05*0.05/1e3:,.0f}–{lo*0.10*0.05/1e3:,.0f} тыс./мес (по $0,05/кВт·ч)")
    mz = collections.Counter(marz[k] for k in fset["low10"]); print("  U<-10% по марзам:", mz.most_common(11))
    mz = collections.Counter(marz[k] for k in fset["high10"]); print("  U>+10% по марзам:", mz.most_common(11))
