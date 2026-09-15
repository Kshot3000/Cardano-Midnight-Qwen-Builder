/* DRep Watch — bech32 codec for `drep1…` governance DRep identifiers.
 *
 * CIP-129 ("Governance Identifiers") defines the current Conway-era DRep id:
 * a BIP-173 bech32 string with human-readable part "drep", payload of
 *
 *     [ header (1 byte) ][ hash (28 bytes) ]
 *
 *   - header byte = tttt.cccc  (upper nibble = key type, lower = credential)
 *       key type  0010  ⇒ DRep
 *       credential 0010 ⇒ key hash   → header 0x22
 *       credential 0011 ⇒ script hash → header 0x23
 *   - hash = blake2b-224 of the DRep verification key (or script) — 28 bytes.
 *     Koios exposes exactly this 28-byte value as the 56-hex-char `hex` field
 *     in /k/api/v1/drep_list (its `hex` is the hash only; the 29-byte
 *     credential is header || hash).
 *
 * 29 bytes = 232 bits → 47 five-bit groups (230 bits, 2 padding) + the 6-char
 * bech32 checksum = 53 data chars, so a DRep id is always
 *   4 (hrp) + 1 (sep) + 53 (data) = 58 characters.
 *
 * The official CIP-129 test vector (28 zero bytes, key-hash) is
 *   22 00…00  →  drep1ygqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq7vlc9n
 * and the unit tests pin that this module reproduces it byte-for-byte.
 *
 * BIP-173 validity: exactly one separator '1' (the charset deliberately
 * excludes '1','b','i','o'), no mixed case, HRP "drep", length in [8,111],
 * and polymod(hrp_expand(hrp) ++ data) == 1. The polymod routine is the same
 * 32-bit BIP-173 checksum the glacier-drop app uses; re-implemented here so
 * the module stays dependency-free and unit-testable in isolation.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HRP = "drep";

/** CIP-129 DRep header bytes: key-hash vs script-hash. */
export const DREP_KEY_HEADER = 0x22;
export const DREP_SCRIPT_HEADER = 0x23;
/** The only two header bytes a `drep1…` credential may carry. */
export const DREP_HEADERS = Object.freeze([DREP_KEY_HEADER, DREP_SCRIPT_HEADER]);

export function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATORS[i];
  }
  return chk;
}

function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** 5-bit value of each charset char (index in CHARSET). */
function toFiveBit(data) {
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = CHARSET.indexOf(data[i]);
  return out;
}

/**
 * Append the 6-char bech32 checksum to a 5-bit data array.
 *
 * BIP-173: the checksum is bech32_polymod(hrp_expand(hrp) ++ data ++ 0^6)
 * **xor 1**, taking the top 30 bits. The `^ 1` is what makes a freshly
 * encoded word re-polymod to exactly 1 (the all-zero polymod is the
 * "invalid" sentinel, so generation XORs 1 to land on the valid side).
 */
function checksum(hrp, dataFiveBit) {
  const values = hrpExpand(hrp).concat(dataFiveBit, [0, 0, 0, 0, 0, 0]);
  const p = polymod(values) ^ 1;
  const out = [];
  for (let i = 0; i < 6; i++) out.push((p >> (5 * (5 - i))) & 31);
  return out;
}

/**
 * Convert a byte array into 5-bit groups (MSB-first, zero-padded).
 * The accumulator is masked down to the unconsumed bits after every
 * extraction so it stays < 2^13 and never overflows the 53-bit safe range,
 * regardless of input length.
 */
function bytesToFiveBit(bytes) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((acc >>> bits) & 31);
      acc &= (1 << bits) - 1; // drop the 5 bits just emitted
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31);
  return out;
}

/** Inverse of bytesToFiveBit: 5-bit groups → byte array (trailing <8 bits dropped). */
function fiveBitToBytes(groups) {
  let acc = 0;
  let bits = 0;
  const out = [];
  for (const v of groups) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
      acc &= (1 << bits) - 1; // drop the 8 bits just emitted
    }
  }
  return out;
}

