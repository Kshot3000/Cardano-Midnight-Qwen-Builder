import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ascending,
  summarizePrivacy,
  trendGrowth,
  parseIncidentPayload,
  parseIncidents,
  privacyHealth,
  ageLabel,
  normalize,
} from "../src/privacy.js";

/* ---------------------------------------------------------------- *
 * Fixtures — real live data captured from
 * https://mainnet.nightforge.jp/api/analytics/privacy?hours=12
 * (2026-09-14) and .../hours=24 (2026-09-14).
 * ---------------------------------------------------------------- */

const LIVE_TREND_12H = [
  { hour: "2026-09-14 05:00:00", total: 20, unshielded: 0, shielded: 20 },
  { hour: "2026-09-14 06:00:00", total: 20, unshielded: 0, shielded: 20 },
  { hour: "2026-09-14 07:00:00", total: 14, unshielded: 0, shielded: 14 },
  { hour: "2026-09-14 08:00:00", total: 20, unshielded: 0, shielded: 20 },
  { hour: "2026-09-14 09:00:00", total: 16, unshielded: 0, shielded: 16 },
  { hour: "2026-09-14 10:00:00", total: 22, unshielded: 0, shielded: 22 },
  { hour: "2026-09-14 11:00:00", total: 58, unshielded: 0, shielded: 58 },
  { hour: "2026-09-14 12:00:00", total: 30, unshielded: 0, shielded: 30 },
  { hour: "2026-09-14 13:00:00", total: 26, unshielded: 0, shielded: 26 },
  { hour: "2026-09-14 14:00:00", total: 16, unshielded: 0, shielded: 16 },
  { hour: "2026-09-14 15:00:00", total: 38, unshielded: 1, shielded: 37 },
  { hour: "2026-09-14 16:00:00", total: 18, unshielded: 0, shielded: 18 },
];

const LIVE_PAYLOAD_STR =
  '{"spent":[{"address":"0xf11a5f87f65f00fdc05ee6e446943415a880f14f38aa52227fab81e4edb40018",' +
  '"tokenType":"0xf20622d00c823f89780baf971ef91ea3c64b238f4d11fa8473e4cb00d640ff82",' +
  '"intentHash":"0x966fadafdee0db472cf09b1583a8f995496514c78450265ee6d169be2b6e21cc",' +
  '"value":1,"outputNo":0}],"created":[{"address":"0xf11a5f87f65f00fdc05ee6e446943415a880f14f38aa52227fab81e4edb40018",' +
  '"tokenType":"0xf20622d00c823f89780baf971ef91ea3c64b238f4d11fa8473e4cb00d640ff82",' +
  '"intentHash":"0x10fa49c41ae58ebd72ba9c2634d63b5598189cdf0d2766eee1c98a18dedd702f",' +
  '"value":1,"outputNo":0}]}';

const LIVE_UNSHIELDED_DETAILS = [
  {
    block: 2580128,
    address: LIVE_PAYLOAD_STR,
    tokenType: null,
    value: null,
    timestamp: 1789399680,
  },
  // duplicate of the same tx — NightForge emits it twice; dedupe required
  {
    block: 2580128,
    address: LIVE_PAYLOAD_STR,
    tokenType: null,
    value: null,
    timestamp: 1789399680,
  },
];

const LIVE_12H = {
  totalMidnightTxs: 298,
  shielded: 297,
  unshielded: 1,
  contractDeploys: 2,
  contractCalls: 296,
  shieldedRatio: 0.9966,
  unshieldedDetails: LIVE_UNSHIELDED_DETAILS,
  trend: LIVE_TREND_12H,
  _hours: 12,
};

/* ---------------------------- ascending --------------------------- */

test("ascending: sorts newest-first input into chronological order", () => {
  const rows = [
    { hour: "2026-09-14 10:00:00", total: 1 },
    { hour: "2026-09-14 08:00:00", total: 2 },
    { hour: "2026-09-14 09:00:00", total: 3 },
  ];
  const a = ascending(rows);
  assert.deepEqual(a.map((r) => r.hour), [
    "2026-09-14 08:00:00",
    "2026-09-14 09:00:00",
    "2026-09-14 10:00:00",
  ]);
});

