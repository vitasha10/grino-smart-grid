# Hosting capacity: how many kWp of rooftop PV a typical LV feeder takes before any customer exceeds 242 V (1.10 p.u.)
# at noon on a clear June day — as is, with seasonal tap (-2.5% / -5%), with inverter Q(U), and both.
import numpy as np, pandapower as pp, grid_model as gm, warnings
warnings.filterwarnings("ignore")
def max_v(s_idx, pv_total_kw, tap, qu):
    net = gm.build()
    gm.set_hour(net, "jun", 13, "base")
    s = gm.SETTLEMENTS[s_idx]
    net.sgen.drop(net.sgen.index, inplace=True)
    for b in s["lv_buses"]:  # spread PV evenly over the 4 LV nodes
        p = pv_total_kw / 4 * gm.pv_jun[13] / 1000
        pp.create_sgen(net, b, p_mw=p, q_mvar=(-p * 0.484 if qu else 0.0))
    net.trafo.at[s["trafo_idx"], "tap_pos"] = tap
    pp.runpp(net)
    return net.res_bus.loc[s["lv_buses"], "vm_pu"].max()
def hc(s_idx, tap, qu):
    lo, hi = 0.0, 600.0
    if max_v(s_idx, 0, tap, qu) > 1.10: return 0.0
    for _ in range(18):
        mid = (lo + hi) / 2
        (lo, hi) = (mid, hi) if max_v(s_idx, mid, tap, qu) <= 1.10 else (lo, mid)
    return lo
for i, s in enumerate(gm.SETTLEMENTS):
    r = {k: hc(i, *v) for k, v in {"as is": (0, False), "tap -5%": (2, False), "Q(U)": (0, True), "tap -5% + Q(U)": (2, True)}.items()}
    print(f"{s['name']:35s} " + " | ".join(f"{k}: {v:5.0f} kWp" for k, v in r.items()))
