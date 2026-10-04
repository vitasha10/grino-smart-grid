# 03.10: проверка идеи «перекидывать нагрузку между фидерами» (GridFlow) на открытой базе КРОУ, декабрь 2025.
# Для каждой ТП: сколько фидеров, сколько из них с U<-10% вечером (19-24). Если «низко» на ВСЕХ фидерах ТП —
# проблема в трансформаторе/питающей сети 6-10 кВ, перекидка между фидерами этой ТП не поможет.
# Плюс: фидеры, где в одном блоке часов есть и >+10%, и <-10% (совместимо с перекосом фаз / обрывом нуля, но не доказательство).
import openpyxl, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ws = openpyxl.load_workbook("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx", read_only=True, data_only=True).worksheets[0]
tp_feeders = collections.defaultdict(set); low = set(); hi_blk = collections.defaultdict(set); lo_blk = collections.defaultdict(set)
cons = {}
for r in ws.iter_rows(values_only=True):
    v = list(r)
    try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
    except StopIteration: continue
    row = v[k:k + 18]
    if len(row) < 18 or not str(row[0]).strip().isdigit(): continue
    tp, fd = str(row[5]).strip(), str(row[6]).strip()
    key = (tp, fd); tp_feeders[tp].add(fd)
    band = str(row[11]).replace(" ", ""); block = str(row[9]).replace(" ", "")
    try: cons[key] = float(row[15] or 0)
    except (TypeError, ValueError): pass
    if band in ("<-1.1U", "<-1.15U", "<-1.2U"):
        lo_blk[key].add(block)
        if block == "19÷24": low.add(key)
    if band == ">1.1U": hi_blk[key].add(block)
tps_with_low = collections.defaultdict(int)
for tp, fd in low: tps_with_low[tp] += 1
all_low = sum(1 for tp, n in tps_with_low.items() if n == len(tp_feeders[tp]))
one_feeder_tp = sum(1 for tp in tps_with_low if len(tp_feeders[tp]) == 1)
partial = sum(1 for tp, n in tps_with_low.items() if n < len(tp_feeders[tp]))
print("ТП всего:", len(tp_feeders), "| фидеров всего:", sum(len(s) for s in tp_feeders.values()))
print("медиана фидеров на ТП:", sorted(len(s) for s in tp_feeders.values())[len(tp_feeders)//2])
print("фидеров с U<-10% вечером (дек):", len(low), "| на ТП:", len(tps_with_low))
print("  из этих ТП: низко на ВСЕХ фидерах ТП:", all_low, "(в т.ч. ТП с 1 фидером:", one_feeder_tp, ") | только на части фидеров:", partial)
both = [k for k in hi_blk if hi_blk[k] & lo_blk.get(k, set())]
print("фидеров, где в одном блоке часов есть и >+10%, и <-10%:", len(both), "| из них >=50 потребителей:", sum(1 for k in both if cons.get(k, 0) >= 50))