test("ascending: does not mutate its input and tolerates null", () => {
  const rows = [{ hour: "b" }, { hour: "a" }];
  const a = ascending(rows);
  assert.equal(a.length, 2);
  assert.equal(rows[0].hour, "b"); // input untouched
  assert.deepEqual(ascending(null), []);
});

/* ------------------------- summarizePrivacy ------------------------ */

test("summarizePrivacy: reproduces the live 12h payload exactly", () => {
  const s = summarizePrivacy(LIVE_12H);
  assert.equal(s.total, 298);
  assert.equal(s.shielded, 297);
  assert.equal(s.unshielded, 1);
  assert.equal(s.contractCalls, 296);
  assert.equal(s.contractDeploys, 2);
  assert.equal(s.hours, 12);
  // 20+20+14+20+16+22+58+30+26+16+38+18 = 298
  assert.equal(
    s.trend.reduce((x, r) => x + r.total, 0),
    298
  );
  assert.ok(Math.abs(s.ratio - 297 / 298) < 1e-12);
  // API-reported ratio vs recomputed: 0.9966 vs 0.996644...
  assert.ok(Math.abs(s.ratioDelta - (297 / 298 - 0.9966)) < 1e-9);
  assert.ok(Math.abs(s.ratioDelta) < 0.005); // passes the integrity check
  assert.equal(s.avgPerHour, 298 / 12);
  assert.equal(s.peakHour, 58);
  assert.equal(s.peakHourLabel, "2026-09-14 11:00:00");
});

test("summarizePrivacy: zero-tx window yields null ratio, no crash", () => {
  const s = summarizePrivacy({
    totalMidnightTxs: 0,
    shielded: 0,
    unshielded: 0,
    contractCalls: 0,
    contractDeploys: 0,
    shieldedRatio: null,
    trend: [],
  });
  assert.equal(s.ratio, null);
  assert.equal(s.reportedRatio, null);
  assert.equal(s.ratioDelta, null);
  assert.equal(s.avgPerHour, 0);
  assert.equal(s.peakHour, 0);
  assert.equal(s.peakHourLabel, null);
});

test("summarizePrivacy: tolerates null input", () => {
  const s = summarizePrivacy(null);
  assert.equal(s.total, 0);
  assert.equal(s.hours, 0);
});

test("summarizePrivacy: hourly buckets sum to the window total on live data", () => {
  const s = summarizePrivacy(LIVE_12H);
  assert.equal(
    s.trend.reduce((x, r) => x + (r.shielded || 0), 0),
    s.shielded
  );
  assert.equal(
    s.trend.reduce((x, r) => x + (r.unshielded || 0), 0),
    s.unshielded
  );
});

/* --------------------------- trendGrowth --------------------------- */

test("trendGrowth: 6h-vs-6h on the live 12h trend = +65.71% (186 vs 112)", () => {
  const g = trendGrowth(LIVE_TREND_12H, 6);
  assert.ok(g);
  assert.equal(g.last, 186); // 58+30+26+16+38+18
  assert.equal(g.prev, 112); // 20+20+14+20+16+22
  assert.ok(Math.abs(g.pct - (74 / 112) * 100) < 1e-9);
  assert.equal(g.windowHours, 6);
});

test("trendGrowth: returns null when history is shorter than 2x window", () => {
  assert.equal(trendGrowth(LIVE_TREND_12H, 12), null);
  assert.equal(trendGrowth([{ hour: "a", total: 5 }], 2), null);
  assert.equal(trendGrowth([], 1), null);
});

test("trendGrowth: returns null when the earlier window is empty", () => {
  const rows = [
    { hour: "2026-01-01 00:00:00", total: 0 },
    { hour: "2026-01-01 01:00:00", total: 0 },
    { hour: "2026-01-01 02:00:00", total: 10 },
    { hour: "2026-01-01 03:00:00", total: 10 },
  ];
  assert.equal(trendGrowth(rows, 2), null);
});

