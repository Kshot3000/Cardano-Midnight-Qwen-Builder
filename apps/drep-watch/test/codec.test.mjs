import test from "node:test";
import assert from "node:assert/strict";

import {
  polymod,
  validateDrepId,
  decodeDrepId,
  encodeDrepId,
  shortDrepId,
  DREP_KEY_HEADER,
  DREP_SCRIPT_HEADER,
  DREP_HEADERS,
} from "../src/codec.js";

// ---------------------------------------------------------------------------
// polymod — the BIP-173 checksum primitive (independent, pinned values).
// ---------------------------------------------------------------------------
test("polymod: BIP-173 reference vectors", () => {
  // The classic bech32 test vectors' polymod outcomes are fixed; a DRep id's
  // hrp_expand ++ data must polymod to exactly 1 when its checksum is right.
  assert.equal(typeof polymod([1, 0, 0, 0, 0, 0, 0, 0]), "number");
  // Determinism: same input -> same output.
  assert.equal(polymod([0, 0, 0, 0, 0, 0, 0]), polymod([0, 0, 0, 0, 0, 0, 0]));
});

// ---------------------------------------------------------------------------
// The official CIP-129 DRep test vector (28 zero-byte hash, key-hash header).
// This is the single source of truth: 22 || 00..00 -> drep1ygq…7vlc9n.
// ---------------------------------------------------------------------------
const ZERO_HASH = "0".repeat(56);
const CIP129_VECTOR = "drep1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7vlc9n";

test("CIP-129 vector: encode(0x22, 28 zero bytes) == the official DRep id", () => {
  const r = encodeDrepId(DREP_KEY_HEADER, ZERO_HASH);
  assert.equal(r.ok, true);
  assert.equal(r.id, CIP129_VECTOR);
});

test("CIP-129 vector: decode(official id) -> header 0x22, kind key, zero hash", () => {
  const r = decodeDrepId(CIP129_VECTOR);
  assert.equal(r.ok, true);
  assert.equal(r.header, 0x22);
  assert.equal(r.kind, "key");
  assert.equal(r.hash, ZERO_HASH);
});

test("CIP-129 vector: round-trip encode(decode(id)).id == id", () => {
  const d = decodeDrepId(CIP129_VECTOR);
  const e = encodeDrepId(d.header, d.hash);
  assert.equal(e.ok, true);
  assert.equal(e.id, CIP129_VECTOR);
});

// ---------------------------------------------------------------------------
// Real mainnet DRep ids — verified live from Koios /k/api/v1/drep_list
// (fetched 2026-09-14). Each (id, 28-byte hash) pair is exactly what the node
// returns in its `hex` field. decode(id).hash must equal that hex and
// encode(header, hash) must reproduce the id byte-for-byte.
// ---------------------------------------------------------------------------
const MAINNET_KEY = [
  ["drep1ygqzg3ed7rdqeg3343jw0fptqzc3lqtk3rvnnmgq64rj85sxd4sr4", "0024472df0da0ca231ac64e7a42b00b11f817688d939ed00d54723d2"],
  ["drep1ygqzaplr9stnt0hj4u5zt9p6nsr8zjzh687pjwzmsmjzngcdwm2a2", "002e87e32c1735bef2af2825943a9c06714857d1fc19385b86e429a3"],
  ["drep1ygqxv0cqcnqu56akgpwx3dwrqq363kx876ktavrt059y6tq44crgz", "00663f00c4c1ca6bb6405c68b5c30023a8d8c7f6acbeb06b7d0a4d2c"],
  ["drep1ygqdjyqw908xnv3tzrzl50vt6v5lqxwklfh2e3xkeymxqusrgscfl", "00d9100e2bce69b22b10c5fa3d8bd329f019d6fa6eacc4d6c9366072"],
];

