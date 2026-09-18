// midnight.js — pure logic for the Midnight tx/block lookup.
// No DOM, no fetch: everything here is testable with node --test.

export const API_BASE = "https://mainnet.nightforge.jp";

// Validate a Midnight hash: 0x/0X-prefixed hex, even length, 8..128 hex chars.
export function isValidHash(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  const hex = /^0x/i.test(t) ? t.slice(2) : t;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return false;
  if (hex.length % 2 !== 0) return false;
  return hex.length >= 8 && hex.length <= 128;
}

// Validate a block height: non-negative integer (string or number).
export function isValidHeight(s) {
  if (typeof s === "number") return Number.isInteger(s) && s >= 0;
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!/^\d+$/.test(t)) return false;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 0;
}

// Classify a user query: {kind:'hash'|'height', value} or null.
export function parseQuery(input) {
  if (typeof input !== "string") return null;
  const t = input.trim();
  if (!t) return null;
  if (isValidHash(t)) return { kind: "hash", value: t };
  if (isValidHeight(t)) return { kind: "height", value: Number(t) };
  return null;
}

// Pick a block's display fields from a NightForge /api/blocks row.
// Returns null when the row carries no usable data.
export function blockView(b) {
  if (!b || typeof b !== "object") return null;
  const view = {
    height: typeof b.height === "number" ? b.height : null,
    hash: typeof b.hash === "string" ? b.hash : null,
    timestamp: typeof b.timestamp === "number" ? b.timestamp : null,
    extrinsicsCount: typeof b.extrinsics_count === "number" ? b.extrinsics_count : null,
  };
  if (view.height === null && view.hash === null) return null;
  return view;
}

// Format a unix-seconds timestamp to a short UTC string; null → "–".
export function formatTime(sec) {
  if (typeof sec !== "number" || !isFinite(sec)) return "–";
  const d = new Date(sec * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// Shorten a hash for display: 0x1a2b…c3d4 (first 10 / last 8 chars of hex).
export function shortHash(h) {
  if (typeof h !== "string") return "–";
  const hex = h.startsWith("0x") ? h.slice(2) : h;
  if (hex.length <= 18) return h;
  return "0x" + hex.slice(0, 8) + "…" + hex.slice(-6);
}

// Seconds between two timestamps → "Xh Ym" / "Xm Ys" / "Xs" human string.
export function formatAge(fromSec, toSec) {
  if (typeof fromSec !== "number" || typeof toSec !== "number") return "–";
  let s = Math.max(0, Math.round(toSec - fromSec));
  if (s < 90) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 90) return m + "m " + (s % 60) + "s";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

// Slice the first `n` items of a block list (defensive on non-arrays).
export function topBlocks(list, n = 10) {
  if (!Array.isArray(list) || n <= 0) return [];
  return list.slice(0, n).map(blockView).filter(Boolean);
}
