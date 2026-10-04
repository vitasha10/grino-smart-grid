# Grino #27 — illustrative distribution model: 110/10 kV substation, 10 kV overhead feeder,
# three settlements, each with a 10/0.4 kV TP and a 0.38 kV overhead LV feeder.
# Voltage limits: 220/380 V +-10% (GOST 32144-2013, in force in Armenia since 01.06.2015).
# Consumption per customer from PSRC voltage database medians: ~281 kWh/month (Dec), ~174 (Jun).
# This is a model tuned to reproduce patterns seen in PSRC data (evening undervoltage, midday
# overvoltage with rooftop PV), NOT a model of a real ENA feeder.
import os, json, copy, math
import numpy as np, pandas as pd
import pandapower as pp
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)
VN_LV = 0.38  # Armenian LV nominal (380/220 V); transformer secondary is 0.4 kV (+5% boost)
LIM_LO, LIM_HI = 0.90, 1.10

# ---------- hourly profiles (share of daily energy / per-unit) ----------
H = np.arange(24)
res_dec = np.array([.55, .5, .48, .47, .48, .55, .75, .95, .9, .8, .75, .72, .72, .7, .7, .75, .9, 1.2, 1.55, 1.75, 1.8, 1.6, 1.2, .8])
res_jun = np.array([.6, .55, .5, .48, .48, .5, .6, .75, .8, .85, .95, 1.05, 1.15, 1.2, 1.2, 1.15, 1.1, 1.15, 1.3, 1.5, 1.6, 1.45, 1.1, .8])
res_dec /= res_dec.mean(); res_jun /= res_jun.mean()
pv_jun = np.clip(np.sin((H - 5.5) / 14 * math.pi), 0, None) ** 1.3 * 0.82   # clear June day, per kWp
pv_dec = np.clip(np.sin((H - 8.0) / 9 * math.pi), 0, None) ** 1.3 * 0.55    # clear December day
pump_jun = np.where((H >= 8) & (H <= 20), 1.0, 0.15)                         # irrigation pumps, summer
pump_dec = np.zeros(24)

KWH_DAY = {"dec": 281 / 31, "jun": 174 / 30}   # kWh per customer per day (PSRC medians)

# ---------- settlements ----------
# name, km from previous MV node, trafo type, LV segment km, customers per LV node (4 nodes), PV kWp per LV node, pumps kW
SETTLEMENTS = [
    # one representative (worst) LV feeder is modelled in detail; "rest" = other feeders of the same TP, lumped at the TP bus
    dict(key="S1", name="Urban block", mv_km=3, trafo="0.63 MVA 10/0.4 kV", lv_type="94-AL1/15-ST1A 0.4", lv_km=[.1, .1, .1, .1], cust=[20, 20, 20, 20], rest=300, pv=[0, 0, 0, 0], pump=0),
    dict(key="S2", name="Ararat-valley village", mv_km=6, trafo="0.25 MVA 10/0.4 kV", lv_type="48-AL1/8-ST1A 0.4", lv_km=[.25, .3, .3, .35], cust=[15, 15, 15, 15], rest=100, pv=[0, 8, 0, 8], pump=12),
    dict(key="S3", name="Mountain village with rooftop PV", mv_km=8, trafo="0.25 MVA 10/0.4 kV", lv_type="48-AL1/8-ST1A 0.4", lv_km=[.2, .25, .25, .3], cust=[10, 10, 10, 10], rest=60, pv=[6, 12, 12, 18], pump=0),
]