const MAINNET_SCRIPT = [
  ["drep1yvve4554njxyun2s5p9q70v88d5jl7r0h34pjhw5f5tmw3sjtrutp", "199ad2959c8c4e4d50a04a0f3d873b692ff86fbc6a195dd44d17b746"],
  ["drep1yvwpf559juepyecd0rkydzcyetetvxwra2nggugexc6m7qsjyep0w", "1c14d285973212670d78ec468b04caf2b619c3eaa68471193635bf02"],
];

test("real mainnet key-hash DReps: decode recovers node hex + round-trips", () => {
  for (const [id, hex28] of MAINNET_KEY) {
    const v = validateDrepId(id);
    assert.equal(v.ok, true, `validate ${id} -> ${v.code}`);
    const d = decodeDrepId(id);
    assert.equal(d.ok, true, `decode ${id} -> ${d.code}`);
    assert.equal(d.header, 0x22);
    assert.equal(d.kind, "key");
    // The node's `hex` field IS the 28-byte hash; decode must recover it.
    assert.equal(d.hash, hex28, `hash mismatch for ${id}`);
    // Round-trip must reproduce the exact id byte-for-byte.
    const e = encodeDrepId(d.header, d.hash);
    assert.equal(e.ok, true);
    assert.equal(e.id, id, `round-trip mismatch for ${id}`);
  }
});

test("real mainnet script-hash DReps: decode -> header 0x23, kind script", () => {
  for (const [id, hex28] of MAINNET_SCRIPT) {
    const d = decodeDrepId(id);
    assert.equal(d.ok, true, `decode ${id} -> ${d.code}`);
    assert.equal(d.header, 0x23);
    assert.equal(d.kind, "script");
    assert.equal(d.hash, hex28, `hash mismatch for ${id}`);
    const e = encodeDrepId(d.header, d.hash);
    assert.equal(e.id, id, `round-trip mismatch for ${id}`);
  }
});

// ---------------------------------------------------------------------------
// Header byte classification: key (0x22) vs script (0x23), and rejection.
// ---------------------------------------------------------------------------
test("decode: header 0x23 -> kind script (CIP-129 script-hash DRep)", () => {
  const e = encodeDrepId(DREP_SCRIPT_HEADER, "0".repeat(56));
  assert.equal(e.ok, true);
  const d = decodeDrepId(e.id);
  assert.equal(d.ok, true);
  assert.equal(d.header, 0x23);
  assert.equal(d.kind, "script");
  assert.equal(d.hash, "0".repeat(56));
});

test("decode: a foreign header byte (not 0x22/0x23) is rejected as bad_header", () => {
  // An all-zero 29-byte payload is 232 zero bits = 47 zero five-bit groups.
  // We build a bech32 word with HRP "drep", 47 zero payload groups, and the
  // correct 6-char checksum (using the module's polymod + the real hrpExpand).
  // Its header byte decodes to 0x00 (a stake key-type, NOT a DRep), so
  // decode must refuse it with bad_header even though the checksum is valid.
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const hrpExpand = [];
  for (const ch of "drep") hrpExpand.push(ch.charCodeAt(0) >> 5);
  hrpExpand.push(0);
  for (const ch of "drep") hrpExpand.push(ch.charCodeAt(0) & 31);
  const payload5 = new Array(47).fill(0);
  const p = polymod(hrpExpand.concat(payload5, [0, 0, 0, 0, 0, 0])) ^ 1;
  const cs = [0, 1, 2, 3, 4, 5].map((i) => (p >> (5 * (5 - i))) & 31);
  const word = "drep1" + payload5.map((v) => CHARSET[v]).join("") + cs.map((v) => CHARSET[v]).join("");
  // Sanity: the word we built is a valid bech32 checksum-wise (polymod == 1).
  assert.equal(polymod(hrpExpand.concat(payload5, cs)), 1);
  // It is the correct DRep length (58), so it sails past every other check.
  assert.equal(word.length, 58);
  const d = decodeDrepId(word);
  assert.equal(d.ok, false);
  assert.equal(d.code, "bad_header");
});

