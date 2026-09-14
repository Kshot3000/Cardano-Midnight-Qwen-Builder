import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  dedupeByKey,
  parseProposal,
  parseVote,
  finalTallies,
  motionStatus,
  parseListField,
  authorityTimeline,
  authorityAtBlock,
  computeGovernanceStats,
  governanceHealth,
} from "../src/governance.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(path.join(here, "fixtures", "governance.json"), "utf8")
);

// ---------- dedupeByKey ----------
test("dedupeByKey keeps first occurrence, preserves order", () => {
  const out = dedupeByKey(
    [
      { id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }, { id: 2 },
    ],
    (x) => String(x.id)
  );
  assert.deepEqual(out.map((x) => x.id), [1, 2, 3]);
});

test("dedupeByKey with no keyFn dedupes by JSON", () => {
  const out = dedupeByKey([{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 9 }]);
  assert.equal(out.length, 2);
});

test("dedupeByKey tolerates null/empty", () => {
  assert.deepEqual(dedupeByKey(null), []);
  assert.deepEqual(dedupeByKey([]), []);
});

// ---------- parseProposal ----------
test("parseProposal maps the positional tuple", () => {
  const p = parseProposal({
    block_height: "42",
    block_hash: "0xabc",
    timestamp: "100",
    data: ["5VOTER", "3", "0xf00", "4"],
  });
  assert.equal(p.proposer, "5VOTER");
  assert.equal(p.motionIndex, 3);
  assert.equal(p.motionHash, "0xf00");
  assert.equal(p.threshold, 4);
  assert.equal(p.block, 42);
  assert.equal(p.timestamp, 100);
});

test("parseProposal returns nulls on malformed input", () => {
  const p = parseProposal({ data: ["only", "one"] });
  assert.equal(p.motionHash, null);
  assert.equal(p.threshold, null);
  assert.deepEqual(parseProposal(null), {
    proposer: null, motionIndex: null, motionHash: null,
    threshold: null, block: null, timestamp: null,
  });
});

// ---------- parseVote ----------
test("parseVote maps vote true/false and cumulative tally", () => {
  const v = parseVote({
    block_height: "9",
    timestamp: "200",
    data: ["5VOTER", "0xf00", "true", "4", "0"],
  });
  assert.equal(v.voter, "5VOTER");
  assert.equal(v.motionHash, "0xf00");
  assert.equal(v.vote, true);
  assert.equal(v.ayes, 4);
  assert.equal(v.anos, 0);
  assert.equal(v.block, 9);
});

test("parseVote: 'false' vote and unknown token", () => {
  assert.equal(parseVote({ data: ["v", "m", "false", "0", "5"] }).vote, false);
  assert.equal(parseVote({ data: ["v", "m", "maybe", "1", "1"] }).vote, null);
});

test("parseVote malformed returns safe defaults", () => {
  const v = parseVote({ data: [] });
  assert.equal(v.vote, null);
  assert.equal(v.ayes, 0);
  assert.equal(v.voter, null);
});

// ---------- finalTallies ----------
test("finalTallies picks the LATEST cumulative event per motion", () => {
  const tallies = finalTallies([
    { timestamp: "100", block_height: "1", data: ["a", "M", "true", "1", "0"] },
    { timestamp: "200", block_height: "2", data: ["b", "M", "true", "2", "0"] },
    { timestamp: "300", block_height: "3", data: ["c", "M", "true", "3", "0"] },
    { timestamp: "50",  block_height: "0", data: ["z", "M", "true", "9", "9"] }, // older, must be ignored
    { timestamp: "300", block_height: "4", data: ["d", "M", "false", "3", "1"] }, // same ts, higher block wins
  ]);
  const m = tallies.get("M");
  assert.equal(m.ayes, 3);
  assert.equal(m.anos, 1);
  assert.equal(m.events, 5);
  assert.equal(m.voters.size, 5); // a, b, c, z, d — all distinct voters
});

test("finalTallies separates motions", () => {
  const t = finalTallies([
    { timestamp: "1", block_height: "1", data: ["a", "M1", "true", "1", "0"] },
    { timestamp: "1", block_height: "1", data: ["b", "M2", "false", "0", "1"] },
  ]);
  assert.equal(t.get("M1").ayes, 1);
  assert.equal(t.get("M2").anos, 1);
});

test("finalTallies empty/invalid input", () => {
  assert.deepEqual(finalTallies(null), new Map());
  assert.deepEqual(finalTallies([{}]), new Map());
});

