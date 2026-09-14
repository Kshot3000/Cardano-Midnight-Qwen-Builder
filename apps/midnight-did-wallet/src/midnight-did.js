// midnight-did.js — did:midnight DID codec & resolver (pure JS, no deps).
//
// Implements the Midnight DID method specification (midnightntwrk/midnight-did,
// w3c-spec/midnight-method.md) for:
//   * ledger DIDs:      did:midnight:<network>:<64-hex contract id>
//   * offchain DIDs:    did:midnight:offchain:<64-hex state hash>[:<base64url state>]
//
// The offchain state is the `midnight-offchain-did-state-v1` framing:
//   "MOD1" magic, uint32be chunk count, then Compact value chunks:
//   version (Uint16), 4× alsoKnownAs (opaque string),
//   4× OffchainVerificationMethod {present, id, keyKind, x, y, relationshipsMask},
//   4× OffchainService {present, id, type, serviceEndpoint}.
//
// The state hash is the lowercase-hex BLAKE2s-256 (dkLen=32) of the decoded
// state bytes. Long-form DIDs are self-contained: the resolver decodes the
// state, recomputes the hash, and rejects mismatches.
//
// Everything here is synchronous and pure (no network, no WebCrypto) so the
// exact same module is unit-tested in Node and loaded by the browser page.

import { blake2s256Hex } from "./blake2s.js";

export class DidError extends Error {
  constructor(message) {
    super(message);
    this.name = "DidError";
  }
}

export const LEDGER_NETWORKS = [
  "undeployed",
  "devnet",
  "testnet",
  "mainnet",
  "preview",
  "preprod",
];

export const RELATIONSHIPS = [
  "authentication",
  "assertionMethod",
  "keyAgreement",
  "capabilityInvocation",
  "capabilityDelegation",
];

export const RELATIONSHIP_BITS = {
  authentication: 0x01,
  assertionMethod: 0x02,
  keyAgreement: 0x04,
  capabilityInvocation: 0x08,
  capabilityDelegation: 0x10,
};

// keyKind -> { kty, crv, xBytes, yBytes|null (null = y must be empty) }
export const KEY_PROFILES = {
  1: { kty: "EC", crv: "Jubjub", xBytes: 32, yBytes: 32 },
  2: { kty: "OKP", crv: "Ed25519", xBytes: 32, yBytes: null },
  3: { kty: "EC", crv: "P-256", xBytes: 32, yBytes: 32 },
  4: { kty: "OKP", crv: "X25519", xBytes: 32, yBytes: null },
  5: { kty: "EC", crv: "secp256k1", xBytes: 32, yBytes: 32 },
  6: { kty: "OKP", crv: "BLS12381G1", xBytes: 48, yBytes: null },
  7: { kty: "OKP", crv: "BLS12381G2", xBytes: 96, yBytes: null },
};

const CRV_TO_KIND = Object.fromEntries(
  Object.entries(KEY_PROFILES).map(([k, p]) => [p.crv, Number(k)])
);

const MAGIC = [0x4d, 0x4f, 0x44, 0x31]; // "MOD1"
const HEX64 = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const B64_STANDARD = /[+/=]/;

// ---------------------------------------------------------------------------
// base64url helpers (canonical: unpadded, RFC4648 §5 alphabet)
// Pure JS — works identically in Node and the browser (no Buffer/btoa).
// ---------------------------------------------------------------------------

const B64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function bytesToBase64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_URL[b0 >> 2];
    out += B64_URL[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64_URL[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64_URL[b2 & 63];
  }
  return out; // unpadded by construction
}