def build():
    net = pp.create_empty_network(name="Grino #27 illustrative feeder")
    b_hv = pp.create_bus(net, 110, name="PS 110 kV", geodata=(-1.2, 0))
    b_sub = pp.create_bus(net, 10, name="PS 10 kV bus", geodata=(0, 0))
    pp.create_ext_grid(net, b_hv, vm_pu=1.0, name="Grid 110 kV")
    pp.create_transformer_from_parameters(net, b_hv, b_sub, sn_mva=16, vn_hv_kv=110, vn_lv_kv=10.3, vk_percent=10.5,
                                          vkr_percent=0.6, pfe_kw=18, i0_percent=0.7, name="PS 110/10 kV 16 MVA")
    prev, x = b_sub, 0.0
    for s in SETTLEMENTS:
        x += s["mv_km"]
        b_mv = pp.create_bus(net, 10, name=f"{s['key']} 10 kV", geodata=(x, 0))
        lt = "94-AL1/15-ST1A 10.0" if prev == b_sub else "48-AL1/8-ST1A 10.0"
        pp.create_line(net, prev, b_mv, s["mv_km"], lt, name=f"MV to {s['key']}")
        b_tp = pp.create_bus(net, VN_LV, name=f"{s['key']} TP 0.4 kV", geodata=(x, -1.5))
        s["trafo_idx"] = pp.create_transformer(net, b_mv, b_tp, s["trafo"], name=f"{s['key']} TP")
        s["lv_buses"], s["loads"], s["sgens"], s["pumps"] = [], [], [], []
        pl, y = b_tp, -1.5
        for k, km in enumerate(s["lv_km"]):
            y -= 1.0
            b = pp.create_bus(net, VN_LV, name=f"{s['key']} LV{k+1}", geodata=(x + (0.35 if k % 2 else -0.35), y))
            pp.create_line(net, pl, b, km, s["lv_type"], name=f"{s['key']} LV seg {k+1}")
            s["lv_buses"].append(b)
            s["loads"].append(pp.create_load(net, b, p_mw=0, q_mvar=0, name=f"{s['key']} homes {k+1}"))
            if s["pv"][k]:
                s["sgens"].append((k, pp.create_sgen(net, b, p_mw=0, name=f"{s['key']} PV {k+1}")))
            pl = b
        s["rest_load"] = pp.create_load(net, b_tp, p_mw=0, q_mvar=0, name=f"{s['key']} other feeders")
        if s["pump"]:
            s["pumps"].append(pp.create_load(net, s["lv_buses"][-1], p_mw=0, q_mvar=0, name=f"{s['key']} pumps"))
        prev = b_mv
    return net


def set_hour(net, season, h, version):
    prof = res_dec if season == "dec" else res_jun
    pv = pv_dec if season == "dec" else pv_jun
    pump = pump_dec if season == "dec" else pump_jun
    for s in SETTLEMENTS:
        for k, li in enumerate(s["loads"]):
            p = s["cust"][k] * KWH_DAY[season] / 24 * prof[h] / 1000  # MW
            net.load.at[li, "p_mw"] = p
            net.load.at[li, "q_mvar"] = p * 0.33  # cos phi ~0.95
        p = s["rest"] * KWH_DAY[season] / 24 * prof[h] / 1000
        net.load.at[s["rest_load"], "p_mw"] = p
        net.load.at[s["rest_load"], "q_mvar"] = p * 0.33
        for li in s["pumps"]:
            p = s["pump"] * pump[h] / 1000
            net.load.at[li, "p_mw"] = p
            net.load.at[li, "q_mvar"] = p * 0.75  # motors, cos phi ~0.8
        for k, gi in s["sgens"]:
            p = s["pv"][k] * pv[h] / 1000
            net.sgen.at[gi, "p_mw"] = p
            # version "inverter": Q(U)-like setting — absorb reactive power at cos phi 0.9 while exporting
            net.sgen.at[gi, "q_mvar"] = 0.0
        # version "tap": seasonal off-load tap chosen from the diagnosis (+1 step = -2.5% at LV)
        tap = 0
        if "tap" in version:
            if s["key"] == "S3" and season == "jun": tap = 2      # high voltage at noon -> lower
            if s["key"] == "S2" and season == "dec": tap = -1     # low voltage in the evening -> raise
        net.trafo.at[s["trafo_idx"], "tap_pos"] = tap


VERSIONS = {"base": "As is", "tap": "Tap change (seasonal)", "tap+inverter": "Tap + inverter Q(U)"}


def solve(net, version, init="auto"):
    pp.runpp(net, init=init)
    if "inverter" in version and len(net.sgen):
        # Q(U) setting: inverter absorbs reactive power (cos phi 0.9) only where local voltage > 1.05 p.u.
        hi = net.res_bus.vm_pu.reindex(net.sgen.bus).values > 1.05
        if hi.any():
            net.sgen.loc[hi, "q_mvar"] = -net.sgen.loc[hi, "p_mw"] * 0.484
            pp.runpp(net, init="results")


def run_day(season, version):
    net = build()
    rows = []
    for h in H:
        set_hour(net, season, h, version)
        solve(net, version, init="dc" if h == 0 else "results")
        for s in SETTLEMENTS:
            vm = net.res_bus.loc[s["lv_buses"], "vm_pu"]
            rows.append(dict(season=season, version=version, hour=h, settlement=s["key"],
                             v_min=vm.min(), v_max=vm.max(), v_end=vm.iloc[-1],
                             trafo_loading=net.res_trafo.at[s["trafo_idx"], "loading_percent"]))
        rows.append(dict(season=season, version=version, hour=h, settlement="ALL",
                         loss_kw=(net.res_line.pl_mw.sum() + net.res_trafo.pl_mw.iloc[1:].sum()) * 1000,
                         load_kw=(net.res_load.p_mw.sum()) * 1000, pv_kw=net.res_sgen.p_mw.sum() * 1000 if len(net.sgen) else 0))
    return pd.DataFrame(rows), net


