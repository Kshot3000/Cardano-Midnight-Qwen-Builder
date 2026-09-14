// did.test.mjs — spec-conformant test suite for the did:midnight codec + BLAKE2s.
//
// Ground truth:
//   * The spec test vector (midnightntwrk/midnight-did, w3c-spec/midnight-method.md
//     §2.1.2) is pinned in spec-vector.txt (506-char base64url offchain-state
//     payload) and asserted byte-for-byte against encodeState / stateHash.
//   * BLAKE2s-256 is cross-checked against Node's native crypto (blake2s256)
//     with fixed known-answer vectors + a size-sweep fuzz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { blake2s256Hex } from "../src/blake2s.js";
import {
  DidError,
  LEDGER_NETWORKS,
  RELATIONSHIPS,
  RELATIONSHIP_BITS,
  KEY_PROFILES,
  bytesToBase64url,
  base64urlToBytes,
  encodeState,
  decodeState,
  stateHash,
  makeOffchainDid,
  makeLedgerDid,
  parseDid,
  resolveDid,
  projectDocument,
} from "../src/midnight-did.js";

// ---- spec vector -----------------------------------------------------------
const SPEC_PAYLOAD = readFileSync(new URL("./spec-vector.txt", import.meta.url), "utf8").trim();
const SPEC_HASH = "3c08b85758d973a6002942c730d077ede51920c184927aaf010562035203fc21";
const SPEC_LONG = "did:midnight:offchain:" + SPEC_HASH + ":" + SPEC_PAYLOAD;

const SPEC_STATE = {
  version: 1,
  alsoKnownAs: ["https://example.org/holders/alice"],
  verificationMethod: [
    {
      id: "#holder-key-1",
      publicKeyJwk: {
        kty: "EC",
        crv: "Jubjub",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      },
      relationships: {
        authentication: true,
        assertionMethod: true,
        keyAgreement: false,
        capabilityInvocation: false,
        capabilityDelegation: false,
      },
    },
  ],
  service: [
    { id: "#profile", type: "LinkedDomains", serviceEndpoint: "https://example.org/profile/alice" },
  ],
};

// Generate deterministic base64url key material of a given byte length.
function keyB64(n, seed) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (seed + i) & 0xff;
  return bytesToBase64url(b);
}

// ===========================================================================
// BLAKE2s-256
// ===========================================================================
test("blake2s: matches the spec offchain-state hash", () => {
  const bytes = base64urlToBytes(SPEC_PAYLOAD);
  assert.equal(stateHash(SPEC_PAYLOAD), SPEC_HASH);
  assert.equal(blake2s256Hex(bytes), SPEC_HASH);
});

test("blake2s: known-answer vectors (empty, 'abc')", () => {
  assert.equal(
    blake2s256Hex(new Uint8Array(0)),
    "69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9"
  );
  assert.equal(
    blake2s256Hex(new TextEncoder().encode("abc")),
    "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982"
  );
});

test("blake2s: cross-checks Node native across a size sweep", () => {
  const sizes = [0, 1, 7, 8, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 257, 1000, 4096];
  for (const n of sizes) {
    for (let t = 0; t < 24; t++) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 31 + t * 7 + n) & 0xff;
      const native = createHash("blake2s256").update(b).digest("hex");
      assert.equal(blake2s256Hex(b), native, `mismatch at n=${n} t=${t}`);
    }
  }
});

// ===========================================================================
// base64url codec
// ===========================================================================
test("base64url: round-trips and is canonical (no padding)", () => {
  const b = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
  const s = bytesToBase64url(b);
  assert.ok(!/[+/=]/.test(s), "canonical alphabet only");
  assert.deepEqual(base64urlToBytes(s), b);
});

test("base64url: rejects standard-alphabet and padded input", () => {
  assert.throws(() => base64urlToBytes("ab+cd="), DidError);
  assert.throws(() => base64urlToBytes("ab/cd="), DidError);
});

test("base64url: rejects invalid length (len%4==1)", () => {
  assert.throws(() => base64urlToBytes("abcde"), DidError);
});

// ===========================================================================
// encode / decode — spec vector
// ===========================================================================
test("encodeState reproduces the spec payload byte-for-byte", () => {
  assert.equal(encodeState(SPEC_STATE), SPEC_PAYLOAD);
});

test("decodeState inverts the spec payload", () => {
  const d = decodeState(SPEC_PAYLOAD);
  assert.equal(d.version, 1);
  assert.deepEqual(d.aka, ["https://example.org/holders/alice"]);
  assert.equal(d.vms.length, 1);
  assert.equal(d.vms[0].id, "#holder-key-1");
  assert.equal(d.vms[0].kind, 1); // Jubjub
  assert.equal(d.vms[0].mask, RELATIONSHIP_BITS.authentication | RELATIONSHIP_BITS.assertionMethod);
  assert.equal(d.svcs.length, 1);
  assert.equal(d.svcs[0].id, "#profile");
  assert.equal(d.svcs[0].type, "LinkedDomains");
});

