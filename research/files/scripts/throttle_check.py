# Check of FACTS F13: mountain-village feeder (S3: AL 50, 1 km, 48 kWp), clear June day.
# "Throttling alone": in each hour, all PV on S3 is scaled by one common factor (equal share)
# just enough that no customer exceeds 242 V (1.10 p.u.). Output: share of the day's PV energy lost.
import numpy as np, pandapower as pp, grid_model as gm, warnings
warnings.filterwarnings("ignore")
s = gm.SETTLEMENTS[2]
net = gm.build()
lost = total = 0.0; vmax_asis = 0.0
for h in gm.H:
    gm.set_hour(net, "jun", h, "base")
    p0 = {gi: net.sgen.at[gi, "p_mw"] for _, gi in s["sgens"]}
    pp.runpp(net)
    vm = net.res_bus.loc[s["lv_buses"], "vm_pu"].max(); vmax_asis = max(vmax_asis, vm)
    e = sum(p0.values()); total += e
    if vm > 1.10:
        lo, hi = 0.0, 1.0
        for _ in range(30):
            a = (lo + hi) / 2
            for gi, p in p0.items(): net.sgen.at[gi, "p_mw"] = p * a
            pp.runpp(net)
            (lo, hi) = (a, hi) if net.res_bus.loc[s["lv_buses"], "vm_pu"].max() <= 1.10 else (lo, a)
        lost += e * (1 - lo)
        print(f"h{h:02d}: as-is max {vm*220:.1f} V -> keep {lo*100:.0f}% of PV")
print(f"max as is {vmax_asis*220:.1f} V | PV energy lost by equal throttling: {lost/total*100:.1f}% of the day")