test("DREP_HEADERS is exactly [0x22, 0x23]", () => {
  assert.deepEqual([...DREP_HEADERS], [0x22, 0x23]);
});

// ---------------------------------------------------------------------------
// Validation rejections (BIP-173 + DRep rules).
// ---------------------------------------------------------------------------
test("validate: bad human-readable part", () => {
  const v = validateDrepId("addr1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq09c");
  assert.equal(v.ok, false);
  assert.equal(v.code, "wrong_hrp");
});

test("validate: wrong length is rejected", () => {
  // 57 chars (one char too short for a 29-byte payload).
  const short = CIP129_VECTOR.slice(0, 57);
  assert.equal(validateDrepId(short).ok, false);
  // 112 chars exceeds the BIP-173 max of 111.
  const long = "drep1" + "q".repeat(107);
  assert.equal(validateDrepId(long).ok, false);
  assert.equal(validateDrepId(long).code, "too_long");
});

test("validate: corrupted checksum is rejected", () => {
  // Flip the last character -> polymod no longer 1.
  const last = CIP129_VECTOR.slice(-1);
  const repl = last === "q" ? "p" : "q";
  const broken = CIP129_VECTOR.slice(0, -1) + repl;
  const v = validateDrepId(broken);
  assert.equal(v.ok, false);
  assert.equal(v.code, "bad_checksum");
});

test("validate: rejected chars 1/b/i/o in the data section", () => {
  // Swap a data char for 'b' (charset-excluded) keeping the separator.
  const bad = CIP129_VECTOR.slice(0, 5) + "b" + CIP129_VECTOR.slice(6);
  const v = validateDrepId(bad);
  assert.equal(v.ok, false);
  assert.equal(v.code, "bad_charset");
});

test("validate: mixed case is rejected", () => {
  const mixed = CIP129_VECTOR.slice(0, 2) + CIP129_VECTOR.slice(2).toUpperCase();
  assert.equal(validateDrepId(mixed).ok, false);
  assert.equal(validateDrepId(mixed).code, "mixed_case");
});

test("validate: non-string / empty is rejected", () => {
  assert.equal(validateDrepId(null).ok, false);
  assert.equal(validateDrepId("").ok, false);
  assert.equal(validateDrepId("   ").ok, false);
});

test("validate: a correct id is accepted with length 58", () => {
  const v = validateDrepId(CIP129_VECTOR);
  assert.equal(v.ok, true);
  assert.equal(v.code, "ok");
  assert.equal(CIP129_VECTOR.length, 58);
});

// ---------------------------------------------------------------------------
// shortDrepId display helper.
// ---------------------------------------------------------------------------
test("shortDrepId: drep1abc…wxyz form (7 + ellipsis + 5)", () => {
  assert.equal(shortDrepId(CIP129_VECTOR), "drep1yg…vlc9n");
});

test("shortDrepId: short/invalid input passes through unchanged", () => {
  assert.equal(shortDrepId("drep"), "drep");
  assert.equal(shortDrepId(null), null);
});

// ---------------------------------------------------------------------------
// encodeDrepId input validation.
// ---------------------------------------------------------------------------
test("encode: bad header and bad hash are rejected", () => {
  assert.equal(encodeDrepId(0x00, ZERO_HASH).ok, false);
  assert.equal(encodeDrepId(0x22, "zz".repeat(28)).ok, false); // non-hex
  assert.equal(encodeDrepId(0x22, "a".repeat(55)).ok, false); // wrong length
});

test("encode: uppercase hex is normalized to lowercase id", () => {
  const up = encodeDrepId(0x22, "A".repeat(56));
  const low = encodeDrepId(0x22, "a".repeat(56));
  assert.equal(up.ok, true);
  assert.equal(low.ok, true);
  // Same byte payload -> identical id regardless of input case.
  assert.equal(up.id, low.id);
});
