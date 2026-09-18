import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isValidHash,
  isValidHeight,
  parseQuery,
  blockView,
  formatTime,
  shortHash,
  formatAge,
  topBlocks,
} from "../src/midnight.js";

const H = "0x718685e4c8fe68a9ec946c3fe66836576f98726f02a29ee71068686ce6d48df0";

test("isValidHash accepts real Midnight block hashes", () => {
  assert.equal(isValidHash(H), true);
  assert.equal(isValidHash(H.slice(2)), true); // without 0x
  assert.equal(isValidHash(H.toUpperCase()), true);
});

test("isValidHash rejects junk", () => {
  assert.equal(isValidHash("hello"), false);
  assert.equal(isValidHash("0x123"), false); // too short
  assert.equal(isValidHash("0x12345"), false); // odd hex length
  assert.equal(isValidHash(""), false);
  assert.equal(isValidHash(null), false);
  assert.equal(isValidHash("0xzzzzzzzzzz"), false);
});

test("isValidHeight accepts numbers and numeric strings", () => {
  assert.equal(isValidHeight(2632648), true);
  assert.equal(isValidHeight("2632648"), true);
  assert.equal(isValidHeight("0"), true);
  assert.equal(isValidHeight("1e5"), false);
  assert.equal(isValidHeight("-3"), false);
  assert.equal(isValidHeight("abc"), false);
  assert.equal(isValidHeight(3.5), false);
});

test("parseQuery classifies hash vs height", () => {
  assert.deepEqual(parseQuery(H), { kind: "hash", value: H });
  assert.deepEqual(parseQuery("2632648"), { kind: "height", value: 2632648 });
  assert.equal(parseQuery("   "), null);
  assert.equal(parseQuery("not a query"), null);
  assert.equal(parseQuery(null), null);
});

test("blockView extracts display fields defensively", () => {
  const b = {
    height: 2632648,
    hash: H,
    timestamp: 1789714998,
    extrinsics_count: 3,
    parent_hash: "0xabc",
    state_root: "0xdef",
  };
  const v = blockView(b);
  assert.equal(v.height, 2632648);
  assert.equal(v.hash, H);
  assert.equal(v.timestamp, 1789714998);
  assert.equal(v.extrinsicsCount, 3);
  assert.equal(blockView(null), null);
  assert.equal(blockView({}), null);
});

test("formatTime renders UTC seconds", () => {
  assert.equal(formatTime(1789714998), new Date(1789714998000).toISOString().replace("T", " ").slice(0, 19) + " UTC");
  assert.equal(formatTime(null), "–");
  assert.equal(formatTime("nope"), "–");
});

test("shortHash truncates long hashes", () => {
  const s = shortHash(H);
  assert.ok(s.startsWith("0x718685e4"));
  assert.ok(s.endsWith("d48df0"));
  assert.equal(shortHash("0x1234567890abcdef"), "0x1234567890abcdef"); // short enough
  assert.equal(shortHash(null), "–");
});

test("formatAge humanizes gaps", () => {
  assert.equal(formatAge(1000, 1060), "60s");
  assert.equal(formatAge(1000, 1005), "5s");
  assert.equal(formatAge(1000, 1000 + 3661), "61m 1s"); // < 90m stays in minutes
  assert.equal(formatAge(1000, 1000 + 7261), "2h 1m");
  assert.equal(formatAge(1000, 999), "0s"); // clamped
  assert.equal(formatAge(null, 1000), "–");
});

test("topBlocks slices and maps rows", () => {
  const rows = [
    { height: 2, hash: "0xaaaaaaaaaaaaaaaa", timestamp: 2, extrinsics_count: 1 },
    { height: 1, hash: "0xbbbbbbbbbbbbbbbb", timestamp: 1, extrinsics_count: 2 },
    { junk: true },
  ];
  const t = topBlocks(rows, 10);
  assert.equal(t.length, 2);
  assert.equal(t[0].height, 2);
  assert.equal(topBlocks(rows, 1).length, 1);
  assert.deepEqual(topBlocks(null, 5), []);
  assert.deepEqual(topBlocks(rows, 0), []);
});
