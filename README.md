# Grino · Smart Grid — rooftop solar and street voltage in Armenia

Team #27 **Grino** · GreenTech Academy Hackathon · Yerevan, October 2026 · track **Smart Grid**

**Presentation:** https://grino.vitasha.ru/deck/ · **Full research:** https://grino.vitasha.ru/research/

At noon, rooftop solar pushes power back into thin 0.4 kV lines and the voltage at the far end of a street climbs above the legal 242 V. In the regulator's open data we found **2,614 lines that go over the limit only around noon**. We designed **SunGuard** — a small box next to a home inverter that switches on the inverter's own voltage control and eases power down instead of letting it shut down, and reports the voltage over home Wi-Fi — and a **map of problem lines** that shows ENA where the cheapest fix (a transformer setting) is enough.

## What is in this repository

| Folder | What | Status |
|---|---|---|
| `analysis/` | Python scripts over the PSRC monthly voltage-deviation files (Appendix 3 to decision 441-Ա) and their outputs: customers outside ±10%, feeder types, noon-only problem lines by marz, network averages, the 400-line list for the calculator | works |
| `model/` | pandapower model of three settlements (urban block, Ararat-valley village, mountain village), hosting capacity, throttling check, figures | works (illustrative model) |
| `calculator/` | one-file browser calculator (EN / HY / RU): a real line from the data → hours outside 198–242 V → cheapest fix (tap, volt-var) → hosting capacity | works |
| `deck/` | the pitch: a 3D village (three.js) where the sun rises, lines go over the limit and SunGuard + a transformer setting bring them back; phone remote over WebSocket | works (open over http(s)) |
| `relay/` | tiny Rust pub/sub relay used by the remote (POST + SSE + WebSocket), runs behind nginx | works |
| `research/` | the long-form research page with every source | works |
| `docs/` | `FACTS.md` (every number with its source), `pitch_speech.md` | — |

**SunGuard hardware** is designed, not built: parts list with Yerevan retail prices (≈ 11,000 AMD ≈ $30: ESP32 with Wi-Fi, ZMPT101B voltage sensor, RS485 link to the inverter, 230 V → 5 V supply, DIN-rail case), control logic and safety rules are in the research page. It has not yet been tested with a real inverter; Modbus maps differ by brand.

## Run locally

```bash
# the deck needs http (ES modules); from the repo root:
python -m http.server 8027 --bind 127.0.0.1
# open http://127.0.0.1:8027/deck/  (keyboard: ← → slides, ↑ ↓ sun on S2/S5, Shift+/ help)
```

Reproduce the data results: download the monthly "voltage deviation" files from the PSRC service-quality page (https://www.psrc.am/contents/fields/electric_energy/el_energy_service_quality_indicators) — December 2025 and April–June 2026 — into the paths listed in `analysis/README.txt`, then run the scripts in `analysis/` with Python 3 (`openpyxl`). The model needs `pandapower`, `numpy`, `pandas`, `matplotlib`.

Relay: `cd relay && cargo build --release` (env `GRINO_BIND`, default `127.0.0.1:8790`).

## Data, privacy, responsible use
- Only public, aggregate data and infrastructure codes (transformer / feeder); no names or addresses.
- "Model" results are illustrative and labelled as such; real line lengths, conductors and solar per line are with ENA.
- SunGuard is designed to keep control local (the cloud only reads), to set every power limit with a revert timer, and to share data only with the owner's consent.
- Open-source libraries: three.js, pandapower, qrcode.js, axum/tokio.
- AI tools (Claude) were used for research, code and text; every number was checked against its source (`docs/FACTS.md`).

## Team
Radik Grigoryan (presenter) · Mikayel Sarkisyan · Vitaliy Sukhoplechev · Zakhar Shcherbakov · Ara Galstyan

## License
Code: MIT (see `LICENSE`). PSRC data belong to their publisher and are not redistributed here.
