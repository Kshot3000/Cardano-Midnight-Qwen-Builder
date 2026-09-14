// poolid.js — Cardano stake-pool ID codec (pure, unit-tested).
//
// A stake pool ID is a 28-byte value bech32-encoded with hrp "pool"
// (e.g. pool1c8k78ny3x…). Koios also exposes the raw 56-hex form
// (`pool_id_hex`). This module validates/normalizes either form and
// round-trips between them.
//
// The bech32 codec below is the BIP-173 subset needed for pool ids
// (polymod checksum verify + encode), the same construction as the
// Cardano address validator in apps/glacier-drop/src/glacier.js.

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
// The five generator constants from the BIP-173 spec.
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export const POOL_ID_BYTES = 28; // 28-byte (56-hex) stake pool ID

function bech32Polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= BECH32_GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}

function bech32Checksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;
  const out = [];
  for (let i = 0; i < 6; i++) out.push((mod >>> (5 * (5 - i))) & 31);
  return out;
}

/**
 * Encode bytes as a bech32 string with the given hrp.
 * Exported for tests (round-trip vectors).
 */
export function bech32Encode(hrp, bytes) {
  const data = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const chars = data.concat(bech32Checksum(hrp, data)).map((v) => BECH32_CHARSET[v]);
  return hrp + "1" + chars.join("");
}

/**
 * Decode a bech32 string (any hrp) → { hrp, data } or { error }.
 * A valid bech32 string has polymod(hrp_expand + data) == 1 (BIP-173).
 */
export function bech32Decode(s) {
  s = String(s).trim().toLowerCase();
  if (s.length > 120) return { error: "too-long" };
  const sep = s.lastIndexOf("1");
  if (sep < 1 || sep > 19) return { error: "no-separator" };
  const hrp = s.slice(0, sep);
  if (!/^[a-z]+$/.test(hrp)) return { error: "bad-hrp-chars" };
  const part = s.slice(sep + 1);
  const data = [];
  for (const ch of part) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx < 0) return { error: "bad-char" };
    data.push(idx);
  }
  if (data.length < 6) return { error: "too-short" };
  if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) !== 1) {
    return { error: "bad-checksum" };
  }
  return { hrp, data: data.slice(0, -6) };
}

/** Convert bech32 5-bit groups to a byte array (drops the <8-bit tail). */
function groupsToBytes(groups) {
  let acc = 0, bits = 0;
  const out = [];
  for (const v of groups) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 0xff);
      bits -= 8;
      acc &= (1 << bits) - 1; // drop the consumed high bits
    }
  }
  return out;
}

export function bytesToHex(bytes) {
  return Array.prototype.map.call(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 <= hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

/** 56-char hex → `pool1…` bech32. Throws RangeError on bad length. */
export function hexToPoolId(hex) {
  const h = String(hex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{56}$/.test(h)) {
    throw new RangeError(`hex pool id must be 56 hex chars (got ${h.length})`);
  }
  return bech32Encode("pool", hexToBytes(h));
}

/** `pool1…` bech32 → 56-char hex. Throws RangeError with the failure reason. */
export function poolIdToHex(bech32) {
  const d = bech32Decode(bech32);
  if (d.error) throw new RangeError(`bech32: ${d.error}`);
  if (d.hrp !== "pool") throw new RangeError(`hrp must be "pool" (got "${d.hrp}")`);
  const bytes = groupsToBytes(d.data);
  if (bytes.length !== POOL_ID_BYTES) {
    throw new RangeError(`pool id must be ${POOL_ID_BYTES} bytes (got ${bytes.length})`);
  }
  return bytesToHex(bytes);
}

/**
 * Normalize any pool id form (`pool1…` bech32 or 56-char hex) to both.
 * @returns {{ok:true, bech32:string, hex:string} | {ok:false, reason:string}}
 * reasons: empty | unknown-format | no-separator | bad-hrp-chars | bad-char |
 *          too-short | too-long | bad-checksum | bad-hrp | bad-payload
 */
export function normalizePoolId(input) {
  const s = String(input ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };
  const lower = s.toLowerCase();

  if (s.startsWith("pool1") || lower.startsWith("pool1")) {
    const hex = safePoolIdToHex(lower);
    if (hex === null) return { ok: false, reason: "bad-checksum-or-hrp" };
    return { ok: true, bech32: lower, hex };
  }

  if (/^[0-9a-fA-F]{56}$/.test(s)) {
    return { ok: true, bech32: hexToPoolId(s), hex: s.toLowerCase() };
  }

  // Generic bech32 shape with a non-"pool" hrp → say which.
  const generic = lower.match(/^[a-z]{1,19}1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/);
  if (generic) {
    const d = bech32Decode(lower);
    if (d.error) return { ok: false, reason: d.error };
    if (d.hrp !== "pool") return { ok: false, reason: "bad-hrp" };
    const hex = bytesToHex(groupsToBytes(d.data));
    if (hex.length !== 56) return { ok: false, reason: "bad-payload" };
    return { ok: true, bech32: lower, hex };
  }

  return { ok: false, reason: "unknown-format" };
}

function safePoolIdToHex(lower) {
  try {
    return poolIdToHex(lower);
  } catch (_) {
    return null; // any decode/checksum/length failure
  }
}
