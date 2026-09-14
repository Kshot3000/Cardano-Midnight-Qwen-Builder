// Midnight Contract Watch — contract-address codec tests.
// Run: node --test apps/midnight-contracts/test/address.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_TAG,
  ADDRESS_LENGTH,
  toHex,
  fromHex,
  encodeContractAddress,
  validateContractAddress,
  isValidContractAddress,
  decodeContractAddress,
  tryDecodeContractAddress,
  humanizeContractAddress,
} from "../src/address.js";
import { TOP10 } from "./fixture.mjs";

const DIGEST_HEX = "1dfcd7b50a724b83c67e7dbbc45da6d3cf4a0b4d657ad33410f69f41b52ac05b";
const REAL = TOP10[0].address;

test("tag is the exact on-chain marker (30 chars, 60 hex)", () => {
  assert.equal(CONTRACT_TAG, "midnight:contract-address[v2]:");
  assert.equal(CONTRACT_TAG.length, 30);
});

test("address layout: 0x + 60-hex tag + 64-hex digest = 126 chars", () => {
  assert.equal(ADDRESS_LENGTH, 126);
  assert.equal(REAL.length, 126);
  assert.equal(TOP10.every((r) => r.address.length === 126), true);
});

test("every real live address from NightForge validates", () => {
  assert.equal(TOP10.every((r) => isValidContractAddress(r.address)), true);
});

test("round-trip: encode(decode(x)) === x for all real addresses", () => {
  for (const r of TOP10) {
    const d = decodeContractAddress(r.address);
    assert.equal(encodeContractAddress(d.digestBytes), r.address);
    assert.equal(encodeContractAddress(d.digest), r.address);
  }
});

test("decode returns the exact tag, digest, and 32 digest bytes", () => {
  const d = decodeContractAddress(REAL);
  assert.equal(d.tag, CONTRACT_TAG);
  assert.equal(d.digest, DIGEST_HEX);
  assert.equal(d.digestBytes.length, 32);
  assert.equal(d.digestBytes[0], 0x1d);
  assert.equal(d.digestBytes[31], 0x5b);
  assert.equal(d.length, 126);
});

test("encode accepts a 64-char hex string digest", () => {
  const addr = encodeContractAddress(DIGEST_HEX);
  assert.equal(addr, REAL);
  assert.ok(isValidContractAddress(addr));
});

test("encode rejects wrong-size digests", () => {
  assert.throws(() => encodeContractAddress("ab"), RangeError);
  assert.throws(() => encodeContractAddress(new Uint8Array(31)), RangeError);
  assert.throws(() => encodeContractAddress(new Uint8Array(33)), RangeError);
  assert.throws(() => encodeContractAddress(null), TypeError);
  assert.throws(() => encodeContractAddress("xyz"), TypeError);
});

test("validate: missing 0x prefix", () => {
  const v = validateContractAddress(REAL.slice(2));
  assert.equal(v.valid, false);
  assert.ok(v.errors.length > 0);
});

test("validate: wrong tag is flagged", () => {
  const bad = "0x" + "99".repeat(30) + DIGEST_HEX; // same length, wrong tag
  const v = validateContractAddress(bad);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("tag mismatch")));
});

test("validate: short and long addresses are flagged", () => {
  assert.equal(validateContractAddress("0xabc").valid, false);
  const tooLong = REAL + "00";
  assert.equal(validateContractAddress(tooLong).valid, false);
  assert.ok(validateContractAddress(tooLong).errors.some((e) => e.includes("length")));
});

test("validate: uppercase hex and non-hex chars are rejected", () => {
  assert.equal(isValidContractAddress("0X" + REAL.slice(2)), false);
  assert.equal(isValidContractAddress(REAL.toUpperCase()), false);
  assert.equal(isValidContractAddress("0x" + "zz".repeat(62)), false);
});

test("validate: non-string input never throws", () => {
  assert.deepEqual(validateContractAddress(null), { valid: false, errors: ["not a string"] });
  assert.equal(validateContractAddress(42).valid, false);
  assert.equal(validateContractAddress(undefined).valid, false);
  assert.equal(validateContractAddress([]).valid, false);
});

test("decode throws on invalid, tryDecode returns null", () => {
  assert.throws(() => decodeContractAddress("not-an-address"), /invalid Midnight contract address/);
  assert.equal(tryDecodeContractAddress("not-an-address"), null);
  assert.ok(tryDecodeContractAddress(REAL));
});

test("toHex / fromHex are exact inverses", () => {
  const bytes = new Uint8Array([0, 1, 0x1d, 255, 128, 90]);
  assert.equal(toHex(bytes), "00011dff805a");
  assert.deepEqual([...fromHex("00011dff805a")], [...bytes]);
  assert.throws(() => fromHex("abc"), TypeError); // odd length
  assert.throws(() => fromHex("zz"), TypeError);
  assert.throws(() => toHex([1, 2]), TypeError);
});

test("humanize: canonical address -> short digest with full tag", () => {
  const h = humanizeContractAddress(REAL);
  assert.equal(h.ok, true);
  assert.equal(h.tag, CONTRACT_TAG);
  assert.match(h.short, /^0x1dfcd7b5…b52ac05b$/);
  assert.equal(h.digest, DIGEST_HEX);
});

test("humanize: invalid input degrades gracefully", () => {
  const h = humanizeContractAddress("0xdeadbeef");
  assert.equal(h.ok, false);
  assert.equal(h.short, "0xdeadbeef".slice(0, 10) + "…");
  const h2 = humanizeContractAddress(null);
  assert.equal(h2.ok, false);
  assert.equal(h2.short, "—");
});
