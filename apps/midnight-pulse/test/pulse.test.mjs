import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fmt, statsView, eventRows, blockRows, PLACEHOLDER } from "../src/pulse.js";

// Real NightForge /analytics/overview shape (live payload, 2026-10-03).
const OVERVIEW = {
  network: "Midnight Mainnet",
  blocks: 2849362,
  avgBlockTime: 6,
  tps: 0.252,
  shieldedRatio: 0.7904,
  midnightTxs: 134180,
  bridgeOps: 977995,
  committeeSize: 13,
  contractDeploys: 1963,
  contractCalls: 95077,
  eventBreakdown: [
    { section: "system", method: "ExtrinsicSuccess", count: 16244554 },
    { section: "midnight", method: "TxApplied", count: 261989 },
  ],
};

test("fmt: placeholders for missing / non-finite values, never 'NaN'", () => {
  assert.equal(fmt(null), PLACEHOLDER);
  assert.equal(fmt(undefined), PLACEHOLDER);
  assert.equal(fmt(NaN), PLACEHOLDER);
  assert.equal(fmt(Infinity), PLACEHOLDER);
});

test("fmt: compact thresholds match the dashboard's historical output", () => {
  assert.equal(fmt(2849362), "2.85M");
  assert.equal(fmt(134180), "134.2K");
  assert.equal(fmt(95077), "95.1K");
  assert.equal(fmt(0.252), "0.25");
  assert.equal(fmt(13), "13");
});

test("statsView: real overview payload renders exact tiles", () => {
  const tiles = Object.fromEntries(statsView(OVERVIEW).map((t) => [t.label, t.value]));
  assert.equal(tiles["Blocks"], "2.85M");
  assert.equal(tiles["Avg block time"], "6s");
  assert.equal(tiles["TPS (avg)"], "0.252");
  assert.equal(tiles["Shielded ratio"], "79.0%");
  assert.equal(tiles["Midnight txs"], "134.2K");
  assert.equal(tiles["Bridge ops"], "978.0K");
  assert.equal(tiles["Committee size"], "13");
  assert.equal(tiles["Contract deploys"], "2.0K");
  assert.equal(tiles["Contract calls"], "95.1K");
});

test("statsView: missing fields degrade to placeholders, 10 tiles always", () => {
  const tiles = statsView({});
  assert.equal(tiles.length, 10);
  assert.ok(tiles.every((t) => t.value === PLACEHOLDER));
  assert.equal(statsView(null).length, 10);
});

test("statsView: non-numeric tps / shieldedRatio are placeholders, not crashes", () => {
  const tiles = Object.fromEntries(statsView({ tps: "fast", shieldedRatio: NaN }).map((t) => [t.label, t.value]));
  assert.equal(tiles["TPS (avg)"], PLACEHOLDER);
  assert.equal(tiles["Shielded ratio"], PLACEHOLDER);
});

test("eventRows: names join section.method, top event bars at 100%, counts formatted", () => {
  const rows = eventRows(OVERVIEW.eventBreakdown);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "system.ExtrinsicSuccess");
  assert.equal(rows[0].pct, 100);
  assert.equal(rows[0].countLabel, "16.24M");
  assert.equal(rows[1].name, "midnight.TxApplied");
  assert.equal(rows[1].pct, 2); // tiny share clamps to the 2% minimum sliver
});

test("eventRows: caps at 12 rows and tolerates junk input", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ section: "s" + i, method: "m", count: i }));
  assert.equal(eventRows(many).length, 12);
  assert.deepEqual(eventRows(null), []);
  assert.deepEqual(eventRows("nope"), []);
  assert.deepEqual(eventRows([null])[0], { name: "?.?", countLabel: PLACEHOLDER, pct: 2 });
});

test("eventRows: API markup payload stays inert data (regression: was innerHTML)", () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const rows = eventRows([{ section: evil, method: "M", count: 5 }]);
  // The view-model returns the string untouched; app.js assigns it via
  // textContent, so it can only ever display as literal text.
  assert.equal(rows[0].name, evil + ".M");
});

test("blockRows: hash truncates to 22 chars + ellipsis, time/ext formatted", () => {
  const rows = blockRows([{ height: 2850356, hash: "0x2bf0e6eb581c32c5cb009a9ff5b35ca1466f1a778eea60939", timestamp: 1791022068, extrinsics_count: 3 }]);
  assert.equal(rows[0].height, "#2850356");
  assert.equal(rows[0].hash, "0x2bf0e6eb581c32c5cb00…");
  assert.equal(rows[0].time, new Date(1791022068 * 1000).toLocaleString());
  assert.equal(rows[0].ext, "3 ext");
});

test("blockRows: missing fields degrade, caps at 8, junk tolerated", () => {
  assert.deepEqual(blockRows(null), []);
  const rows = blockRows([{}]);
  assert.equal(rows[0].height, "#" + PLACEHOLDER);
  assert.equal(rows[0].hash, PLACEHOLDER);
  assert.equal(rows[0].time, PLACEHOLDER);
  assert.equal(rows[0].ext, "");
  const many = Array.from({ length: 10 }, (_, i) => ({ height: i }));
  assert.equal(blockRows(many).length, 8);
});

test("app.js: no innerHTML anywhere — API data renders via textContent only (regression guard)", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(!src.includes("innerHTML"), "innerHTML must not return; API strings are untrusted");
  assert.ok(src.includes("textContent"));
});

test("index.html: app.js is a versioned module script (cache-bust on change)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes('type="module" src="app.js?v=2"'));
});
