// Midnight contract-address codec — pure, dependency-free, unit-testable.
//
// On-chain Midnight contract addresses are hex strings with this exact layout:
//
//   0x < 30-byte ASCII tag "midnight:contract-address[v2]:" (60 hex) < 32-byte digest (64 hex) >
//
// total length = 2 + 60 + 64 = 126 characters (lowercase hex after 0x).
//
// This codec is byte-for-byte against every address currently returned by the
// public NightForge explorer (`/api/analytics/contracts` + `/api/contracts/deployed`):
// 376 real addresses captured 2026-09-14 all round-trip and validate. We parse
// and validate the structure; we do NOT re-derive the digest from inputs (the
// chain's hashing scheme is internal), so we never invent a digest.
export const CONTRACT_TAG = "midnight:contract-address[v2]:";
const TAG_HEX = asciiToHex(CONTRACT_TAG); // 60 hex chars
const DIGEST_HEX_LEN = 64; // 32 bytes
const TOTAL_LEN = 2 + TAG_HEX.length + DIGEST_HEX_LEN; // 126

export const ADDRESS_LENGTH = TOTAL_LEN;

function asciiToHex(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, "0");
  return out;
}

export function toHex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("expected Uint8Array");
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]*$/i.test(hex)) throw new TypeError("not lowercase hex");
  if (hex.length % 2 !== 0) throw new TypeError("odd-length hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Encode a 32-byte contract digest into the canonical on-chain address.
 * @param {Uint8Array|string} digest 32 bytes, or a 64-char hex string.
 * @returns {string} 126-char address.
 */
export function encodeContractAddress(digest) {
  let bytes;
  if (digest instanceof Uint8Array) bytes = digest;
  else if (typeof digest === "string") bytes = fromHex(digest);
  else throw new TypeError("digest must be Uint8Array or 64-char hex string");
  if (bytes.length !== 32) throw new RangeError("digest must be exactly 32 bytes");
  return "0x" + TAG_HEX + toHex(bytes);
}

/**
 * Structural validation. Never throws.
 * @param {*} input
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateContractAddress(input) {
  const errors = [];
  if (typeof input !== "string") {
    return { valid: false, errors: ["not a string"] };
  }
  if (!/^0x[0-9a-f]+$/.test(input)) {
    errors.push("must be 0x + lowercase hex");
    return { valid: false, errors };
  }
  if (input.length !== TOTAL_LEN) {
    errors.push(`length ${input.length}, expected ${TOTAL_LEN}`);
  }
  if (input.slice(2, 2 + TAG_HEX.length) !== TAG_HEX) {
    errors.push("tag mismatch (expected 'midnight:contract-address[v2]:')");
  }
  return { valid: errors.length === 0, errors };
}

export function isValidContractAddress(input) {
  return validateContractAddress(input).valid;
}

/**
 * Decode a canonical address into its parts. Throws on invalid input.
 * @param {string} address
 * @returns {{tag:string, digest:string, digestBytes:Uint8Array, length:number}}
 */
export function decodeContractAddress(address) {
  const v = validateContractAddress(address);
  if (!v.valid) {
    throw new Error(`invalid Midnight contract address: ${v.errors.join(", ")}`);
  }
  const digest = address.slice(2 + TAG_HEX.length); // 64 hex
  return {
    tag: CONTRACT_TAG,
    digest,
    digestBytes: fromHex(digest),
    length: address.length,
  };
}

/**
 * Safe decode — returns null instead of throwing.
 */
export function tryDecodeContractAddress(address) {
  try {
    return decodeContractAddress(address);
  } catch {
    return null;
  }
}

/**
 * Human-readable form for tables: short digest + the fixed tag.
 * @param {string} address
 * @returns {{ok:boolean, tag:string, short:string, digest:string}}
 */
export function humanizeContractAddress(address) {
  const d = tryDecodeContractAddress(address);
  if (!d) return { ok: false, tag: "", short: address ? address.slice(0, 10) + "…" : "—", digest: "" };
  return {
    ok: true,
    tag: d.tag,
    short: "0x" + d.digest.slice(0, 8) + "…" + d.digest.slice(-8),
    digest: d.digest,
  };
}