export function base64urlToBytes(s) {
  if (typeof s !== "string" || s.length === 0) throw new DidError("empty base64url payload");
  if (!B64URL.test(s)) throw new DidError("payload is not base64url text");
  if (B64_STANDARD.test(s)) {
    throw new DidError("non-canonical base64url (standard alphabet or padding)");
  }
  if (s.length % 4 === 1) throw new DidError("invalid base64url length");
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i++) table[B64_URL.charCodeAt(i)] = i;
  const n = s.length;
  const bytes = new Uint8Array(Math.floor((n * 3) / 4));
  let j = 0;
  for (let i = 0; i < n; i += 4) {
    const c0 = table[s.charCodeAt(i)];
    const c1 = i + 1 < n ? table[s.charCodeAt(i + 1)] : 0;
    const c2 = i + 2 < n ? table[s.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < n ? table[s.charCodeAt(i + 3)] : 0;
    if (c0 < 0 || (i + 1 < n && c1 < 0) || (i + 2 < n && c2 < 0) || (i + 3 < n && c3 < 0)) {
      throw new DidError("invalid base64url character");
    }
    bytes[j++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < n) bytes[j++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (i + 3 < n) bytes[j++] = ((c2 & 3) << 6) | c3;
  }
  return bytes.subarray(0, j);
}

// ---------------------------------------------------------------------------
// Compact chunk read / write helpers
// ---------------------------------------------------------------------------

function be32(buf, off) {
  return (
    buf[off] * 16777216 +
    buf[off + 1] * 65536 +
    buf[off + 2] * 256 +
    buf[off + 3]
  );
}

function readChunks(buf) {
  if (buf.length < 8) throw new DidError("payload too short for MOD1 frame");
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) throw new DidError("bad magic (expected MOD1)");
  }
  const count = be32(buf, 4);
  if (count === 0) throw new DidError("chunk count must be > 0");
  const MAX_CHUNKS = 1 << 20;
  if (count > MAX_CHUNKS) throw new DidError("chunk count implausible");
  let off = 8;
  const chunks = new Array(count);
  for (let i = 0; i < count; i++) {
    if (off + 4 > buf.length) throw new DidError("chunk count exceeds remaining bytes");
    const len = be32(buf, off);
    off += 4;
    if (off + len > buf.length) throw new DidError("chunk length exceeds remaining bytes");
    chunks[i] = buf.subarray(off, off + len);
    off += len;
  }
  if (off !== buf.length) throw new DidError("trailing bytes after last chunk");
  return chunks;
}

function u16(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new DidError(`${what} must be an integer in 0..65535`);
  }
  if (n === 0) return new Uint8Array(0);
  if (n < 256) return new Uint8Array([n]);
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]); // LE, minimal
}

function readU16(chunk, what) {
  if (chunk.length > 2) throw new DidError(`${what} chunk too long`);
  let v = 0;
  for (const b of chunk) v = (v << 8) | b;
  return v;
}

function u8(value, what) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 0xff) {
    throw new DidError(`${what} must be an integer in 0..255`);
  }
  if (n === 0) return new Uint8Array(0);
  return new Uint8Array([n]);
}

function readU8(chunk, what) {
  if (chunk.length > 1) throw new DidError(`${what} chunk too long`);
  return chunk.length === 0 ? 0 : chunk[0];
}

function opaque(value) {
  if (typeof value !== "string") throw new DidError("opaque string expected");
  return new TextEncoder().encode(value);
}

function readBool(chunk, what) {
  if (chunk.length === 0) return false;
  if (chunk.length === 1 && chunk[0] === 1) return true;
  throw new DidError(`bad boolean in ${what}`);
}

// ---------------------------------------------------------------------------
// state normalize / encode / decode
// ---------------------------------------------------------------------------

function requireString(v, what) {
  if (typeof v !== "string") throw new DidError(`${what} must be a string`);
  return v;
}

function normalizeRelationships(state, methodIndex) {
  if (state.relationshipsMask != null) {
    const mask = Number(state.relationshipsMask);
    if (!Number.isInteger(mask) || mask < 0 || mask > 0x1f) {
      throw new DidError(`verificationMethod[${methodIndex}].relationshipsMask out of range`);
    }
    if (mask === 0) throw new DidError(`verificationMethod[${methodIndex}] has no relationships`);
    return mask;
  }
  if (state.relationships != null) {
    if (typeof state.relationships !== "object" || state.relationships === null) {
      throw new DidError(`verificationMethod[${methodIndex}].relationships must be an object`);
    }
    const keys = Object.keys(state.relationships);
    const known = new Set(RELATIONSHIPS);
    for (const k of keys) {
      if (!known.has(k)) throw new DidError(`unknown relationship '${k}'`);
    }
    let mask = 0;
    for (const r of RELATIONSHIPS) {
      const v = state.relationships[r];
      if (v === true) mask |= RELATIONSHIP_BITS[r];
      else if (v !== false && v !== undefined) {
        throw new DidError(`verificationMethod[${methodIndex}].relationships.${r} must be a boolean`);
      }
    }
    if (mask === 0) throw new DidError(`verificationMethod[${methodIndex}] has no relationships`);
    return mask;
  }
  throw new DidError(
    `verificationMethod[${methodIndex}] needs a relationships object or relationshipsMask`
  );
}

