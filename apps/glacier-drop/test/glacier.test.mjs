import test from "node:test";
import assert from "node:assert/strict";

import {
  NIGHT_DECIMALS,
  STAR_PER_NIGHT,
  TIMELINE,
  INCREMENT_COUNT,
  INCREMENT_PERIOD_MS,
  NIGHT_TOKEN,
  thawSchedule,
  thawStatus,
  thawProgress,
  daysBetween,
  thawDayOf360,
  thawDateForDay,
  allocationStatus,
  phaseStatus,
  starToNight,
  nightToStar,
  formatStar,
  bech32Encode,
  validateCardanoAddress,
} from "../src/glacier.js";

const DAY = 86_400_000;
const T_START = TIMELINE.thawStart; // 2025-12-10T00:00:00Z
const T_END = TIMELINE.thawEnd; // 2026-12-04T00:00:00Z

// ── constants ─────────────────────────────────────────────────────────────
test("constants match the official published schedule", () => {
  assert.equal(NIGHT_DECIMALS, 6);
  assert.equal(STAR_PER_NIGHT, 1_000_000);
  assert.equal(INCREMENT_COUNT, 4);
  assert.equal(INCREMENT_PERIOD_MS, 90 * DAY);
  assert.equal(NIGHT_TOKEN.decimals, 6);
  assert.equal(NIGHT_TOKEN.policyId, "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa");
  assert.equal(Buffer.from("NIGHT").toString("hex"), NIGHT_TOKEN.assetNameHex);
  assert.equal(NIGHT_TOKEN.totalSupplyStar, 24_000_000_000 * STAR_PER_NIGHT);
});

test("timeline spans the published 360-day thaw period", () => {
  assert.equal(daysBetween(T_START, T_END), 359); // Dec 10 → Dec 4 is 359 days apart
  // last possible first-thaw day 90 → last installment on day 90+270 = 360
  const last = thawSchedule(1000, T_START + 89 * DAY)[3].dateMs;
  assert.equal(thawDayOf360(last), 360);
});

// ── thawSchedule ──────────────────────────────────────────────────────────
test("thawSchedule: 4 installments, equal spacing, amounts sum to total", () => {
  const total = 10_000_000; // 10 NIGHT
  const s = thawSchedule(total, T_START + 10 * DAY);
  assert.equal(s.length, 4);
  const q = Math.floor(total / 4);
  assert.deepEqual(
    s.map((r) => r.amountStar),
    [q, q, q, total - 3 * q]
  );
  assert.equal(s.reduce((sum, r) => sum + r.amountStar, 0), total);
  for (let i = 1; i < s.length; i++) {
    assert.equal(s[i].dateMs - s[i - 1].dateMs, INCREMENT_PERIOD_MS);
  }
});

test("thawSchedule: first installment lands exactly on the first-unlock date", () => {
  const first = T_START + 41 * DAY;
  const s = thawSchedule(123_456, first);
  assert.equal(s[0].dateMs, first);
});

test("thawSchedule: last installment absorbs the remainder (full release guaranteed)", () => {
  // total = 3999 → floor(3999/4) = 999 for first three, last gets 999 + (3999 - 3*999) = 1002
  const s = thawSchedule(3999, T_START);
  assert.equal(s[0].amountStar, 999);
  assert.equal(s[1].amountStar, 999);
  assert.equal(s[2].amountStar, 999);
  assert.equal(s[3].amountStar, 1002);
  assert.equal(s.reduce((a, r) => a + r.amountStar, 0), 3999);
  assert.equal(s[3].dateMs, T_START + 3 * INCREMENT_PERIOD_MS);
});

test("thawSchedule: tiny allocation is fully released (nothing stranded)", () => {
  const s = thawSchedule(7, T_START);
  // floor(7/4) = 1 for the first three, last takes the balance
  assert.deepEqual(
    s.map((r) => r.amountStar),
    [1, 1, 1, 4]
  );
  assert.equal(s.reduce((a, r) => a + r.amountStar, 0), 7);
});

test("thawSchedule: zero allocation is legal (all-zero schedule)", () => {
  const s = thawSchedule(0, T_START);
  assert.equal(s.length, 4);
  assert.equal(s.reduce((a, r) => a + r.amountStar, 0), 0);
});

test("thawSchedule: rejects non-integer / negative totals", () => {
  assert.throws(() => thawSchedule(1.5, T_START), /non-negative integer/);
  assert.throws(() => thawSchedule(-1, T_START), /non-negative integer/);
  assert.throws(() => thawSchedule(10, 1.5), /integer millisecond/);
});

test("thawSchedule: first-thaw day n → installments at days n, n+90, n+180, n+270", () => {
  // mirrors the official docs table row: 1 → 1, 91, 181, 271
  const s = thawSchedule(100, thawDateForDay(1));
  assert.deepEqual(s.map((r) => thawDayOf360(r.dateMs)), [1, 91, 181, 271]);
  const s2 = thawSchedule(100, thawDateForDay(90));
  assert.deepEqual(s2.map((r) => thawDayOf360(r.dateMs)), [90, 180, 270, 360]);
});