test("trendGrowth: works on newest-first input too", () => {
  const newestFirst = [...LIVE_TREND_12H].reverse();
  const g = trendGrowth(newestFirst, 6);
  assert.ok(g);
  assert.ok(Math.abs(g.pct - (74 / 112) * 100) < 1e-9);
});

/* ------------------------ parseIncidentPayload --------------------- */

test("parseIncidentPayload: parses the real live payload string byte-for-byte", () => {
  const p = parseIncidentPayload(LIVE_PAYLOAD_STR);
  assert.ok(p);
  assert.equal(p.spent.length, 1);
  assert.equal(p.created.length, 1);
  assert.equal(p.spent[0].address, "0xf11a5f87f65f00fdc05ee6e446943415a880f14f38aa52227fab81e4edb40018");
  assert.equal(p.spent[0].tokenType, "0xf20622d00c823f89780baf971ef91ea3c64b238f4d11fa8473e4cb00d640ff82");
  assert.equal(p.spentValue, 1);
  assert.equal(p.createdValue, 1);
  assert.equal(p.uniqueTokens, 1);
  assert.equal(p.uniqueAddresses, 1);
  assert.deepEqual(p.tokenTypes, [
    "0xf20622d00c823f89780baf971ef91ea3c64b238f4d11fa8473e4cb00d640ff82",
  ]);
});

test("parseIncidentPayload: accepts an already-parsed object", () => {
  const p = parseIncidentPayload(JSON.parse(LIVE_PAYLOAD_STR));
  assert.ok(p);
  assert.equal(p.spentValue, 1);
  assert.equal(p.createdValue, 1);
});

test("parseIncidentPayload: rejects null, garbage, and missing legs", () => {
  assert.equal(parseIncidentPayload(null), null);
  assert.equal(parseIncidentPayload("not-json{"), null);
  assert.equal(parseIncidentPayload("{}"), null);
  assert.equal(parseIncidentPayload({ spent: [] }), null); // no created leg
});

test("parseIncidentPayload: multi-entry legs sum values and dedupe tokens", () => {
  const raw = {
    spent: [
      { address: "0xa", tokenType: "0xT1", value: 5, outputNo: 0 },
      { address: "0xb", tokenType: "0xT2", value: 7, outputNo: 0 },
      { address: "0xa", tokenType: "0xT1", value: 3, outputNo: 1 },
    ],
    created: [{ address: "0xc", tokenType: "0xT1", value: 15, outputNo: 0 }],
  };
  const p = parseIncidentPayload(raw);
  assert.equal(p.spentValue, 15);
  assert.equal(p.createdValue, 15);
  assert.equal(p.uniqueTokens, 2); // T1, T2
  assert.equal(p.uniqueAddresses, 3); // a, b, c
});

/* ---------------------------- parseIncidents ----------------------- */

test("parseIncidents: dedupes the live double-emitted tx to a single incident", () => {
  const r = parseIncidents(LIVE_UNSHIELDED_DETAILS);
  assert.equal(r.count, 1);
  assert.equal(r.incidents.length, 1);
  assert.equal(r.uniqueBlocks, 1);
  assert.equal(r.uniqueTokens, 1);
  assert.equal(r.totalValue, 2); // spent 1 + created 1
  assert.equal(r.latestTimestamp, 1789399680);
  assert.equal(r.incidents[0].block, 2580128);
  assert.ok(r.incidents[0].payload);
});

test("parseIncidents: sorts newest-first by timestamp then block", () => {
  const rows = [
    { block: 10, address: null, timestamp: 100 },
    { block: 20, address: null, timestamp: 300 },
    { block: 15, address: null, timestamp: 200 },
  ];
  const r = parseIncidents(rows);
  assert.deepEqual(r.incidents.map((i) => i.block), [20, 15, 10]);
});

test("parseIncidents: tolerates null and keeps malformed payloads as null", () => {
  assert.deepEqual(parseIncidents(null), {
    incidents: [],
    count: 0,
    uniqueBlocks: 0,
    uniqueTokens: 0,
    latestTimestamp: null,
    totalValue: 0,
  });
  const r = parseIncidents([{ block: 1, address: "garbage{", timestamp: 5 }]);
  assert.equal(r.count, 1);
  assert.equal(r.incidents[0].payload, null);
});