def main():
    frames, nets = [], {}
    for season in ("dec", "jun"):
        for v in VERSIONS:
            df, net = run_day(season, v)
            frames.append(df); nets[(season, v)] = net
    res = pd.concat(frames, ignore_index=True)
    res.to_csv(os.path.join(OUT, "results_hourly.csv"), index=False)

    # ---------- summary ----------
    summ = []
    for (season, v), g in res.groupby(["season", "version"]):
        st = g[g.settlement != "ALL"]; al = g[g.settlement == "ALL"]
        hours_out = int(((st.v_min < LIM_LO) | (st.v_max > LIM_HI)).sum())
        summ.append(dict(season=season, version=v, v_min=round(st.v_min.min(), 3), v_max=round(st.v_max.max(), 3),
                         settlement_hours_out_of_limits=hours_out, loss_kwh_day=round(al.loss_kw.sum(), 1),
                         load_kwh_day=round(al.load_kw.sum(), 1), loss_pct=round(al.loss_kw.sum() / al.load_kw.sum() * 100, 2),
                         max_trafo_loading=round(st.trafo_loading.max(), 1)))
    summ = pd.DataFrame(summ)
    summ.to_csv(os.path.join(OUT, "summary.csv"), index=False)
    print(summ.to_string(index=False))

    # ---------- figure 1: daily end-of-line voltage per settlement, base vs versions ----------
    fig, axes = plt.subplots(2, 3, figsize=(15, 7.5), sharex=True, sharey=True)
    for r, season in enumerate(("dec", "jun")):
        for c, s in enumerate(SETTLEMENTS):
            ax = axes[r, c]
            ax.axhspan(LIM_LO * 220, LIM_HI * 220, color="#e8f5e9", zorder=0)
            for v, style in zip(VERSIONS, ("-", "--", ":")):
                g = res[(res.season == season) & (res.version == v) & (res.settlement == s["key"])]
                ax.plot(g.hour, g.v_min * 220, style, color="#c62828", lw=1.8, label=f"min U, {VERSIONS[v]}")
                ax.plot(g.hour, g.v_max * 220, style, color="#1565c0", lw=1.8, label=f"max U, {VERSIONS[v]}")
            ax.axhline(198, color="#2e7d32", lw=0.8); ax.axhline(242, color="#2e7d32", lw=0.8)
            ax.set_title(f"{s['name']} — {'December' if season == 'dec' else 'June'}", fontsize=10)
            ax.grid(alpha=.3)
            if c == 0: ax.set_ylabel("Phase voltage at customers, V")
            if r == 1: ax.set_xlabel("Hour")
    h, l = axes[0, 0].get_legend_handles_labels()
    fig.legend(h, l, loc="lower center", ncol=3, fontsize=8, frameon=False)
    fig.suptitle("Customer voltage over a day: 220 V ±10% corridor (GOST 32144-2013) — illustrative model", fontsize=12)
    fig.tight_layout(rect=(0, .08, 1, .96))
    fig.savefig(os.path.join(OUT, "fig1_daily_voltage.png"), dpi=150); plt.close(fig)

    # ---------- figure 2: voltage profile along the network (worst hours) ----------
    fig, ax = plt.subplots(figsize=(11, 5))
    for season, hour, color in (("dec", 20, "#c62828"), ("jun", 13, "#1565c0")):
        for v, style in (("base", "-"), ("tap+inverter", "--")):
            net = build(); set_hour(net, season, hour, v); solve(net, v)
            xs, ys, labels = [0.0], [net.res_bus.at[1, "vm_pu"]], ["PS"]
            dist = 0.0
            for s in SETTLEMENTS:
                dist += s["mv_km"]
                xs.append(dist); ys.append(net.res_bus.loc[net.bus.name == f"{s['key']} 10 kV", "vm_pu"].iloc[0])
            ax.plot(xs, np.array(ys) * 220, style, color=color, alpha=.5)
            # LV of each settlement as a branch hanging off its MV node
            dist = 0.0
            for s in SETTLEMENTS:
                dist += s["mv_km"]
                tp = net.res_bus.loc[net.bus.name == f"{s['key']} TP 0.4 kV", "vm_pu"].iloc[0]
                lvx = [dist]; lvy = [tp]; d = dist
                for k, b in enumerate(s["lv_buses"]):
                    d += s["lv_km"][k] * 3  # LV distance stretched x3 for readability
                    lvx.append(d); lvy.append(net.res_bus.at[b, "vm_pu"])
                ax.plot(lvx, np.array(lvy) * 220, style, color=color, marker="o", ms=3,
                        label=f"{'Dec 20:00' if season == 'dec' else 'Jun 13:00'} — {VERSIONS[v]}" if s["key"] == "S1" else None)
    ax.axhspan(198, 242, color="#e8f5e9", zorder=0)
    ax.axhline(198, color="#2e7d32", lw=.8); ax.axhline(242, color="#2e7d32", lw=.8)
    ax.annotate("10 kV line (p.u. x 220 V)", (5.5, 227.5), fontsize=8, color="#555")
    for s, d in zip(SETTLEMENTS, np.cumsum([s["mv_km"] for s in SETTLEMENTS])):
        ax.annotate(s["name"].replace(" with rooftop PV", " + PV"), (d, 247), ha="left", fontsize=8)
    ax.set_xlabel("Distance from substation, km (10 kV line; LV branches stretched x3)")
    ax.set_ylabel("Voltage referred to 220 V, V")
    ax.set_title("Voltage profile: substation → 10 kV line → TP → last house")
    ax.legend(fontsize=8, loc="lower left"); ax.grid(alpha=.3)
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "fig2_voltage_profile.png"), dpi=150); plt.close(fig)

    # ---------- figure 3: single-line style network map colored by voltage (Dec 20:00 and Jun 13:00, as is) ----------
    from matplotlib.collections import LineCollection
    import matplotlib.cm as cm, matplotlib.colors as mcolors
    norm = mcolors.TwoSlopeNorm(vmin=0.86, vcenter=1.0, vmax=1.14)
    cmap = plt.get_cmap("RdYlBu_r")
    fig, axes = plt.subplots(1, 2, figsize=(15, 6))
    for ax, (season, hour, title) in zip(axes, (("dec", 20, "December, 20:00 — as is"), ("jun", 13, "June, 13:00 — as is"))):
        net = build(); set_hour(net, season, hour, "base"); pp.runpp(net)
        geo = {b: json.loads(g)["coordinates"] if isinstance(g, str) else g for b, g in net.bus.geo.items()}
        segs, load_pct = [], []
        for i, ln in net.line.iterrows():
            segs.append([geo[ln.from_bus], geo[ln.to_bus]]); load_pct.append(net.res_line.at[i, "loading_percent"])
        for i, tr in net.trafo.iterrows():
            segs.append([geo[tr.hv_bus], geo[tr.lv_bus]]); load_pct.append(net.res_trafo.at[i, "loading_percent"])
        lc = LineCollection(segs, linewidths=[1.5 + p / 25 for p in load_pct], colors="#555")
        ax.add_collection(lc)
        for b, (x, y) in geo.items():
            vm = net.res_bus.at[b, "vm_pu"]
            vref = vm if net.bus.at[b, "vn_kv"] < 1 else vm  # p.u. of nominal
            ax.scatter(x, y, s=140 if net.bus.at[b, "vn_kv"] >= 10 else 90, c=[cmap(norm(vref))], edgecolors="k", zorder=3,
                       marker="s" if net.bus.at[b, "vn_kv"] >= 10 else "o")
            if net.bus.at[b, "vn_kv"] < 1:
                ax.annotate(f"{vm*220:.0f} V", (x + 0.25, y - 0.1), fontsize=7)
        for s in SETTLEMENTS:
            x0 = geo[s["lv_buses"][0]][0]
            ax.annotate(f"{s['name']}\nTP {s['trafo'].split(' 10')[0]}: {net.res_trafo.at[s['trafo_idx'], 'loading_percent']:.0f}%",
                        (x0 - 1.4, 1.0), fontsize=8)
        ax.annotate("PS 110/10 kV", (-1.6, 0.5), fontsize=8)
        ax.set_title(title); ax.set_aspect("auto"); ax.axis("off")
        ax.set_xlim(-2.5, 19.5); ax.set_ylim(-7, 2.2)
    sm = cm.ScalarMappable(norm=norm, cmap=cmap); sm.set_array([])
    cb = fig.colorbar(sm, ax=axes, fraction=.025, pad=.01); cb.set_label("Voltage, p.u. of nominal (limits 0.90–1.10)")
    fig.suptitle("Network map: node colour = voltage, line width = loading (illustrative model)", fontsize=12)
    fig.savefig(os.path.join(OUT, "fig3_network_map.png"), dpi=150, bbox_inches="tight"); plt.close(fig)

    with open(os.path.join(OUT, "README.txt"), "w", encoding="utf-8") as f:
        f.write("Illustrative model (pandapower). Outputs: summary.csv, results_hourly.csv, fig1..fig3.\n")
    return summ


if __name__ == "__main__":
    main()