// ── thawStatus ────────────────────────────────────────────────────────────
test("thawStatus: before first unlock → nothing unlocked", () => {
  const st = thawStatus(4_000_000, T_START, T_START - 1);
  assert.equal(st.unlocked, 0);
  assert.equal(st.unlockedStar, 0);
  assert.equal(st.lockedStar, 4_000_000);
  assert.equal(st.fullyThawed, false);
  assert.ok(st.next);
});

test("thawStatus: at the first unlock → 1 installment unlocked", () => {
  const total = 8_000_000; // exactly 4× 2M — even
  const st = thawStatus(total, T_START, T_START);
  assert.equal(st.unlocked, 1);
  assert.equal(st.unlockedStar, 2_000_000);
  assert.equal(st.lockedStar, 6_000_000);
});

test("thawStatus: midway (2 of 4 unlocked)", () => {
  const total = 8_000_000;
  const st = thawStatus(total, T_START, T_START + 100 * DAY);
  assert.equal(st.unlocked, 2);
  assert.equal(st.unlockedStar, 4_000_000);
  assert.equal(st.next.dateMs, T_START + 2 * INCREMENT_PERIOD_MS);
});

test("thawStatus: fully thawed after the 4th installment", () => {
  const total = 9_000_001; // odd: 2,250,000 × 3 + 3,000,001
  const first = T_START + 20 * DAY;
  const st = thawStatus(total, first, first + 3 * INCREMENT_PERIOD_MS);
  assert.equal(st.unlocked, 4);
  assert.equal(st.unlockedStar, total);
  assert.equal(st.lockedStar, 0);
  assert.equal(st.fullyThawed, true);
  assert.equal(st.next, null);
  // one millisecond BEFORE the 4th unlock: 3 of 4
  const st2 = thawStatus(total, first, first + 3 * INCREMENT_PERIOD_MS - 1);
  assert.equal(st2.unlocked, 3);
  assert.equal(st2.unlockedStar, 3 * Math.floor(total / 4));
  assert.equal(st2.lockedStar, total - 3 * Math.floor(total / 4));
});

// ── thawProgress ──────────────────────────────────────────────────────────
test("thawProgress: clamped at the ends and linear in between", () => {
  assert.equal(thawProgress(T_START - DAY), 0);
  assert.equal(thawProgress(T_START), 0);
  assert.equal(thawProgress(T_END), 1);
  assert.equal(thawProgress(T_END + DAY), 1);
  const mid = (T_START + T_END) / 2;
  assert.ok(Math.abs(thawProgress(mid) - 0.5) < 1e-9);
});

// ── day helpers ───────────────────────────────────────────────────────────
test("thawDayOf360 / thawDateForDay are exact inverses inside the period", () => {
  for (const n of [1, 90, 181, 360]) {
    assert.equal(thawDayOf360(thawDateForDay(n)), n);
  }
  assert.equal(thawDateForDay(1), T_START);
  assert.equal(thawDateForDay(360), T_START + 359 * DAY);
});

// ── allocationStatus ──────────────────────────────────────────────────────
test("allocationStatus: matches the docs example (first thaw day 25 → 25/115/205/295)", () => {
  const total = 4_000_000; // 4 NIGHT
  const a = allocationStatus(total, 25, T_START + 500 * DAY);
  assert.deepEqual(a.schedule.map((r) => thawDayOf360(r.dateMs)), [25, 115, 205, 295]);
  assert.equal(a.unlocked, 4);
  assert.equal(a.fullyThawed, true);
  assert.equal(a.lastThawDay, 295);
});

test("allocationStatus: current status at a mid-window date", () => {
  const total = 10_000_000; // 10 NIGHT → 2.5M × 3 + 2.5M (even)
  const firstDay = 30;
  const now = T_START + 120 * DAY; // day 121 → past thaw 1 (day 30), not 2 (day 120+... check)
  const a = allocationStatus(total, firstDay, now);
  // installments on days 30, 120, 210, 300 → at day 121 both 1 and 2 are unlocked
  assert.equal(a.unlocked, 2);
  assert.equal(a.unlockedStar, 5_000_000);
  assert.equal(a.next.dateMs, thawDateForDay(210));
});

test("allocationStatus: grace period ends 90 days after the last thaw", () => {
  const a = allocationStatus(1_000_000, 1, T_START);
  assert.equal(a.lastThawDay, 271);
  assert.equal(a.redemptionGraceEndMs, thawDateForDay(271) + 90 * DAY);
});

test("allocationStatus: rejects out-of-range first thaw days", () => {
  assert.throws(() => allocationStatus(100, 0, T_START), /1\.\.90/);
  assert.throws(() => allocationStatus(100, 91, T_START), /1\.\.90/);
  assert.throws(() => allocationStatus(100, 4.5, T_START), /1\.\.90/);
});