// ---------- motionStatus ----------
test("motionStatus approved when ayes >= threshold", () => {
  assert.equal(motionStatus({ threshold: 4 }, { ayes: 4, anos: 0 }, 9), "approved");
  assert.equal(motionStatus({ threshold: 4 }, { ayes: 5, anos: 0 }, 9), "approved");
});

test("motionStatus rejected when even all remaining yes can't reach threshold", () => {
  // cast=5, members=9, ayes=0 -> best = 0 + (9-5)=4 < 5
  assert.equal(motionStatus({ threshold: 5 }, { ayes: 0, anos: 5 }, 9), "rejected");
});

test("motionStatus active when undecided / unknown members", () => {
  assert.equal(motionStatus({ threshold: 4 }, null, 9), "active");
  // no members info -> can't prove rejection
  assert.equal(motionStatus({ threshold: 5 }, { ayes: 0, anos: 5 }, null), "active");
  // still possible: ayes=1, cast=1, members=9, best=1+8=9>=5
  assert.equal(motionStatus({ threshold: 5 }, { ayes: 1, anos: 0 }, 9), "active");
});

test("motionStatus handles missing threshold", () => {
  assert.equal(motionStatus(null, { ayes: 9 }, 9), "active");
  assert.equal(motionStatus({ threshold: null }, { ayes: 9 }, 9), "active");
});

// ---------- parseListField ----------
test("parseListField splits a bracketed list", () => {
  assert.deepEqual(parseListField("[a, b, c]"), ["a", "b", "c"]);
  assert.deepEqual(parseListField("  [ a , b ]  "), ["a", "b"]);
});

test("parseListField tolerates no brackets / empty / non-string", () => {
  assert.deepEqual(parseListField("a, b"), ["a", "b"]);
  assert.deepEqual(parseListField("[]"), []);
  assert.deepEqual(parseListField(""), []);
  assert.deepEqual(parseListField(null), []);
  assert.deepEqual(parseListField(123), []);
});

// ---------- authorityTimeline ----------
test("authorityTimeline dedupes payloads and sorts by block asc", () => {
  const tl = authorityTimeline([
    { block_height: "300", timestamp: "3", data: ["[m1, m2]", "[h1, h2]"] },
    { block_height: "100", timestamp: "1", data: ["[m0]", "[h0]"] },
    { block_height: "300", timestamp: "3", data: ["[m1, m2]", "[h1, h2]"] }, // dup
  ]);
  assert.equal(tl.length, 2);
  assert.deepEqual(tl.map((r) => r.block), [100, 300]);
  assert.equal(tl[1].count, 2);
  assert.deepEqual(tl[1].members, ["m1", "m2"]);
  assert.deepEqual(tl[1].pubkeys, ["h1", "h2"]);
});

test("authorityTimeline drops malformed events", () => {
  assert.deepEqual(authorityTimeline([{}, { data: "nope" }]), []);
});

// ---------- authorityAtBlock ----------
test("authorityAtBlock returns latest reset at-or-before block", () => {
  const tl = [
    { block: 1, members: ["a"] },
    { block: 100, members: ["b", "c"] },
    { block: 300, members: ["d", "e", "f"] },
  ];
  assert.equal(authorityAtBlock(tl, 50).members.length, 1);
  assert.equal(authorityAtBlock(tl, 100).members.length, 2);
  assert.equal(authorityAtBlock(tl, 299).members.length, 2);
  assert.equal(authorityAtBlock(tl, 999).members.length, 3);
});

test("authorityAtBlock null when nothing precedes block", () => {
  assert.equal(authorityAtBlock([{ block: 100, members: ["a"] }], 50), null);
  assert.equal(authorityAtBlock([], 10), null);
  assert.equal(authorityAtBlock(null, 10), null);
});

// ---------- computeGovernanceStats (end-to-end on real live data) ----------
test("computeGovernanceStats reproduces live council decision", () => {
  const s = computeGovernanceStats(FIXTURE);
  const council = s.committees.find((c) => c.key === "council");
  // 5 raw proposal events -> 4 unique motions (one duplicate proposer re-propose)
  assert.equal(council.rawProposalEvents, 5);
  assert.equal(council.motionCount, 4);
  assert.equal(council.uniqueMotions, 4);
  // every council motion approved at 4/4
  for (const m of council.motions) {
    assert.equal(m.threshold, 4);
    assert.equal(m.ayes, 4);
    assert.equal(m.status, "approved");
    assert.equal(m.members, 9);
  }
  assert.deepEqual(council.byStatus, { approved: 4, rejected: 0, active: 0 });
});