function jwkToKeyMaterial(jwk, methodIndex) {
  const idx = methodIndex + 1;
  if (typeof jwk !== "object" || jwk === null) {
    throw new DidError(`verificationMethod[${idx}].publicKeyJwk is required`);
  }
  const kty = requireString(jwk.kty, `verificationMethod[${idx}].publicKeyJwk.kty`);
  const crv = requireString(jwk.crv, `verificationMethod[${idx}].publicKeyJwk.crv`);
  const kind = CRV_TO_KIND[crv];
  if (kind === undefined) {
    throw new DidError(`unsupported curve '${crv}' (kty=${kty})`);
  }
  const prof = KEY_PROFILES[kind];
  if (prof.kty !== kty) {
    throw new DidError(`curve ${crv} requires kty '${prof.kty}', got '${kty}'`);
  }
  if (jwk.d != null) {
    throw new DidError(`public JWK must not contain private material (d) — method ${idx}`);
  }
  const x = requireString(jwk.x, `verificationMethod[${idx}].publicKeyJwk.x`);
  const xBytes = base64urlToBytes(x);
  if (xBytes.length !== prof.xBytes) {
    throw new DidError(
      `verificationMethod[${idx}].x must decode to ${prof.xBytes} bytes for ${crv}, got ${xBytes.length}`
    );
  }
  let y = "";
  if (jwk.y != null) {
    y = requireString(jwk.y, `verificationMethod[${idx}].publicKeyJwk.y`);
    if (prof.yBytes === null) {
      throw new DidError(`verificationMethod[${idx}].y must be empty for ${crv}`);
    }
    const yBytes = base64urlToBytes(y);
    if (yBytes.length !== prof.yBytes) {
      throw new DidError(
        `verificationMethod[${idx}].y must decode to ${prof.yBytes} bytes for ${crv}, got ${yBytes.length}`
      );
    }
  } else if (prof.yBytes !== null) {
    throw new DidError(`verificationMethod[${idx}].y is required for ${crv}`);
  }
  return { kind, x, y };
}

function normalizeState(state) {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new DidError("state must be an object");
  }
  const version = Number(state.version ?? 1);
  if (version !== 1) throw new DidError(`unsupported state version ${version}`);

  const akaRaw = state.alsoKnownAs ?? [];
  if (!Array.isArray(akaRaw)) throw new DidError("alsoKnownAs must be a list");
  if (akaRaw.length > 4) throw new DidError("at most 4 alsoKnownAs entries");
  const aka = [];
  for (const a of akaRaw) {
    if (a === undefined || a === null || a === "") continue;
    aka.push(requireString(a, "alsoKnownAs entry"));
  }

  const vmRaw = state.verificationMethod ?? [];
  if (!Array.isArray(vmRaw)) throw new DidError("verificationMethod must be a list");
  if (vmRaw.length > 4) throw new DidError("at most 4 verification methods");
  const vms = [];
  for (let i = 0; i < vmRaw.length; i++) {
    const m = vmRaw[i];
    if (typeof m !== "object" || m === null) throw new DidError(`verificationMethod[${i}] must be an object`);
    const id = requireString(m.id, `verificationMethod[${i}].id`);
    if (id.trim() === "") throw new DidError(`verificationMethod[${i}].id is empty`);
    if (id.includes("#") === false) {
      throw new DidError(`verificationMethod[${i}].id must carry a #fragment (subject-bound DID URL)`);
    }
    const { kind, x, y } = jwkToKeyMaterial(m.publicKeyJwk, i);
    const mask = normalizeRelationships(m, i);
    vms.push({ id, kind, x, y, mask });
  }
  if (vms.length === 0) throw new DidError("state must contain at least one verification method");
  const ids = new Set(vms.map((m) => m.id));
  if (ids.size !== vms.length) throw new DidError("duplicate verification method id");

  const svcRaw = state.service ?? [];
  if (!Array.isArray(svcRaw)) throw new DidError("service must be a list");
  if (svcRaw.length > 4) throw new DidError("at most 4 services");
  const svcs = [];
  for (let i = 0; i < svcRaw.length; i++) {
    const s = svcRaw[i];
    if (typeof s !== "object" || s === null) throw new DidError(`service[${i}] must be an object`);
    const id = requireString(s.id, `service[${i}].id`);
    if (id.trim() === "") throw new DidError(`service[${i}].id is empty`);
    const type = requireString(s.type, `service[${i}].type`);
    if (type.trim() === "") throw new DidError(`service[${i}].type is empty`);
    const endpoint = requireString(s.serviceEndpoint, `service[${i}].serviceEndpoint`);
    if (endpoint.trim() === "") throw new DidError(`service[${i}].serviceEndpoint is empty`);
    svcs.push({ id, type, endpoint });
  }

  return { aka, vms, svcs };
}