test("encode/decode round-trips an arbitrary state", () => {
  const state = {
    version: 1,
    alsoKnownAs: ["did:key:abc", "https://id.example/x", "https://id.example/y", "https://id.example/z"],
    verificationMethod: [
      {
        id: "#ed",
        publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: keyB64(32, 5) },
        relationships: { authentication: true, capabilityInvocation: true },
      },
      {
        id: "#p256",
        publicKeyJwk: { kty: "EC", crv: "P-256", x: keyB64(32, 10), y: keyB64(32, 40) },
        relationships: { keyAgreement: true },
      },
      {
        id: "#k25519",
        publicKeyJwk: { kty: "OKP", crv: "X25519", x: keyB64(32, 70) },
        relationships: { capabilityDelegation: true },
      },
      {
        id: "#bls1",
        publicKeyJwk: { kty: "OKP", crv: "BLS12381G1", x: keyB64(48, 90) },
        relationships: { assertionMethod: true },
      },
    ],
    service: [
      { id: "#s1", type: "T", serviceEndpoint: "https://e1" },
      { id: "#s2", type: "U", serviceEndpoint: "https://e2" },
    ],
  };
  const payload = encodeState(state);
  const d = decodeState(payload);
  assert.deepEqual(d.aka, state.alsoKnownAs);
  assert.equal(d.vms.length, 4);
  assert.equal(d.vms[0].kind, 2); // Ed25519
  assert.equal(d.vms[1].kind, 3); // P-256
  assert.equal(d.vms[2].kind, 4); // X25519
  assert.equal(d.vms[3].kind, 6); // BLS12381G1
  assert.equal(d.vms[0].mask, RELATIONSHIP_BITS.authentication | RELATIONSHIP_BITS.capabilityInvocation);
  assert.equal(d.svcs.length, 2);
});

// ===========================================================================
// DID strings
// ===========================================================================
test("makeOffchainDid: long form is self-contained and self-hashing", () => {
  const long = makeOffchainDid(SPEC_STATE, { long: true });
  assert.equal(long, SPEC_LONG);
  const short = makeOffchainDid(SPEC_STATE, { long: false });
  assert.equal(short, "did:midnight:offchain:" + SPEC_HASH);
});

test("parseDid: long form decodes state and validates the hash", () => {
  const p = parseDid(SPEC_LONG);
  assert.equal(p.kind, "offchain");
  assert.equal(p.form, "long");
  assert.equal(p.hash, SPEC_HASH);
  assert.ok(p.state.vms.length === 1);
  assert.equal(p.subject, SPEC_LONG);
});

test("parseDid: short form carries no state", () => {
  const p = parseDid("did:midnight:offchain:" + SPEC_HASH);
  assert.equal(p.form, "short");
  assert.equal(p.payload, null);
  assert.equal(p.state, null);
});

test("parseDid: rejects a tampered long form (hash mismatch)", () => {
  // flip one payload character -> state bytes change -> hash no longer matches
  const c = SPEC_PAYLOAD[40] === "a" ? "b" : "a";
  const tampered = "did:midnight:offchain:" + SPEC_HASH + ":" + c + SPEC_PAYLOAD.slice(41);
  assert.throws(() => parseDid(tampered), DidError);
});

test("makeLedgerDid / parseDid: ledger form round-trips and lowercases", () => {
  const cid = "ABCDEF0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789";
  const did = makeLedgerDid("mainnet", cid);
  assert.equal(did, "did:midnight:mainnet:" + cid.toLowerCase());
  const p = parseDid(did);
  assert.equal(p.kind, "ledger");
  assert.equal(p.network, "mainnet");
  assert.equal(p.contractId, cid.toLowerCase());
  for (const net of LEDGER_NETWORKS) {
    assert.equal(makeLedgerDid(net, "0".repeat(64)), `did:midnight:${net}:${"0".repeat(64)}`);
  }
});

test("makeLedgerDid: rejects unknown networks and bad contract ids", () => {
  assert.throws(() => makeLedgerDid("narnia", "0".repeat(64)), DidError);
  assert.throws(() => makeLedgerDid("mainnet", "zzz"), DidError);
});

// ===========================================================================
// resolution + document projection
// ===========================================================================
test("resolveDid: long form yields a full DID Document", () => {
  const r = resolveDid(SPEC_LONG);
  assert.ok(r.document);
  assert.equal(r.document.id, SPEC_LONG);
  assert.equal(r.document.controller, SPEC_LONG);
  assert.equal(r.document.verificationMethod.length, 1);
  assert.equal(r.document.verificationMethod[0].type, "JsonWebKey");
  assert.equal(r.document.verificationMethod[0].publicKeyJwk.crv, "Jubjub");
  assert.equal(r.document.service.length, 1);
});

