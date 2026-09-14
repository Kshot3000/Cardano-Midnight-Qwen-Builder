/**
 * blake2s.js — dependency-free BLAKE2s-256 (unkeyed, 32-byte digest).
 *
 * The `did:midnight` offchain DID method specifies the persistent state hash
 * as BLAKE2s-256 over the decoded state bytes (w3c-spec/midnight-method.md,
 * §2.1.1). WebCrypto / SubtleCrypto does not expose BLAKE2s, so this module
 * provides a pure-JS implementation that runs identically in Node and the
 * browser. Correctness is pinned in tests against (a) the official spec test
 * vector and (b) Node's native `crypto.createHash('blake2s256')`.
 *
 * Transcribed from the canonical BLAKE2s reference (RFC 7693 / IETF BLAKE2).
 */

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// BLAKE2 sigma schedule (10 rounds × 16).
const SIGMA = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
]);

const MASK = 0xffffffff;
const rotr32 = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

// BLAKE2 G: mixes two message words into the state.
function g(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) >>> 0;
  v[d] = rotr32(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr32(v[b] ^ v[c], 12);
  v[a] = (v[a] + v[b] + y) >>> 0;
  v[d] = rotr32(v[d] ^ v[a], 8);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr32(v[b] ^ v[c], 7);
}

// Decode a 64-byte block into 16 little-endian uint32 message words.
function toWords(block) {
  const dv = new DataView(block.buffer, block.byteOffset, 64);
  const m = new Uint32Array(16);
  for (let i = 0; i < 16; i++) m[i] = dv.getUint32(i * 4, true);
  return m;
}

// One compression step. `h` mutated in place; `t` = cumulative byte count
// processed BEFORE this block (BLAKE2s counter), `last` = final block flag.
function compress(h, m, t, last) {
  const v = new Uint32Array(16);
  for (let i = 0; i < 8; i++) {
    v[i] = h[i];
    v[8 + i] = IV[i];
  }
  v[12] ^= t >>> 0; // t_low
  v[13] ^= 0; // t_high — 0 for < 2^32 byte inputs
  if (last) v[14] ^= MASK;

  for (let r = 0; r < 10; r++) {
    const s = SIGMA.subarray(r * 16, r * 16 + 16);
    g(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    g(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    g(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    g(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    g(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    g(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    g(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    g(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) >>> 0;
}

export function blake2s256(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  const input = Uint8Array.from(bytes);
  const len = input.length;

  // Parameter block, first LE uint32 = [digest_len=32, key_len=0, fanout=1, depth=1]
  const param = 32 | (1 << 16) | (1 << 24); // 0x01010020
  const h = new Uint32Array(IV);
  h[0] = (h[0] ^ param) >>> 0;

  // All complete blocks except the last one (the final block, even when it
  // is full, is always handled below with the final flag). `t` counts the
  // bytes processed THROUGH the end of each compressed block.
  let counter = 0;
  let off = 0;
  while (len - off > 64) {
    counter += 64;
    compress(h, toWords(input.subarray(off, off + 64)), counter, false);
    off += 64;
  }
  // Final block: the remaining `len - off` bytes (in [0, 64]) zero-padded to
  // 64. Its counter is the total input length `len`.
  const tail = new Uint8Array(64);
  if (off < len) tail.set(input.subarray(off), 0);
  compress(h, toWords(tail), counter + (len - off), true);

  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, h[i], true);
  return out;
}

export function blake2s256Hex(bytes) {
  const d = blake2s256(bytes);
  let hex = "";
  for (let i = 0; i < d.length; i++) hex += d[i].toString(16).padStart(2, "0");
  return hex;
}