function pushChunk(parts, bytes) {
  parts.push(Uint8Array.from([bytes.length >>> 24, (bytes.length >>> 16) & 0xff, (bytes.length >>> 8) & 0xff, bytes.length & 0xff]));
  parts.push(bytes);
}

export function encodeState(state) {
  const n = normalizeState(state);
  const parts = [];
  for (const b of MAGIC) parts.push(Uint8Array.from([b]));
  // chunk count: 1 version + 4 aka + 4*6 vm fields + 4*4 svc fields = 45
  const count = 1 + 4 + 24 + 16;
  parts.push(Uint8Array.from([0, 0, 0, count]));
  pushChunk(parts, u16(1, "version"));
  for (let i = 0; i < 4; i++) pushChunk(parts, i < n.aka.length ? opaque(n.aka[i]) : new Uint8Array(0));
  for (let i = 0; i < 4; i++) {
    const m = n.vms[i] ?? null;
    pushChunk(parts, m ? Uint8Array.from([1]) : new Uint8Array(0)); // present
    pushChunk(parts, m ? opaque(m.id) : new Uint8Array(0));
    pushChunk(parts, m ? u8(m.kind, "keyKind") : new Uint8Array(0));
    pushChunk(parts, m ? opaque(m.x) : new Uint8Array(0));
    pushChunk(parts, m ? opaque(m.y) : new Uint8Array(0));
    pushChunk(parts, m ? u8(m.mask, "relationshipsMask") : new Uint8Array(0));
  }
  for (let i = 0; i < 4; i++) {
    const s = n.svcs[i] ?? null;
    pushChunk(parts, s ? Uint8Array.from([1]) : new Uint8Array(0));
    pushChunk(parts, s ? opaque(s.id) : new Uint8Array(0));
    pushChunk(parts, s ? opaque(s.type) : new Uint8Array(0));
    pushChunk(parts, s ? opaque(s.endpoint) : new Uint8Array(0));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return bytesToBase64url(out);
}

export function decodeState(payload) {
  const bytes = base64urlToBytes(payload);
  const chunks = readChunks(new Uint8Array(bytes));
  if (chunks.length !== 45) throw new DidError(`expected 45 chunks, got ${chunks.length}`);
  const dec = new TextDecoder();
  const take = (i) => dec.decode(chunks[i]);
  let p = 0;
  const version = readU16(chunks[p++], "version");
  if (version !== 1) throw new DidError(`unsupported state version ${version}`);
  const aka = [];
  for (let i = 0; i < 4; i++) {
    const s = take(p++);
    if (s !== "") aka.push(s);
  }
  const vms = [];
  for (let i = 0; i < 4; i++) {
    const slot = p; // index of the `present` field
    const present = readBool(chunks[slot], `verificationMethod[${i + 1}].present`);
    if (!present) {
      for (let k = 0; k < 6; k++) {
        if (chunks[slot + k].length !== 0) {
          throw new DidError(`empty method slot ${i + 1} has non-empty field ${k}`);
        }
      }
      p += 6;
      continue;
    }
    const id = take(slot + 1);
    if (id === "" || !id.includes("#")) {
      throw new DidError(`verificationMethod[${i + 1}] id is empty or fragment-less`);
    }
    const kind = readU8(chunks[slot + 2], "keyKind");
    const prof = KEY_PROFILES[kind];
    if (!prof) throw new DidError(`unsupported keyKind ${kind}`);
    const x = take(slot + 3);
    const y = take(slot + 4);
    const mask = readU8(chunks[slot + 5], "relationshipsMask");
    const xBytes = base64urlToBytes(x);
    if (xBytes.length !== prof.xBytes) {
      throw new DidError(`method ${i + 1}: x must be ${prof.xBytes} bytes for ${prof.crv}, got ${xBytes.length}`);
    }
    if (prof.yBytes === null) {
      if (y !== "") throw new DidError(`method ${i + 1}: y must be empty for ${prof.crv}`);
    } else {
      const yBytes = base64urlToBytes(y);
      if (yBytes.length !== prof.yBytes) {
        throw new DidError(`method ${i + 1}: y must be ${prof.yBytes} bytes for ${prof.crv}, got ${yBytes.length}`);
      }
    }
    if (mask === 0 || mask > 0x1f) throw new DidError(`method ${i + 1}: bad relationships mask ${mask}`);
    vms.push({ id, kind, x, y: prof.yBytes === null ? "" : y, mask });
    p += 6;
  }
  if (vms.length === 0) throw new DidError("state has no verification methods");
  const svcs = [];
  for (let i = 0; i < 4; i++) {
    const slot = p; // index of the `present` field
    const present = readBool(chunks[slot], `service[${i + 1}].present`);
    if (!present) {
      for (let k = 0; k < 4; k++) {
        if (chunks[slot + k].length !== 0) {
          throw new DidError(`empty service slot ${i + 1} has non-empty field ${k}`);
        }
      }
      p += 4;
      continue;
    }
    const id = take(slot + 1);
    if (id === "") throw new DidError(`service[${i + 1}] id is empty`);
    const type = take(slot + 2);
    if (type === "") throw new DidError(`service[${i + 1}] type is empty`);
    const endpoint = take(slot + 3);
    if (endpoint === "") throw new DidError(`service[${i + 1}] serviceEndpoint is empty`);
    svcs.push({ id, type, endpoint });
    p += 4;
  }
  if (p !== chunks.length) throw new DidError("internal: unexpected chunk count");
  return { version: 1, aka, vms, svcs };
}

// ---------------------------------------------------------------------------
// hashing & DID strings
// ---------------------------------------------------------------------------

export function stateHash(payload) {
  const bytes = base64urlToBytes(payload);
  return blake2s256Hex(bytes);
}

export function makeOffchainDid(state, { long = true } = {}) {
  const payload = encodeState(state);
  const hash = stateHash(payload);
  return long ? `did:midnight:offchain:${hash}:${payload}` : `did:midnight:offchain:${hash}`;
}

export function makeLedgerDid(network, contractId) {
  if (!LEDGER_NETWORKS.includes(network)) {
    throw new DidError(`unknown ledger network '${network}'`);
  }
  if (typeof contractId !== "string" || !HEX64.test(contractId.toLowerCase())) {
    throw new DidError("ledger contract id must be 64 lowercase hex chars");
  }
  return `did:midnight:${network}:${contractId.toLowerCase()}`;
}

export function parseDid(did) {
  if (typeof did !== "string" || did.trim() === "") throw new DidError("DID must be a non-empty string");
  const s = did.trim();
  if (!s.startsWith("did:midnight:")) throw new DidError("not a did:midnight identifier");
  const rest = s.slice("did:midnight:".length);
  const seg = rest.split(":");
  // short offchain: did:midnight:offchain:<hash>   (2 segs, seg[0]="offchain")
  if (seg.length === 2 && seg[0] === "offchain") {
    if (!HEX64.test(seg[1])) throw new DidError("offchain state hash must be 64 lowercase hex");
    return {
      kind: "offchain",
      form: "short",
      network: "offchain",
      hash: seg[1],
      payload: null,
      state: null,
      did: `did:midnight:offchain:${seg[1]}`,
      subject: `did:midnight:offchain:${seg[1]}`,
    };
  }
  // long offchain: did:midnight:offchain:<hash>:<base64url payload>  (3 segs)
  if (seg.length === 3 && seg[0] === "offchain") {
    const [hash, payload] = [seg[1], seg[2]];
    if (!HEX64.test(hash)) throw new DidError("offchain state hash must be 64 lowercase hex");
    if (payload === "") throw new DidError("trailing colon without offchain-state is invalid");
    if (!B64URL.test(payload) || B64_STANDARD.test(payload)) {
      throw new DidError("offchain-state is not canonical base64url");
    }
    const h2 = stateHash(payload);
    if (h2 !== hash) {
      throw new DidError(`state hash mismatch: ${hash} != computed ${h2}`);
    }
    const state = decodeState(payload);
    const full = `did:midnight:offchain:${hash}:${payload}`;
    return { kind: "offchain", form: "long", network: "offchain", hash, payload, state, did: full, subject: full };
  }
  // ledger: did:midnight:<network>:<64-hex contract id>  (2 segs, known network)
  if (seg.length === 2 && LEDGER_NETWORKS.includes(seg[0])) {
    const net = seg[0];
    const id = seg[1].toLowerCase();
    if (!HEX64.test(id)) throw new DidError("ledger contract id must be 64 lowercase hex");
    const full = `did:midnight:${net}:${id}`;
    return { kind: "ledger", form: "short", network: net, contractId: id, did: full, subject: full };
  }
  throw new DidError("unrecognized did:midnight form");
}

export function resolveDid(did) {
  const parsed = parseDid(did);
  if (parsed.kind === "offchain" && parsed.form === "long") {
    return { ...parsed, document: projectDocument(parsed.subject, parsed.state) };
  }
  return { ...parsed, document: null };
}

// ---------------------------------------------------------------------------
// DID Document projection
// ---------------------------------------------------------------------------

function resolveRef(subject, ref) {
  // Resolve a relative DID-URL reference (e.g. "#key-1", "/keys/a#key-1",
  // "?version=1#key-1") against the DID subject. The `did:` scheme is not an
  // absolute URI scheme for WHATWG URL, so resolve by hand:
  //   #frag           -> subject's base + frag
  //   /path[#frag]    -> subject's scheme+method+network + path (+ frag)
  //   ?query[#frag]   -> subject's base + query (+ frag)
  if (typeof ref !== "string" || ref.length === 0) {
    throw new DidError("empty reference");
  }
  let baseFrag = "";
  let baseNoFrag = subject;
  const f = subject.lastIndexOf("#");
  if (f >= 0) {
    baseFrag = subject.slice(f + 1);
    baseNoFrag = subject.slice(0, f);
  }
  let out;
  if (ref.startsWith("#")) {
    const frag = ref.slice(1);
    out = frag === "" ? baseNoFrag : baseNoFrag + "#" + frag;
  } else if (ref.startsWith("?")) {
    const rest = ref.slice(1);
    const ff = rest.lastIndexOf("#");
    const q = ff >= 0 ? rest.slice(0, ff) : rest;
    const fr = ff >= 0 ? rest.slice(ff + 1) : baseFrag;
    out = baseNoFrag + "?" + q + (fr ? "#" + fr : "");
  } else if (ref.startsWith("/")) {
    // strip scheme+method from the subject: did:midnight:<net> is 2 colons in
    const c1 = subject.indexOf(":");
    const c2 = subject.indexOf(":", c1 + 1);
    const head = c2 >= 0 ? subject.slice(0, c2) : baseNoFrag;
    const fr = ref.includes("#") ? ref.slice(ref.lastIndexOf("#") + 1) : baseFrag;
    out = head + ref + (fr ? "#" + fr : "");
  } else {
    throw new DidError(`unsupported reference form '${ref}'`);
  }
  return out;
}

export function projectDocument(subject, decoded) {
  // `decoded` is the canonical decoded state shape from decodeState():
  // { aka: string[], vms: [{id, kind, x, y, mask}], svcs: [{id, type, endpoint}] }
  if (typeof subject !== "string" || subject.length === 0) {
    throw new DidError("DID subject is required");
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new DidError("decoded state is required");
  }
  const aka = Array.isArray(decoded.aka) ? decoded.aka : [];
  const vms = Array.isArray(decoded.vms) ? decoded.vms : [];
  const svcs = Array.isArray(decoded.svcs) ? decoded.svcs : [];
  if (vms.length === 0) throw new DidError("state has no verification methods");
  const doc = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
    id: subject,
    controller: subject,
  };
  if (aka.length > 0) doc.alsoKnownAs = [...aka];
  doc.verificationMethod = [];
  const rel = {
    authentication: [],
    assertionMethod: [],
    keyAgreement: [],
    capabilityInvocation: [],
    capabilityDelegation: [],
  };
  for (const m of vms) {
    const prof = KEY_PROFILES[m.kind];
    if (!prof) throw new DidError(`unsupported keyKind ${m.kind}`);
    const absId = resolveRef(subject, m.id);
    const jwk = { kty: prof.kty, crv: prof.crv, x: m.x };
    if (prof.yBytes !== null) jwk.y = m.y;
    doc.verificationMethod.push({ id: absId, type: "JsonWebKey", controller: subject, publicKeyJwk: jwk });
    for (const r of RELATIONSHIPS) {
      if (m.mask & RELATIONSHIP_BITS[r]) rel[r].push(absId);
    }
  }
  for (const r of RELATIONSHIPS) doc[r] = rel[r];
  doc.service = svcs.map((s) => ({
    id: resolveRef(subject, s.id),
    type: s.type,
    serviceEndpoint: s.endpoint,
  }));
  return doc;
}