test("projectDocument: absolute refs, controller, relationship arrays", () => {
  const d = decodeState(SPEC_PAYLOAD);
  const doc = projectDocument(SPEC_LONG, d);
  assert.deepEqual(doc["@context"], [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/jwk/v1",
  ]);
  assert.equal(doc.verificationMethod[0].id, SPEC_LONG + "#holder-key-1");
  assert.equal(doc.verificationMethod[0].controller, SPEC_LONG);
  // only authentication + assertionMethod are set on the spec key
  assert.equal(doc.authentication.length, 1);
  assert.equal(doc.assertionMethod.length, 1);
  for (const r of RELATIONSHIPS) {
    if (r !== "authentication" && r !== "assertionMethod") assert.equal(doc[r].length, 0);
  }
  assert.equal(doc.service[0].id, SPEC_LONG + "#profile");
  assert.equal(doc.service[0].serviceEndpoint, "https://example.org/profile/alice");
});

test("projectDocument: y omitted for scalar-only curves, present for elliptic", () => {
  const state = {
    version: 1,
    verificationMethod: [
      {
        id: "#ed",
        publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: keyB64(32, 1) },
        relationshipsMask: RELATIONSHIP_BITS.authentication,
      },
      {
        id: "#jj",
        publicKeyJwk: { kty: "EC", crv: "Jubjub", x: keyB64(32, 10), y: keyB64(32, 20) },
        relationshipsMask: RELATIONSHIP_BITS.authentication,
      },
    ],
  };
  const long = makeOffchainDid(state, { long: true });
  const doc = projectDocument(long, decodeState(encodeState(state)));
  assert.equal(doc.verificationMethod[0].publicKeyJwk.y, undefined);
  assert.equal(doc.verificationMethod[1].publicKeyJwk.y, keyB64(32, 20));
});

// ===========================================================================
// error handling
// ===========================================================================
test("encodeState: rejects private key material (d)", () => {
  assert.throws(
    () =>
      encodeState({
        version: 1,
        verificationMethod: [
          {
            id: "#k",
            publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: keyB64(32, 1), d: keyB64(32, 9) },
            relationshipsMask: 1,
          },
        ],
      }),
    DidError
  );
});

test("encodeState: rejects wrong-sized x for the curve", () => {
  assert.throws(
    () =>
      encodeState({
        version: 1,
        verificationMethod: [
          {
            id: "#k",
            publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: keyB64(31, 1) }, // 31 bytes, need 32
            relationshipsMask: 1,
          },
        ],
      }),
    DidError
  );
});

test("encodeState: rejects unknown curve", () => {
  assert.throws(
    () =>
      encodeState({
        version: 1,
        verificationMethod: [
          {
            id: "#k",
            publicKeyJwk: { kty: "EC", crv: "Nope", x: keyB64(32, 1), y: keyB64(32, 2) },
            relationshipsMask: 1,
          },
        ],
      }),
    DidError
  );
});

test("encodeState: rejects a kty that disagrees with the curve", () => {
  assert.throws(
    () =>
      encodeState({
        version: 1,
        verificationMethod: [
          {
            id: "#k",
            publicKeyJwk: { kty: "OKP", crv: "Jubjub", x: keyB64(32, 1), y: keyB64(32, 2) },
            relationshipsMask: 1,
          },
        ],
      }),
    DidError
  );
});

test("decodeState: rejects a bad magic", () => {
  const orig = base64urlToBytes(SPEC_PAYLOAD);
  orig[0] = 0x58; // 'M' -> 'X'
  assert.throws(() => decodeState(bytesToBase64url(orig)), DidError);
});

test("decodeState: rejects truncated / trailing garbage", () => {
  const orig = base64urlToBytes(SPEC_PAYLOAD);
  const truncated = orig.subarray(0, orig.length - 5);
  assert.throws(() => decodeState(bytesToBase64url(truncated)), DidError);
  const extra = new Uint8Array(orig.length + 1);
  extra.set(orig);
  extra[orig.length] = 1;
  assert.throws(() => decodeState(bytesToBase64url(extra)), DidError);
});

test("KEY_PROFILES / RELATIONSHIP_BITS are consistent", () => {
  for (const [kind, p] of Object.entries(KEY_PROFILES)) {
    assert.ok(Number(kind) >= 1 && Number(kind) <= 7);
    assert.ok(p.xBytes > 0);
    assert.equal(typeof p.yBytes === "number" || p.yBytes === null, true);
  }
  for (const r of RELATIONSHIPS) {
    assert.ok(Number.isInteger(RELATIONSHIP_BITS[r]) && RELATIONSHIP_BITS[r] > 0);
  }
});
