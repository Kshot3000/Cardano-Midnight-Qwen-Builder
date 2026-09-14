// poolid.test.mjs — unit tests for the Cardano stake-pool ID codec.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POOL_ID_BYTES,
  bech32Encode,
  bech32Decode,
  hexToPoolId,
  poolIdToHex,
  normalizePoolId,
  bytesToHex,
  hexToBytes,
} from "../src/poolid.js";

// Real, live mainnet pool ids captured 2026-09-14 from
// data.cardano.org/k/api/v1/pool_list (Koios keyless API).
const POOL_A_BECH32 = "pool1c8k78ny3xvsfgenhf4yzvpzwgzxmz0t0um0h2xnn2q83vjdr5dj";
const POOL_A_HEX = "c1ede3cc9133209466774d4826044e408db13d6fe6df751a73500f16";
const POOL_B_BECH32 = "pool1rhew9hdp6wpudh22k7gyjtv98r872hca064n8ug8lk3j65ae59a"; // ticker HAX
const POOL_B_HEX = "1df2e2dda1d383c6dd4ab790492d8538cfe55f1d7eab33f107fda32d";

test("POOL_ID_BYTES is 28 (56 hex chars)", () => {
  assert.equal(POOL_ID_BYTES, 28);
});

test("hexToPoolId round-trips the known live pool A", () => {
  assert.equal(hexToPoolId(POOL_A_HEX), POOL_A_BECH32);
});

test("poolIdToHex round-trips pool A back to the Koios hex", () => {
  assert.equal(poolIdToHex(POOL_A_BECH32), POOL_A_HEX);
});

test("round-trip also holds for pool B", () => {
  assert.equal(poolIdToHex(POOL_B_BECH32), POOL_B_HEX);
  assert.equal(hexToPoolId(POOL_B_HEX), POOL_B_BECH32);
});

test("poolIdToHex accepts the uppercase bech32 form (we lowercase internally)", () => {
  assert.equal(poolIdToHex(POOL_A_BECH32.toUpperCase()), POOL_A_HEX);
});

test("poolIdToHex rejects a wrong hrp (addr1…)", () => {
  // Build a valid bech32 string with hrp "addr" over the same 28-byte payload.
  const addrForm = bech32Encode("addr", hexToBytes(POOL_A_HEX));
  assert.match(addrForm, /^addr1/);
  assert.throws(() => poolIdToHex(addrForm), /hrp/);
});

test("poolIdToHex rejects a bad checksum", () => {
  // Flip the final char to break the checksum.
  const bad = POOL_A_BECH32.slice(0, -1) + (POOL_A_BECH32.endsWith("j") ? "k" : "j");
  assert.throws(() => poolIdToHex(bad), /bad-checksum/);
});

test("bech32Encode is deterministic", () => {
  const a = bech32Encode("pool", hexToBytes(POOL_A_HEX));
  const b = bech32Encode("pool", hexToBytes(POOL_A_HEX));
  assert.equal(a, b);
  assert.equal(a, POOL_A_BECH32);
});

test("bech32Decode flags an over-long string as too-long", () => {
  const d = bech32Decode("pool1" + "q".repeat(140));
  assert.equal(d.error, "too-long");
});

test("bech32Decode flags a string with no separator", () => {
  const d = bech32Decode("nope");
  assert.equal(d.error, "no-separator");
});

test("bech32Decode: valid string → hrp + data groups", () => {
  const d = bech32Decode(POOL_A_BECH32);
  assert.equal(d.error, undefined);
  assert.equal(d.hrp, "pool");
  assert.ok(d.data.length > 6);
});

test("bytesToHex / hexToBytes are exact inverses", () => {
  assert.equal(bytesToHex(hexToBytes(POOL_A_HEX)), POOL_A_HEX);
  assert.equal(hexToBytes(POOL_A_HEX).length, 28);
});

test("hexToPoolId throws on short hex", () => {
  assert.throws(() => hexToPoolId("abc"), /56 hex/);
});

test("hexToPoolId throws on non-hex chars", () => {
  assert.throws(() => hexToPoolId("z".repeat(56)), /56 hex/);
});

test("normalizePoolId: bech32 in → both out", () => {
  const r = normalizePoolId(POOL_A_BECH32);
  assert.equal(r.ok, true);
  assert.equal(r.bech32, POOL_A_BECH32);
  assert.equal(r.hex, POOL_A_HEX);
});

test("normalizePoolId: uppercase bech32 in → lowercased out", () => {
  const r = normalizePoolId(POOL_A_BECH32.toUpperCase());
  assert.equal(r.ok, true);
  assert.equal(r.bech32, POOL_A_BECH32);
  assert.equal(r.hex, POOL_A_HEX);
});

test("normalizePoolId: hex in → both out", () => {
  const r = normalizePoolId(POOL_A_HEX);
  assert.equal(r.ok, true);
  assert.equal(r.bech32, POOL_A_BECH32);
  assert.equal(r.hex, POOL_A_HEX);
});

test("normalizePoolId: hex in uppercase → lowercased hex out", () => {
  const r = normalizePoolId(POOL_A_HEX.toUpperCase());
  assert.equal(r.ok, true);
  assert.equal(r.hex, POOL_A_HEX);
});

test("normalizePoolId: surrounding whitespace is trimmed", () => {
  const r = normalizePoolId("  " + POOL_A_BECH32 + "\n");
  assert.equal(r.ok, true);
  assert.equal(r.bech32, POOL_A_BECH32);
});

test("normalizePoolId: empty → empty reason", () => {
  assert.deepEqual(normalizePoolId(""), { ok: false, reason: "empty" });
  assert.deepEqual(normalizePoolId("   "), { ok: false, reason: "empty" });
  assert.equal(normalizePoolId(null).ok, false);
});

test("normalizePoolId: bad checksum → not ok", () => {
  const bad = POOL_A_BECH32.slice(0, -1) + (POOL_A_BECH32.endsWith("j") ? "k" : "j");
  assert.equal(normalizePoolId(bad).ok, false);
});

test("normalizePoolId: addr hrp → not ok (bad hrp)", () => {
  const addrForm = bech32Encode("addr", hexToBytes(POOL_A_HEX));
  const r = normalizePoolId(addrForm);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-hrp");
});

test("normalizePoolId: random text → unknown-format", () => {
  const r = normalizePoolId("not a pool id");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-format");
});

test("normalizePoolId: short 8-hex → unknown-format (not a valid pool id)", () => {
  const r = normalizePoolId("deadbeef");
  assert.equal(r.ok, false);
});

test("round-trip through a fresh generated 28-byte pool id", () => {
  // Build a new 28-byte id with a different payload.
  const bytes = Array.from({ length: 28 }, (_, i) => (i * 17 + 3) & 0xff);
  const hex = bytesToHex(bytes);
  const enc = hexToPoolId(hex);
  assert.equal(enc.startsWith("pool1"), true);
  assert.equal(poolIdToHex(enc), hex);
  const n = normalizePoolId(enc);
  assert.equal(n.ok, true);
  assert.equal(n.hex, hex);
});

test("normalizePoolId: generic bech32 with 'pool' hrp and 28-byte payload ok", () => {
  // Same shape as the pool1… path but constructed via the generic branch.
  const r = normalizePoolId(POOL_B_BECH32);
  assert.equal(r.ok, true);
  assert.equal(r.hex, POOL_B_HEX);
});
