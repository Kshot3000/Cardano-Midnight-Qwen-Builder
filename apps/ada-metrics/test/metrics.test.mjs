import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fmt, priceView, statsView, PLACEHOLDER } from "../src/metrics.js";

// Real Blockchair /cardano/stats shape (live payload, 2026-10-03).
const BLOCKCHAIR = {
  blocks: 14020112,
  transactions: 124282902,
  blocks_24h: 4219,
  transactions_24h: 42263,
  circulation: 37107234581258214, // lovelace
  blockchain_size: 222541986130, // bytes
  best_block_epoch: 659,
  best_block_time: "2026-10-03 10:07:28",
};

test("fmt: placeholders for missing / non-finite values, never 'NaN'", () => {
  assert.equal(fmt(null), PLACEHOLDER);
  assert.equal(fmt(undefined), PLACEHOLDER);
  assert.equal(fmt(NaN), PLACEHOLDER);
  assert.equal(fmt(Infinity), PLACEHOLDER);
  assert.equal(fmt(-Infinity), PLACEHOLDER);
});

test("fmt: compact thresholds match the dashboard's historical output", () => {
  assert.equal(fmt(999), "999");
  assert.equal(fmt(1500), "1.5K");
  assert.equal(fmt(2500000), "2.50M");
  assert.equal(fmt(3000000000), "3.00B");
  assert.equal(fmt(1200000000000), "1.20T");
  assert.equal(fmt(42), "42");
});

test("fmt: sub-1 values use 4 decimals by default, explicit dec wins", () => {
  assert.equal(fmt(0.2441), "0.2441");
  assert.equal(fmt(0.5, 2), "0.50");
  assert.equal(fmt(0), "0.0000");
});

test("fmt: non-number values pass through as strings", () => {
  assert.equal(fmt("2026-10-03 10:07:28"), "2026-10-03 10:07:28");
});

test("priceView: full CoinGecko payload", () => {
  const v = priceView({ usd: 0.2441, usd_24h_change: 1.5, usd_market_cap: 9162448130 });
  assert.equal(v.price, "$0.2441");
  assert.deepEqual(v.change, { text: "▲ +1.50% (24h)", cls: "delta up" });
  assert.equal(v.mcap, "market cap 9.16B USD");
});

test("priceView: negative 24h change renders the down form", () => {
  const v = priceView({ usd: 0.2, usd_24h_change: -4.89776 });
  assert.equal(v.change.text, "▼ -4.90% (24h)");
  assert.equal(v.change.cls, "delta down");
});

test("priceView: missing fields degrade to placeholder / null change, no throw", () => {
  const v = priceView({});
  assert.equal(v.price, "$" + PLACEHOLDER);
  assert.equal(v.change, null);
  assert.equal(v.mcap, "");
  assert.equal(priceView(null).price, "$" + PLACEHOLDER);
  assert.equal(priceView({ usd: "0.25" }).price, "$" + PLACEHOLDER); // string price is not trusted as a number
});

test("statsView: real Blockchair payload renders exact tiles", () => {
  const tiles = Object.fromEntries(statsView(BLOCKCHAIR).map((t) => [t.label, t.value]));
  assert.equal(tiles["Block height"], "14.02M");
  assert.equal(tiles["Total transactions"], "124.28M");
  assert.equal(tiles["Blocks (24h)"], "4.2K");
  assert.equal(tiles["Transactions (24h)"], "42.3K");
  assert.equal(tiles["ADA in circulation"], "37.11B"); // lovelace / 1e6
  assert.equal(tiles["Chain size"], "222.54 GB");
  assert.equal(tiles["Current epoch"], "#659");
  assert.equal(tiles["Latest block time"], "2026-10-03 10:07:28");
});

test("statsView: missing circulation renders the placeholder, never 'NaN' (regression)", () => {
  const tiles = statsView({ blocks: 5 });
  const circ = tiles.find((t) => t.label === "ADA in circulation");
  assert.equal(circ.value, PLACEHOLDER);
  assert.ok(tiles.every((t) => t.value !== "NaN" && t.value !== "undefined"));
});

test("statsView: null payload yields 8 placeholder tiles in order", () => {
  const tiles = statsView(null);
  assert.equal(tiles.length, 8);
  assert.equal(tiles[0].label, "Block height");
  assert.ok(tiles.every((t) => t.value === PLACEHOLDER));
});

test("app.js: pill verdict waits for both fetches — no fixed-timer race (regression guard)", () => {
  const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(src.includes("Promise.all"), "load() must await both sources");
  assert.ok(!src.includes("setTimeout"), "no fixed-delay verdict timer may return");
  assert.ok(!src.includes("innerHTML"), "rendering must stay textContent-only");
});

test("index.html: app.js is a versioned module script (cache-bust on change)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.includes('type="module" src="app.js?v=2"'));
});
