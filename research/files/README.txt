Team #27 Grino (GreenTech Academy Hackathon, Yerevan, 3-4 Oct 2026) - data and code behind the research page.

INPUT DATA (public, not included - download from PSRC):
  PSRC -> Electric energy -> Service quality indicators:
  https://www.psrc.am/contents/fields/electric_energy/el_energy_service_quality_indicators
  Monthly "voltage deviation" files (Appendix 3 to decision 441-A), December 2025 and April, May, June 2026.
  December 2025 direct link: https://www.psrc.am/uploads/files/Էլեկտրական Էներգիա/Սպասարկման որակի ցուցանիշներ/2025/4-er/Դեկտեմբեր.xlsx
  Save them as:
    sources/08_data/psrc_quality/voltage_deviation_db_2025-12.xlsx
    sources/09_gapfill/psrc_voltage_2026/voltage_db_2026-04.xlsx  (-05, -06)

SCRIPTS (Python 3, openpyxl; grid model: pandapower 3.5.5, numpy, pandas, matplotlib). Run from the folder that contains sources/:
  quality_customers_by_class.py  customers outside +-10% per month (counted per feeder x nominal-voltage group 0.4/0.2 kV)
  quality_energy_summary.py      feeders by band and time block (its customer shares are superseded by the script above)
  feeder_archetypes.py           solar / tap / overload feeder types by marz
  tp_low_voltage_structure.py    overload-type feeders by TP structure
  feeder_list_for_calc.py        400 problem feeders for the FeederCheck calculator
  network_stats_for_calc.py      network averages per TP and marz (PSRC 2025 totals)
  grid_model.py, hosting_capacity.py, throttle_check.py   illustrative pandapower model (3 settlements)
  Scripts expect paths like data/09_gapfill/... and stand/grid_model/... for outputs; adjust if needed.

OUTPUTS (as used on the page): outputs/*.txt, *.csv, feeders_400.json, grid_model_summary.csv, Grino27_network_by_marz.xlsx
No personal data: only aggregate figures and infrastructure codes (TP / feeder).