// ── phaseStatus ───────────────────────────────────────────────────────────
test("phaseStatus: all claim phases done, thawing still open (2026-09-14)", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  const p = phaseStatus(now);
  assert.equal(p.glacierClaim, "done");
  assert.equal(p.scavengerMine, "done");
  assert.equal(p.thawing, "open");
});

test("phaseStatus: before everything → all upcoming; after everything → all done", () => {
  const early = Date.parse("2025-01-01T00:00:00Z");
  const late = Date.parse("2027-01-01T00:00:00Z");
  assert.deepEqual(phaseStatus(early), {
    glacierClaim: "upcoming",
    scavengerMine: "upcoming",
    thawing: "upcoming",
  });
  assert.deepEqual(phaseStatus(late), {
    glacierClaim: "done",
    scavengerMine: "done",
    thawing: "done",
  });
});

// ── STAR ⇄ NIGHT ──────────────────────────────────────────────────────────
test("starToNight / nightToStar round-trip on integers", () => {
  assert.equal(starToNight(1_234_567), 1.234567);
  assert.equal(nightToStar(1.5), 1_500_000);
  assert.equal(starToNight(nightToStar(123.456789)), 123.456789);
});

test("formatStar renders NIGHT with grouping and up to 6 dp", () => {
  assert.equal(formatStar(0), "0");
  assert.equal(formatStar(STAR_PER_NIGHT * 1_000_000), "1,000,000");
  assert.equal(formatStar(1_000_000 + 5), "1"); // 5 STARs of dust → 2 dp rounds away
  assert.equal(formatStar(NIGHT_TOKEN.totalSupplyStar), "24,000,000,000");
});

// ── bech32 / address validation ───────────────────────────────────────────
// Known-good vectors (real addresses; the stake one is generated from a
// well-formed 0x01 header + 28-byte credential via a reference encoder).
const GOOD_ADDR = "addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v";
const GOOD_STAKE = "stake1qygjyv6y24n80zye42aueh0w7qq3yge5g4txw7yfn24mengp79pv0";

test("validateCardanoAddress: accepts a valid mainnet addr1 address", () => {
  const r = validateCardanoAddress(GOOD_ADDR);
  assert.equal(r.ok, true);
  assert.equal(r.hrp, "addr");
  assert.equal(r.network, "mainnet");
  assert.equal(r.purpose, "key");
  // A base addr1q is 1 header + 28-byte payment + 28-byte stake-cred = 57 bytes
  assert.equal(r.byteLength, 57);
});

test("validateCardanoAddress: accepts a valid mainnet stake address", () => {
  const r = validateCardanoAddress(GOOD_STAKE);
  assert.equal(r.ok, true);
  assert.equal(r.hrp, "stake");
  assert.equal(r.network, "mainnet");
  // A stake-cred address is 1 header + 28-byte credential = 29 bytes
  assert.equal(r.byteLength, 29);
});

test("validateCardanoAddress: case-insensitive", () => {
  assert.equal(validateCardanoAddress(GOOD_ADDR.toUpperCase()).ok, true);
  assert.equal(validateCardanoAddress("  " + GOOD_ADDR + "  ").ok, true);
});

test("validateCardanoAddress: rejects empty / junk", () => {
  assert.equal(validateCardanoAddress("").ok, false);
  assert.equal(validateCardanoAddress("hello").ok, false);
  assert.equal(validateCardanoAddress("0xabcdef").ok, false);
  assert.equal(validateCardanoAddress("notbech32!!!").ok, false);
});

test("validateCardanoAddress: rejects a single corrupted character (checksum)", () => {
  // flip one character in the middle of the data part
  const corrupted = GOOD_ADDR.slice(0, 30) + (GOOD_ADDR[30] === "a" ? "b" : "a") + GOOD_ADDR.slice(31);
  const r = validateCardanoAddress(corrupted);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-checksum");
});

test("validateCardanoAddress: rejects wrong hrp and bad characters", () => {
  assert.equal(validateCardanoAddress("cardano" + GOOD_ADDR.slice(4)).ok, false);
  assert.equal(validateCardanoAddress(GOOD_ADDR.replace(/[^0-9]/g, "z").slice(0, 60)).ok, false);
});

test("bech32Encode: round-trips through the validator", () => {
  // decode GOOD_ADDR's payload by validating, then re-encode its bytes
  const r = validateCardanoAddress(GOOD_ADDR);
  assert.ok(r.ok);
  // re-derive payload bytes independently from the known 29-byte payload
  // (header 0x01 + 28-byte payment key hash)
  const bytes = [0x01, ...Array.from({ length: 28 }, (_, i) => (0x40 + i) & 0xff)];
  const enc = bech32Encode("addr", bytes);
  assert.equal(validateCardanoAddress(enc).ok, true);
  assert.equal(validateCardanoAddress(enc).byteLength, 29);
});