/* --------------------------- privacyHealth ------------------------- */

test("privacyHealth: live 24h-style window scores 100 (all five checks pass)", () => {
  // Real 24h capture: 605 tx, 600 shielded, 5 unshielded (0.83%), ratio 0.9917
  const s = {
    total: 605,
    ratio: 600 / 605,
    unshielded: 5,
    ratioDelta: 600 / 605 - 0.9917, // ~ -0.000046 -> within 0.5pp
    growth: { pct: 10 }, // within +/-25
  };
  const h = privacyHealth(s);
  assert.equal(h.score, 100);
  assert.equal(h.status, "healthy");
  assert.ok(h.checks.every((c) => c.pass));
  assert.equal(h.checks.length, 5);
});

test("privacyHealth: each check fails independently with exact points", () => {
  const full = {
    total: 500,
    ratio: 0.99,
    unshielded: 2,
    ratioDelta: 0.001,
    growth: { pct: 0 },
  };
  assert.equal(privacyHealth(full).score, 100);

  // +35: shielding below 95%
  assert.equal(
    privacyHealth({ ...full, ratio: 0.90 }).score,
    65
  );
  // +20: activity under 100 tx
  assert.equal(
    privacyHealth({ ...full, total: 40, unshielded: 0, ratio: 0.99 }).score,
    80
  );
  // +20: growth outside +/-25%
  assert.equal(
    privacyHealth({ ...full, growth: { pct: 40 } }).score,
    80
  );
  // +20: no growth data at all (insufficient history)
  assert.equal(
    privacyHealth({ ...full, growth: null }).score,
    80
  );
  // +15: unshielded above 1%
  assert.equal(
    privacyHealth({ ...full, unshielded: 10, ratio: 490 / 500 }).score,
    85
  );
  // +10: ratio disagrees with API-reported by more than 0.5pp
  assert.equal(
    privacyHealth({ ...full, ratioDelta: 0.02 }).score,
    90
  );
});

test("privacyHealth: status bands are 80/50/25", () => {
  // 0 pts -> critical (unshielded-rare trivially passes at 0 tx: +15 = 15 < 25)
  assert.equal(privacyHealth({ total: 0 }).score, 15);
  assert.equal(privacyHealth({ total: 0 }).status, "critical");
  // 35+20+0+0+10 = 65 -> degraded
  const degraded = privacyHealth({ total: 500, ratio: 0.99, unshielded: 10, ratioDelta: 0.001, growth: null });
  assert.equal(degraded.score, 65);
  assert.equal(degraded.status, "degraded");
  // 20+15 = 35 -> watch
  const watch = privacyHealth({ total: 500, ratio: 0.90, unshielded: 2, ratioDelta: 0.02, growth: null });
  assert.equal(watch.score, 35);
  assert.equal(watch.status, "watch");
});

test("privacyHealth: tolerates null input", () => {
  const h = privacyHealth(null);
  assert.equal(h.score, 15); // only the trivially-true "unshielded rare" check
  assert.equal(h.status, "critical");
});

/* ----------------------------- ageLabel ---------------------------- */

test("ageLabel: seconds/minutes/hours/days ladder and clamping", () => {
  const now = 2_000_000;
  assert.equal(ageLabel(now - 10, now), "10s ago");
  assert.equal(ageLabel(now - 60 * 30, now), "30m ago");
  assert.equal(ageLabel(now - 3600 * 5, now), "5h ago");
  assert.equal(ageLabel(now - 3600 * 24 * 3, now), "3d ago");
  assert.equal(ageLabel(now + 100, now), "0s ago"); // future clamps to now
  assert.equal(ageLabel(0, now), "—");
});

/* ----------------------------- normalize --------------------------- */

test("normalize: min-max scaling, flat series, empty input", () => {
  assert.deepEqual(normalize([0, 50, 100]), [0, 50, 100]);
  assert.deepEqual(normalize([7, 7, 7]), [50, 50, 50]);
  assert.deepEqual(normalize([]), []);
  assert.deepEqual(normalize([10, 20]), [0, 100]);
});