function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
function bytesToHex(bytes) {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a bech32 DRep id string.
 * @returns {{ok:boolean, code:string, hrp?:string, dataLenBytes?:number}}
 *   code ∈ { ok, not_string, mixed_case, no_separator, bad_charset,
 *            wrong_hrp, too_short, too_long, bad_checksum, bad_length }
 */
export function validateDrepId(s) {
  if (typeof s !== "string" || s.length === 0) return { ok: false, code: "not_string" };
  if (s.toLowerCase() !== s && s.toUpperCase() !== s) return { ok: false, code: "mixed_case" };
  const t = s.toLowerCase();
  const pos = t.lastIndexOf("1");
  if (pos < 0) return { ok: false, code: "no_separator" };
  // Every char EXCEPT the separator must be in the 32-char charset.
  for (let i = 0; i < t.length; i++) {
    if (i === pos) continue;
    if (CHARSET.indexOf(t[i]) === -1) return { ok: false, code: "bad_charset" };
  }
  const hrp = t.slice(0, pos);
  const data = t.slice(pos + 1);
  if (hrp !== HRP) return { ok: false, code: "wrong_hrp", hrp };
  if (t.length < 8) return { ok: false, code: "too_short" };
  if (t.length > 111) return { ok: false, code: "too_long" };
  // data = payload + 6-char checksum
  if (data.length < 6) return { ok: false, code: "bad_checksum" };
  const p = polymod(hrpExpand(hrp).concat(toFiveBit(data)));
  if (p !== 1) return { ok: false, code: "bad_checksum", hrp };
  // DRep-specific: a Conway-era drep1 credential is always 29 payload bytes →
  // exactly 58 chars total. Anything else (even checksum-valid) is not a DRep.
  if (t.length !== 58) return { ok: false, code: "bad_length", hrp };
  const dataLenBytes = Math.floor(((data.length - 6) * 5) / 8);
  return { ok: true, code: "ok", hrp, dataLenBytes };
}

/**
 * Decode a DRep id into its CIP-129 header byte, credential kind, and the
 * 28-byte blake2b-224 hash.
 * @returns {{ok:boolean, code:string, header?:number, kind?:string, hash?:string}}
 *   `header` is the raw CIP-129 header byte (0x22 key / 0x23 script), `kind`
 *   is "key" | "script", and `hash` is the 56-hex-char 28-byte hash.
 */
export function decodeDrepId(s) {
  const v = validateDrepId(s);
  if (!v.ok) return { ok: false, code: v.code };
  const t = s.toLowerCase();
  const pos = t.lastIndexOf("1");
  const data = t.slice(pos + 1);
  const payload = toFiveBit(data.slice(0, data.length - 6));
  const bytes = fiveBitToBytes(payload);
  if (bytes.length < 2) return { ok: false, code: "bad_length" };
  const header = bytes[0];
  let kind;
  if (header === DREP_KEY_HEADER) kind = "key";
  else if (header === DREP_SCRIPT_HEADER) kind = "script";
  else return { ok: false, code: "bad_header", header };
  const hash = bytesToHex(bytes.slice(1));
  return { ok: true, code: "ok", header, kind, hash };
}

/**
 * Encode a DRep id from a CIP-129 header byte and 28-byte hash (56 hex chars).
 * @param {number} header 0x22 (key-hash) or 0x23 (script-hash)
 * @param {string} hashHex 56 lowercase hex chars (28 bytes)
 * @returns {{ok:boolean, code:string, id?:string}}
 */
export function encodeDrepId(header, hashHex) {
  if (typeof header !== "number" || !DREP_HEADERS.includes(header)) {
    return { ok: false, code: "bad_header", header };
  }
  if (typeof hashHex !== "string" || !/^[0-9a-f]{56}$/i.test(hashHex)) {
    return { ok: false, code: "bad_hash" };
  }
  const bytes = [header, ...hexToBytes(hashHex.toLowerCase())];
  const payload = bytesToFiveBit(bytes);
  const cs = checksum(HRP, payload);
  const id = HRP + "1" + payload.map((v) => CHARSET[v]).join("") + cs.map((v) => CHARSET[v]).join("");
  return { ok: true, code: "ok", id };
}

/** Short display form: drep1abc…wxyz (first 7 + last 5 chars). */
export function shortDrepId(id) {
  if (typeof id !== "string" || id.length <= 12) return id;
  return id.slice(0, 7) + "…" + id.slice(-5);
}