test("computeGovernanceStats reproduces live tech committee decision (incl. a rejection)", () => {
  const s = computeGovernanceStats(FIXTURE);
  const tech = s.committees.find((c) => c.key === "technicalCommittee");
  assert.equal(tech.rawProposalEvents, 6);
  assert.equal(tech.motionCount, 6);
  // the 0-yes/5-no motion must be classified rejected
  const rejected = tech.motions.filter((m) => m.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].ayes, 0);
  assert.equal(rejected[0].anos, 5);
  assert.equal(rejected[0].threshold, 5);
  assert.equal(tech.byStatus.approved, 5);
  assert.equal(tech.byStatus.rejected, 1);
});

test("computeGovernanceStats totalActions matches the endpoint's own summary", () => {
  const s = computeGovernanceStats(FIXTURE);
  assert.equal(s.totalActions, FIXTURE.summary.totalGovernanceActions);
  assert.equal(s.totalActions, 75);
  assert.equal(s.lastActivity, FIXTURE.summary.lastActivity);
});

test("computeGovernanceStats builds an authority timeline & latest authority", () => {
  const s = computeGovernanceStats(FIXTURE);
  assert.equal(s.authorityTimeline.length, 5); // 8 raw events -> 5 unique payloads
  // ascending by block
  for (let i = 1; i < s.authorityTimeline.length; i++) {
    assert.ok(s.authorityTimeline[i].block >= s.authorityTimeline[i - 1].block);
  }
  assert.equal(s.latestAuthority.block, 573609);
  assert.equal(s.latestAuthority.count, 9);
});

test("computeGovernanceStats tolerates an empty/missing payload", () => {
  const s = computeGovernanceStats({});
  assert.equal(s.committees.length, 2);
  for (const c of s.committees) {
    assert.equal(c.motionCount, 0);
  }
  assert.equal(s.totalActions, 0);
  assert.equal(s.latestAuthority, null);
  assert.deepEqual(s.authorityTimeline, []);
});

// ---------- governanceHealth ----------
test("governanceHealth scores the real fixture in a sane band", () => {
  const s = computeGovernanceStats(FIXTURE);
  const nowSec = s.lastActivity; // pretend "now" is right at last activity => fresh
  const h = governanceHealth(s, nowSec);
  assert.ok(h.score >= 0 && h.score <= 100, "score within 0-100");
  assert.ok(Array.isArray(h.checks) && h.checks.length === 4, "four named checks");
  // every component max 25, sum equals score
  assert.equal(h.checks.reduce((t, c) => t + c.pts, 0), h.score);
  for (const c of h.checks) assert.equal(c.max, 25);
  // all 10 motions decided => decision-flow component should be full
  const decision = h.checks[0];
  assert.equal(decision.pts, 25);
  // healthy status for a fully-decided, fresh, rotating authority
  assert.equal(h.status, "healthy");
});

test("governanceHealth without nowSec still scores (no fabricated recency)", () => {
  const s = computeGovernanceStats(FIXTURE);
  const h = governanceHealth(s, undefined);
  assert.ok(h.score >= 0 && h.score <= 100);
  const fresh = h.checks[3];
  // some history exists (totalActions>0) -> baseline credit, but no full freshness
  assert.ok(fresh.pts >= 5 && fresh.pts < 25);
});

test("governanceHealth is low for an empty network", () => {
  const s = computeGovernanceStats({});
  const h = governanceHealth(s, 1_000_000_000);
  assert.equal(h.score, 0);
  assert.equal(h.status, "at-risk");
  for (const c of h.checks) assert.equal(c.pts, 0);
});

test("governanceHealth freshness decays with activity age", () => {
  const s = computeGovernanceStats(FIXTURE);
  const base = s.lastActivity;
  const fresh = governanceHealth(s, base + 10 * 86400).checks[3].pts;   // 10d -> full
  const month = governanceHealth(s, base + 80 * 86400).checks[3].pts;    // 80d -> 15
  const old = governanceHealth(s, base + 400 * 86400).checks[3].pts;     // >365d -> 0
  assert.equal(fresh, 25);
  assert.equal(month, 15);
  assert.equal(old, 0);
});

test("governanceHealth status bands", () => {
  const s = computeGovernanceStats(FIXTURE);
  // healthy: everything fresh & decided
  assert.equal(governanceHealth(s, s.lastActivity).status, "healthy");
  // force a low score via an empty network
  assert.equal(governanceHealth(computeGovernanceStats({}), 0).status, "at-risk");
});
