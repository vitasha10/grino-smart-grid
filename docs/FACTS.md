# FACTS — every number used in the pitch and web deck, with source (team #27)
Use ONLY these numbers in visuals. Mark model results as "model" and assumptions as "assumption".

| # | Fact | Value | Source / note |
|---|---|---|---|
| F1 | Solar plants on ENA's grid | ~59,000 objects, ~1,288 MW (of which ~58,700 autonomous ≈ 750 MW; industrial 539 MW) | ENA temporary manager, Armenpress 03.09.2026 (armenpress.am/en/article/1259636) |
| F2 | Autonomous (small) solar producers end 2025 | 50,059 sites, 640.1 MW | PSRC annual report 2025 |
| F3 | Added in 2025 | +18,810 small plants (31,249 → 50,059) | PSRC annual reports 2024/2025 |
| F4 | Customers with voltage > 242 V at least once in the month | June 2026: 15.2% (≈ 149,000 of 980,173 customers in the database); May 14.3%; Apr 13.9%; Dec 2025: 7.0% → summer ≈ 2× winter | Own calculation on PSRC open voltage-deviation database (Հավելված 3, ENA calculation), counted per feeder × nominal-voltage group (0.4 / 0.2 kV); database covers 980 k–1.02 M customers (86–90% of ENA's 1,135,537), ~37–39 k feeders; data/09_gapfill/quality_customers_by_class.py. CORRECTED 03.10 23:20 — earlier 35.6% used one group's customer count as denominator |
| F5 | Customers with voltage < 198 V at least once | Dec 2.7%; Apr 3.3%; May 1.6%; Jun 2.9% | same (corrected 03.10; earlier 6.3/7.7/3.7/7.0%) |
| F4b | Customers living on a feeder that had > 242 V at least once in April–June 2026 | 237,308 of 980,173 = 24.2% (≈ every fourth customer); June only: 19.4% | same database; feeder = (TP, feeder code), customers = sum of row groups; computed 03.10 23:35 |
| F4c | Share of customers getting over-voltage — expert estimate | ≈ 36% (≈ 1 in 3) | Oral estimate of industry insiders/mentor to the team, 03.10.2026; NOT from documents. Show only labelled "expert estimate", next to F4 as the documented lower bound |
| F6 | Problem lines over the limit only at noon ("solar-type", strict) | 2,614 (of 5,594 feeders above +10% at 9–13 h in June): not above +10% at night (1–8 h) in June 2026 or in December 2025. Looser rule (Dec night only): 4,696 | PSRC voltage database; data/09_gapfill/solar_lines_strict.py |
| F7 | Feeders always high (Dec night > +10%) — "tap-type" | 1,770 | same |
| F8 | Feeders < −10% in Dec evening — "overload-type" | 743 | same |
| F9 | Per 10,000 customers (strict) | Shirak 39.6 (350 lines), Yerevan 36.9 (1,528), Armavir 27.1 (232), Vayots Dzor 17.1, Kotayk 16.9, Ararat 12.5, Aragatsotn 9.3, Lori 6.3, Tavush 5.2, Syunik 2.4, Gegharkunik 1.0 | same; customers PSRC 2025 |
| F10 | Appliance-damage claims to ENA, 2025 | 3,913 complaints, ≈ 25% of all (total 15,436–15,453 depending on the summation of the quarterly files) | PSRC quarterly complaint reports on ENA (HEC 1–4 2025, column "repair/compensation of appliances due to low quality") |
| F11 | Legal voltage limits | 220 V ± 10% → 198–242 V | GOST 32144-2013 (in force in RA since 01.06.2015) |
| F12 | Inverter trip | 10-min mean > 253 V (230 V + 10%), ≤ 3 s; reconnect after 60 s | EN 50549-1 default settings (inverter test reports) |
| F13 | Model: solar-heavy village feeder (AL 50, 1 km), clear June day | max 252 V as is; SunGuard throttling alone keeps ≤ 242 V but −32% of the day's solar; tap change + volt-var: ≤ 242 V, 0 solar lost | Own pandapower model (illustrative) |
| F14 | Hosting capacity, mountain-village feeder | 32 → 59 (tap) → 87 kWp (tap + volt-var) = ×2.7 | Own pandapower model (illustrative) |
| F15 | Calculator physics check | agrees with pandapower within 0.1 V on 4 test feeders | own test |
| F16 | SunGuard parts (1 unit, retail, Wi-Fi version) | ≈ 11,000 AMD ≈ $30 (ESP32-WROOM-32UE 2,750; RS485 610; ZMPT101B 1,010; HLK-5M05 3,100; DIN case and protection ~3,200) | ChipDip.am prices 03.10.2026; ≈ 363 AMD/$ |
| F17 | Radio | ESP-NOW / Wi-Fi 2.4 GHz ≤ 100 mW, no permit | PSRC decision 169-Ն p.4.9; National frequency table (Order 71-Ն) p.4.2; 868 MHz NOT used: 862–880 MHz government-only (71-Ն p.3.6.1) |
| F18 | Abroad | China: new distributed PV must be "observable, measurable, adjustable, controllable" from 01.01.2026 (NEA 2025 No.7); Germany: Solarspitzengesetz 2025 — new PV without smart meter/control box limited to 60% feed-in; Australia: AS/NZS 4777.2:2020 mandatory volt-var/volt-watt | NEA (nea.gov.cn), SMA/Bundesnetzagentur, Standards Australia |
| F19 | Network | 1,135,537 ENA customers; 9,975 TPs 10(6)/0.4 kV; 17,280 km of 0.4 kV lines (83% overhead) | PSRC quality indicators 2025 |
| F20 | Data analysed | 823,519 data rows (PSRC voltage database: Dec 2025, Apr, May, Jun 2026) | own count |
| F21 | Market (Armenia) | ~59,000 plants + 13,000–19,000 new/year; at an ASSUMED $79/box ≈ $4.7 M once + ≈ $1–1.5 M/year | assumption — price not set |
| F22 | Next markets | Georgia, Uzbekistan — Armenian solar installers already work there | ENABLING PV in Armenia study (eclareon, Berlin, 11.2024) |

| F23 | Voltage at night / before sunrise in the street model | 236 V | MODEL assumption: a 10/0.4 kV transformer gives ~400 V phase-to-phase at no load (≈ 231 V phase); with the usual raised tap (+2.5%) ≈ 237 V; light night load keeps it near that. Real streets vary; PSRC data show 1,770 lines above 242 V even at night (F7) |
| F24 | (merged into F16) | — | — |
| F25 | Unit economics & adoption (deck S6b) | parts ≈ $30, assembly+testing+certification ≈ $12, price $79 incl. VAT → margin after VAT ≈ 36%; year 1: 5% of 59,000 ≈ 3,000 boxes ≈ $0.24 M; by year 3 cumulative: 20% of today's + 10% of new ≈ 16,000 ≈ $1.3 M | ASSUMPTIONS (price, costs, adoption); plants F1, growth F3 |
| F26 | Household network-loss estimate (team spreadsheet, corrected) | ≈ 300 AMD per customer per year (median 306; Yerevan 493); national ≈ 9 GWh/yr ≈ 425 mln AMD | own estimate from marz averages, two regimes (evening τ 1,600 h + noon reverse flow 700 h); NOT a SunGuard benefit; earlier 6,824 / 9,016 AMD had a unit error |

| F27 | 3D village (deck S2/S5) | 4 radial lines; without SunGuard A 252 V, B 249 V (over 242 V, no trip), C ≤ 240 V, D 255 V → inverter protective shutdown (253 V) and restart cycle (animation sped up); SunGuard (owner mode): volt-var + small trim → no trips, lines may stay above 242 V; ENA tap one step → all within 242 V | MODEL, illustrative tree model (street3d.js) |

Disclosure: we started from public sources, including the PSRC files (hackathon rule 14 allows it). Built at the hackathon: data analysis of the PSRC files, power-flow model, calculator, SunGuard design and bill of materials, radio-law check, deck and research site. AI tools: Claude (research, code, text); all numbers checked against sources.
