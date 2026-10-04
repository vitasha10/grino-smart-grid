/* Shared config for the deck (index.html) and the phone remote (remote.html).
   Everything here is public: no secrets. Edit the constants, not the code. */
window.GRINO = {
  /* Relay topic: NOT in public files. Set only from the URL: index.html?k=<secret> and remote.html?k=<secret>
     (the link from the team chat). Without k the deck runs locally (keyboard / clicker), the remote does not connect. */
  TOPIC: '',
  /* the only relay (ntfy-compatible subset): WebSocket wss://<relay>/<topic>/ws -> SSE -> long-poll */
  RELAY_URL: 'https://grino.vitasha.ru/grino',

  /* QR on the last screen. Replace with the real link before the pitch. */
  FULL_RESEARCH_URL: 'https://grino.vitasha.ru/research/',

  /* Optional: where remote.html will be hosted; shown as a QR in the deck help overlay (key ?). */
  REMOTE_URL: 'https://grino.vitasha.ru/deck/remote.html',

  PITCH_SECONDS: 180,

  /* S2 starts before sunrise (3D supports s < 0; 2D/snapshots clamp to 0) */
  PRE_DAWN: -0.12,
  /* autopilot (key A / remote Auto): absolute pitch times in seconds, as in SPEECH_beta_EN.md (Radik's plan) */
  AUTOPILOT: {                       /* seconds from the start (speech v4, 04.10) */
    sunUp: 17, sunUpEnd: 27,         /* S2: sun from pre-dawn to noon */
    guardWhereNeeded: 66,            /* S5 stage 1: SunGuard on lines A + B */
    guardEverywhere: 74,             /* S5 stage 2: + line D */
    tapFix: 80,                      /* S5 stage 3: ENA adjusts the transformer (Street.setTap if present) */
    partsExplode: 91,                /* S8: explode, then one part every ~1.2 s */
    moreSolar: 110, moreSolarEnd: 113, cheapestFix: 114   /* S7 steps from 1:48 every ~2 s */
  },
  /* steps inside a screen (remote: prev/next state + chips; keyboard [ ]); auto = seconds after entering the screen */
  STEPS: {
    s3: { chips: ['—', '59,000', '1 in 3', '3,913'], auto: [0.3, 5.5, 10.5] },
    s5: { chips: ['—', 'voltage', 'panels', 'phone'], auto: [2, 5, 8] },
    s6b: { auto: 'stagger', every: 0.7, start: 0.6 },
    s8: { chips: ['box', 'explode', 'sensor', 'Wi-Fi \u00b5C', 'inverter link', 'power'] },
    s7: { chips: ['—', '① line', '② solar', '③ noon', '④ fix', '⑤ result'], auto: [0.4, 3, 5.5, 8, 10.5] }
  },
  /* S6 map: solar problem lines and customers per marz (PSRC voltage data June 2026; customers PSRC 2025) */
  /* S6 map: problem lines = strict filter (over +10% at 9-13 h in June, NOT at night 1-8 h in June or December); total 2,614.
     Source: data/09_gapfill/solar_lines_strict_by_marz.json (PSRC voltage data; customers PSRC 2025) */
  S6_MARZ: [
    { marz: 'Shirak', lines: 350, customers: 88402, per10k: 39.6 },
    { marz: 'Yerevan', lines: 1528, customers: 414332, per10k: 36.9 },
    { marz: 'Armavir', lines: 232, customers: 85588, per10k: 27.1 },
    { marz: 'Vayots Dzor', lines: 35, customers: 20485, per10k: 17.1 },
    { marz: 'Kotayk', lines: 207, customers: 122413, per10k: 16.9 },
    { marz: 'Ararat', lines: 110, customers: 87832, per10k: 12.5 },
    { marz: 'Aragatsotn', lines: 43, customers: 46420, per10k: 9.3 },
    { marz: 'Lori', lines: 64, customers: 102094, per10k: 6.3 },
    { marz: 'Tavush', lines: 26, customers: 49559, per10k: 5.2 },
    { marz: 'Syunik', lines: 12, customers: 50410, per10k: 2.4 },
    { marz: 'Gegharkunik', lines: 7, customers: 68002, per10k: 1.0 }
  ],
  /* sun on the deck: critically damped follow with a speed limit (dawn -> noon >= ~3.3 s at full drag) */
  SUN_MAX_SPEED: 1.2,       /* v8: sun units per second when driven by a remote / keys (dawn -> noon in ~0.8 s); scripted sweeps keep their own slow ramp */
  SUN_SPRING: 18,           /* v8: critically damped spring w = 18/s: lag behind a moving finger 2/w ~ 110 ms, 63 % of a jump in ~120 ms */
  SUN_KEY_STEP: 0.08,       /* keyboard Up/Down on S2/S5: one press */
  SUN_KEY_HOLD: 0.6,        /* held key: sun units per second */
  SUN_PRESETS: { morning: 0.3 },   /* remote buttons: Dawn = PRE_DAWN, Morning, Noon = 1 */
  /* sun height at which the first home goes over 242 V (no SunGuard), per street renderer; measured with Street.volts() */
  SUN_242: { '3d': 0.401, png: 0.46, '2d': 0.459 },

  /* FACTS F4 (corrected 03.10) — share of customers with > 242 V at least once in the month, PSRC open voltage
     database (980,173 customers in June 2026), own calculation. The ONLY place these numbers live.
     Not shown in v1 (S3_SHOW_BARS: false). */
  OVERVOLTAGE_PCT: [
    { label: 'Dec 2025', pct: 7.0 },
    { label: 'Apr 2026', pct: 13.9 },
    { label: 'May 2026', pct: 14.3 },
    { label: 'Jun 2026', pct: 15.2, hot: true }
  ],
  /* S3 headline — FINAL team decision 03.10: FACTS F4c, oral expert estimate (NOT regulator data).
     Change the wording here only. countTo (optional) animates a number: { prefix: '≈ ', countTo: 150000 } */
  S3_HEADLINE: {
    big: '≈ 1 in 3',
    pct: '36%',
    caption: 'customers get over-voltage',
    footnote: 'industry expert estimate'
  },
  /* S3 month bars (OVERVOLTAGE_PCT, PSRC data) are hidden in v1 by the team's decision; true = show them */
  S3_SHOW_BARS: false,

  /* ntfy.sh public limits (docs.ntfy.sh/publish/#limitations): 60-request burst, then 1 request / 5 s,
     and 250 messages / day per IP (reset 00:00 UTC = 04:00 Yerevan). The deck smooths the sun between
     samples, so a slow send rate still looks continuous. The relay has no rate limit. */
  SUN_HZ_NTFY: 0.6,
  SUN_HZ_RELAY: 30,          /* v8: sun targets at <= 30 Hz over the relay WebSocket, latest value wins */
  /* deck acks: first ack immediately, then at most one per interval (latest seq wins) */
  ACK_MIN_INTERVAL_NTFY_MS: 2000,
  ACK_MIN_INTERVAL_RELAY_MS: 200,
  ACK_TIMEOUT_MS: 3500,

  /* WebRTC DataChannel (p2p.js): optional extra fast path phone -> paired deck; every command still goes over the relay,
     so all decks and remotes stay in sync. Handshake over the relay (<TOPIC>-sig); STUN only, no TURN. */
  P2P: false,               /* v7: off by default (enable per page with ?p2p=on) */
  ICE_SERVERS: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }],
  P2P_TIMEOUT_MS: 4000,      /* offer -> both channels open */
  P2P_DEAD_MS: 2500,         /* no pong for this long -> relay + re-negotiate */
  SUN_HZ_P2P: 50,            /* sun / orbit samples per second over the DataChannel */
  ACK_MIN_INTERVAL_P2P_MS: 30,
  P2P_ACK_FALLBACK_MS: 700,  /* a discrete command sent over P2P is re-sent over the relay if not acked in time */

  /* S2/S5 fallback when the 3D street cannot run (file://, no WebGL2): crossfade these PNGs exported by street3d.js.
     If any is missing, the 2D street.js is the last resort. */
  STREET_SNAPSHOTS: {
    dawn: 'screens/3d_v2_dawn.png',
    noon_off: 'screens/3d_v2_noon_off.png',
    noon_guard: 'screens/3d_v2_noon_guard.png',
    noon_all: 'screens/3d_v2_noon_all.png'
  },
  /* phone "rotate view" pad: degrees per full pad width (vertical: half of it) -> Street.orbitBy(dYawDeg, dPitchDeg) */
  ORBIT_SCALE: 180,
  ORBIT_HZ_RELAY: 20,
  ORBIT_HZ_NTFY: 0.5,
  /* commands older than this (server time) are ignored, e.g. replayed after a reconnect */
  CMD_MAX_AGE_S: 25,

  /* Cover (S1, organisers' template): project name = the problem, one line = what we do. Team may pick another variant:
     earlier: 'Armenia’s solar boom is hitting the wires' (metaphor) · 'Rooftop solar is pushing street voltage too high' /
              'A low-cost way to let Armenia’s streets take more rooftop solar — with safe voltage in every home.' */
  COVER_TITLE: 'Solar on the roof. Safe voltage at home.',
  COVER_LINE: 'At noon, rooftop solar pushes street voltage past the legal limit — appliances break and inverters shut down. A small box at the inverter keeps the home safe and the panels working.',
  COVER: {
    title: 'Rooftop solar is pushing street voltage too high',
    description: 'A low-cost way to let Armenia’s streets take more rooftop solar — with safe voltage in every home.',
    track: 'Smart Grid',
    team: 'Team “Grino”'
  },
  PRESENTER: 'Radik Grigoryan',
  /* edit names here only (feeds S1 TEAM and S11) */
  TEAM_FULL: ['Mikayel Sarkisyan', 'Vitaliy Sukhoplechev', 'Zakhar Shcherbakov', 'Ara Galstyan'],
  /* where each person studies — one small line under the name on the final slide, shown ONLY when all five are
     filled (otherwise names only). Keys = PRESENTER + TEAM_FULL. */
  TEAM_STUDY: {
    'Radik Grigoryan': '',
    'Mikayel Sarkisyan': 'Russian-Armenian University, ICT & Communication Systems',
    'Vitaliy Sukhoplechev': 'St Petersburg State University, Big Data and Distributed Digital Platforms',
    'Zakhar Shcherbakov': 'Russian-Armenian University, ICT & Communication Systems',
    'Ara Galstyan': 'Russian-Armenian University, Tourism'
  },

  /* screen ORDER (the deck orders its slides by this list); ids match the [S#] blocks of SPEECH_beta_EN.md.
     Number keys 1..9, 0 jump to positions 1..10. */
  SCREENS: [
    { id: 's1', name: 'Cover' },
    { id: 's2', name: 'Street at noon', sun: true },
    { id: 's3', name: 'The numbers', steps: true },
    { id: 's4', name: 'Why not fixed' },
    { id: 's5', name: 'SunGuard', sun: true, guard: true, steps: true },
    { id: 's8', name: 'Under $50', steps: true },
    { id: 's6', name: 'Problem-line map' },
    { id: 's7', name: 'Live demo', steps: true },
    { id: 's9', name: 'Who buys it' },
    { id: 's6b', name: 'Economics', steps: true },
    { id: 's10', name: 'Built in 24 h' },
    { id: 's10b', name: 'What works today' },
    { id: 's11', name: 'Ask & team' }
  ]
};

(function () {
  var p = new URLSearchParams(location.search);
  var g = window.GRINO;
  var k = (p.get('k') || '').trim();
  g.TOPIC = /^[A-Za-z0-9_-]{6,60}$/.test(k) ? k.toLowerCase() : '';   /* relay topics: [a-z0-9_-], + '-cmd' / '-ack' */
  var sd = (p.get('snapdir') || '').trim();   /* rehearsal/test: take the 3D snapshots from another folder */
  if (sd && /^(file:|https?:|[a-z0-9_.\/-]+$)/i.test(sd)) {
    if (!/\/$/.test(sd)) sd += '/';
    ['dawn', 'noon_off', 'noon_guard', 'noon_all'].forEach(function (n) { g.STREET_SNAPSHOTS[n] = sd + '3d_v2_' + n + '.png'; });
  }
  var u = (p.get('research') || '').trim();
  if (u && /^https?:\/\//.test(u)) g.FULL_RESEARCH_URL = u;
})();
