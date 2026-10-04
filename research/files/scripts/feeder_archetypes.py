# 03.10: число фидеров трёх «типов» по марзам (для масштабирования модели ROI):
#  A) «перегруз/длинная линия» — U<-10% в 19-24 ч (декабрь 2025);
#  B) «отпайка/высокое всегда» — U>+10% ночью 1-8 ч (декабрь 2025, солнца нет);
#  C) «солнце» — U>+10% в 9-13 ч в июне 2026, но НЕ ночью в декабре (чтобы не путать с отпайкой).
import openpyxl, sys, io, collections, csv
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
def scan(p, want):
    ws = openpyxl.load_workbook(p, read_only=True, data_only=True).worksheets[0]
    hit = set(); marz = {}; cons = {}
    for r in ws.iter_rows(values_only=True):
        v = list(r)
        try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
        except StopIteration: continue
        row = v[k:k + 18]
        if len(row) < 18 or not str(row[0]).strip().isdigit() or str(row[1]).strip() == "2": continue
        key = (str(row[5]).strip(), str(row[6]).strip()); marz[key] = str(row[3]).strip()
        # 03.10 23:45 fix: customers per (feeder, nominal-voltage group 0.4/0.2 kV), summed below (was: last row wins)
        try: cons[(key, str(row[12]).strip())] = float(row[15] or 0)
        except (TypeError, ValueError): pass
        if (str(row[9]).replace(" ", ""), str(row[11]).replace(" ", "")) in want: hit.add(key)
    tot = collections.Counter()
    for (k, _g), x in cons.items(): tot[k] += x
    return hit, marz, dict(tot)
LOW = {("19÷24", b) for b in ("<-1.1U", "<-1.15U", "<-1.2U")}
dec_low, mz, cons = scan("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx", LOW | {("1÷8", ">1.1U")})
dec_low_only = {k for k in dec_low}  # mixed set; split below
A, _, _ = scan("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx", LOW)
B, _, _ = scan("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx", {("1÷8", ">1.1U")})
Cj, mzj, consj = scan("sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-06.xlsx", {("9÷13", ">1.1U")})
C = Cj - B
mz.update({k: v for k, v in mzj.items() if k not in mz}); cons.update({k: v for k, v in consj.items() if k not in cons})
rows = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0])
for i, S in enumerate((A, B, C)):
    for k in S:
        rows[mz.get(k, "?")][i] += 1; rows[mz.get(k, "?")][3 + i] += cons.get(k, 0)
with open("data/09_gapfill/feeder_archetypes_by_marz.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f); w.writerow(["марз", "A_перегруз_фидеров", "B_отпайка_фидеров", "C_солнце_фидеров", "A_потребителей", "B_потребителей", "C_потребителей"])
    for m, v in sorted(rows.items(), key=lambda x: -sum(x[1][:3])): w.writerow([m] + [int(x) for x in v])
print("A перегруз (дек 19-24 <-10%):", len(A), "| B отпайка (дек 1-8 >+10%):", len(B), "| C солнце (июн 9-13 >+10%, не B):", len(C))
for m, v in sorted(rows.items(), key=lambda x: -sum(x[1][:3])): print(f"  {m:12s} A {v[0]:5d}  B {v[1]:5d}  C {v[2]:5d} | потребителей A {int(v[3]):6d} B {int(v[4]):6d} C {int(v[5]):6d}")
