# Noon-only ("solar-type") problem lines, strict filter: over +10% at 9-13 h in June 2026,
# and NOT over +10% at night (1-8 h) in June 2026 or in December 2025. Output: per marz, per 10,000 customers.
import openpyxl, collections, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
def scan(p):
    ws = openpyxl.load_workbook(p, read_only=True, data_only=True).worksheets[0]
    hit = collections.defaultdict(set); mz = {}
    for r in ws.iter_rows(values_only=True):
        v = list(r)
        try: k = next(j for j, c in enumerate(v) if c not in (None, ""))
        except StopIteration: continue
        row = v[k:k + 18]
        if len(row) < 18 or not str(row[0]).strip().isdigit() or str(row[1]).strip() == "2": continue
        key = (str(row[5]).strip(), str(row[6]).strip()); mz[key] = str(row[3]).strip()
        if str(row[11]).replace(" ", "") == ">1.1U": hit[str(row[9]).replace(" ", "")].add(key)
    return hit, mz
dec, mzd = scan("sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx")
jun, mzj = scan("sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-06.xlsx")
mz = {**mzd, **mzj}
strict = jun["9÷13"] - dec["1÷8"] - jun["1÷8"]
CUST = {"Երևան": 414332, "Արարատ": 87832, "Վայոց ձոր": 20485, "Արագածոտն": 46420, "Արմավիր": 85588, "Կոտայք": 122413,
        "Գեղարքունիք": 68002, "Տավուշ": 49559, "Շիրակ": 88402, "Սյունիք": 50410, "Լոռի": 102094}  # PSRC 2025 Q4
c = collections.Counter(mz[k] for k in strict)
print("strict noon-only lines:", len(strict))
for m in sorted(CUST, key=lambda m: -c[m] / CUST[m]):
    print(f"{m:12s} {c[m]:5d} lines  {c[m] / CUST[m] * 1e4:5.1f} per 10,000 customers")
