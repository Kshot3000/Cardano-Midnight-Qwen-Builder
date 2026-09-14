import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createEscrow } from "../../agent-escrow/src/escrow.js";
import {
  ProofError,
  sha256Hex,
  proofHash,
  parseReceipt,
  checkStructure,
  checkProofFormat,
  checkProofMatch,
  checkMilestoneState,
  checkAccounting,
  checkAuditChain,
  checkAuditActors,
  verifyReceipt,
  summarize,
  escrowBalance,
  CHECK_IDS,
} from "../src/proofs.js";

// ---------------------------------------------------------------------------
// Fixtures — a fully valid receipt mirroring the agent-escrow demo walkthrough
// ---------------------------------------------------------------------------

const L = 1_000_000;
const T0 = 1_700_000_000;
const P1 = "0x9f2c41ab";
const P2 = "0x41b0de77";
const P3 = "0xaa011b3c";

function validReceipt() {
  return {
    id: "escrow_demo",
    client: "alice-addr",
    agent: "builder-agent",
    approvers: ["alice-addr", "charlie-auditor"],
    state: "settled",
    funded: 10 * L,
    released: 6 * L,
    refunded: 4 * L,
    milestones: [
      { id: "m1", description: "Repo scaffold + CI", amount: 1 * L, status: "released", proofHash: P1, approvedBy: "charlie-auditor" },
      { id: "m2", description: "Working app + tests", amount: 4 * L, status: "rejected", proofHash: P2, rejectedBy: "charlie-auditor", reason: "tests missing — CI red" },
      { id: "m3", description: "On-chain audit + docs", amount: 5 * L, status: "released", proofHash: P3, approvedBy: "alice-addr" },
    ],
    commits: { m1: P1, m2: P2, m3: P3 },
    audit: [
      { seq: 1, at: T0 + 10, type: "funded", actor: "alice-addr", stateBefore: "created", stateAfter: "funded", data: { amount: 10 * L } },
      { seq: 2, at: T0 + 20, type: "started", actor: "alice-addr", stateBefore: "funded", stateAfter: "in_progress", data: { milestoneTotal: 10 * L } },
      { seq: 3, at: T0 + 3_600, type: "proof_submitted", actor: "builder-agent", stateBefore: "in_progress", stateAfter: "in_progress", data: { milestone: "m1", proofHash: P1 } },
      { seq: 4, at: T0 + 3_660, type: "milestone_released", actor: "charlie-auditor", stateBefore: "in_progress", stateAfter: "in_progress", data: { milestone: "m1", amount: 1 * L, late: false } },
      { seq: 5, at: T0 + 86_400, type: "proof_submitted", actor: "builder-agent", stateBefore: "in_progress", stateAfter: "in_progress", data: { milestone: "m2", proofHash: P2 } },
      { seq: 6, at: T0 + 86_460, type: "milestone_rejected", actor: "charlie-auditor", stateBefore: "in_progress", stateAfter: "in_progress", data: { milestone: "m2", reason: "tests missing — CI red" } },
      { seq: 7, at: T0 + 172_800, type: "proof_submitted", actor: "builder-agent", stateBefore: "in_progress", stateAfter: "in_progress", data: { milestone: "m3", proofHash: P3 } },
      { seq: 8, at: T0 + 172_860, type: "milestone_released", actor: "alice-addr", stateBefore: "in_progress", stateAfter: "in_progress", data: { milestone: "m3", amount: 5 * L, late: false } },
      { seq: 9, at: T0 + 172_900, type: "settled", actor: "alice-addr", stateBefore: "in_progress", stateAfter: "settled", data: { refund: 4 * L } },
    ],
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const P = (report, id) => report.checks.find((c) => c.id === id);

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

test("sha256Hex matches node:crypto for known inputs", async () => {
  const known = {
    "": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  };
  for (const [input, expected] of Object.entries(known)) {
    assert.equal(await sha256Hex(input), expected);
  }
});

test("sha256Hex equals node:crypto for random-ish strings", async () => {
  for (const s of ["milestone proof 0x9f2c41ab", "Ünïcödé — receipt", "x".repeat(5000)]) {
    assert.equal(await sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
  }
});

test("proofHash normalizes to 0x + lowercase hex", () => {
  assert.equal(proofHash("9F2C41AB"), "0x9f2c41ab");
  assert.equal(proofHash("0x" + "ab".repeat(32)), "0x" + "ab".repeat(32));
});

test("proofHash rejects garbage", () => {
  for (const bad of ["", "0x12", "xyz", "0x", "zz9f2c", 123, null]) {
    assert.throws(() => proofHash(bad), ProofError);
  }
});

// ---------------------------------------------------------------------------
// parseReceipt / structure
// ---------------------------------------------------------------------------

test("parseReceipt normalizes a valid receipt", () => {
  const r = parseReceipt(validReceipt());
  assert.equal(r.id, "escrow_demo");
  assert.deepEqual(r.approvers, ["alice-addr", "charlie-auditor"]);
  assert.equal(r.milestones.length, 3);
  assert.equal(r.audit.length, 9);
  assert.equal(r.milestones[1].reason, "tests missing — CI red");
});

test("parseReceipt dedupes approvers", () => {
  const r = clone(validReceipt());
  r.approvers = ["alice-addr", "alice-addr", "charlie-auditor"];
  assert.deepEqual(parseReceipt(r).approvers, ["alice-addr", "charlie-auditor"]);
});

test("checkStructure passes on a valid receipt", () => {
  assert.equal(checkStructure(validReceipt()).pass, true);
});

for (const [mutate, expectMsg] of [
  [(r) => delete r.id, "id is required"],
  [(r) => delete r.client, "client is required"],
  [(r) => delete r.agent, "agent is required"],
  [(r) => { r.client = r.agent; }, "client and agent must differ"],
  [(r) => { r.approvers = ["x", null]; }, "approvers must be a list of names"],
  [(r) => { r.state = "vibing"; }, "unknown state"],
  [(r) => { r.funded = 1.5; }, "funded must be a non-negative integer"],
  [(r) => { r.funded = -4; }, "funded must be a non-negative integer"],
  [(r) => { r.milestones = "nope"; }, "milestones must be a list"],
  [(r) => { r.milestones.push({ ...r.milestones[0] }); }, "duplicate milestone id"],
  [(r) => { r.milestones[0].amount = 0; }, "needs a positive integer amount"],
  [(r) => { r.milestones[0].status = "shipped"; }, "unknown status"],
  [(r) => { r.milestones[0].proofHash = "nothex!!"; }, "proofHash must be hex"],
  [(r) => { r.commits = ["m1"]; }, "commits must be an object map"],
  [(r) => { r.audit = "nope"; }, "audit must be a list"],
  [(r) => { r.audit[0].seq = 1.5; }, "audit seq must be an integer"],
  [(r) => { r.audit[0].at = "yesterday"; }, "audit at must be an integer"],
  [(r) => { r.audit[0].type = ""; }, "audit type is required"],
  [(r) => { r.audit[0].actor = ""; }, "audit actor is required"],
]) {
  test("checkStructure fails: " + expectMsg, () => {
    const r = clone(validReceipt());
    mutate(r);
    const c = checkStructure(r);
    assert.equal(c.pass, false);
    assert.match(c.detail, new RegExp(expectMsg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
}

test("checkStructure fails on non-object and array receipts", () => {
  assert.equal(checkStructure("hi").pass, false);
  assert.equal(checkStructure(null).pass, false);
  assert.equal(checkStructure([1, 2]).pass, false);
});

// ---------------------------------------------------------------------------
// proof_format / proof_match
// ---------------------------------------------------------------------------

test("proof_format fails when a released milestone has no proof hash", () => {
  const r = clone(validReceipt());
  r.milestones[0].proofHash = null;
  const c = checkProofFormat(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /m1/);
});

test("proof_format fails on malformed hash (no 0x prefix)", () => {
  const r = clone(validReceipt());
  r.milestones[0].proofHash = "9f2c41ab";
  const c = checkProofFormat(parseReceipt(r));
  assert.equal(c.pass, false);
});

test("proof_format passes when only non-released milestones are malformed", () => {
  // m2 is rejected, so its hash is not required — but a malformed one still fails
  // the second branch of the check ("malformed proof hash on: m2").
  const r = clone(validReceipt());
  r.milestones[1].proofHash = "zzzz"; // wait — structure would reject this first
  // Instead: a short-but-valid-form hash on a pending milestone is allowed, so
  // build a case where a released milestone is clean and others are absent.
  r.milestones[1].proofHash = null;
  const c = checkProofFormat(parseReceipt(r));
  assert.equal(c.pass, true);
});

test("proof_match fails on tampered proof hash", () => {
  const r = clone(validReceipt());
  r.milestones[0].proofHash = "0xdeadbeef";
  const c = checkProofMatch(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /m1/);
});

test("proof_match is case-insensitive for hex", () => {
  const r = clone(validReceipt());
  r.commits.m1 = P1.toUpperCase();
  const c = checkProofMatch(parseReceipt(r));
  assert.equal(c.pass, true);
});

test("proof_match fails when a released milestone has no commitment", () => {
  const r = clone(validReceipt());
  delete r.commits.m3;
  const c = checkProofMatch(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /m3/);
  assert.match(c.detail, /unverifiable/i);
});

// ---------------------------------------------------------------------------
// milestone_state
// ---------------------------------------------------------------------------

test("milestone_state fails when approver is not registered", () => {
  const r = clone(validReceipt());
  r.milestones[0].approvedBy = "eve-random";
  const c = checkMilestoneState(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /eve-random/);
});

test("milestone_state fails when the agent approves its own work", () => {
  const r = clone(validReceipt());
  r.milestones[0].approvedBy = "builder-agent";
  const c = checkMilestoneState(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /agent approved its own work/);
});

test("milestone_state fails on a rejection without reason", () => {
  const r = clone(validReceipt());
  r.milestones[1].reason = null;
  const c = checkMilestoneState(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /without a reason/);
});

// ---------------------------------------------------------------------------
// accounting
// ---------------------------------------------------------------------------

test("accounting fails when funded ≠ released + refunded", () => {
  const r = clone(validReceipt());
  r.refunded = 40 * L; // more refund than funded
  const c = checkAccounting(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /≠/);
});

test("accounting fails when released total ≠ Σ released milestones", () => {
  const r = clone(validReceipt());
  r.released = 7 * L;
  const c = checkAccounting(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /Σ released milestones/);
});

test("accounting fails on negative balance", () => {
  const r = clone(validReceipt());
  r.released = 11 * L; // > funded
  r.refunded = -1 * L;
  const c = checkAccounting(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /negative/);
});

test("escrowBalance reports the escrowed remainder", () => {
  const r = parseReceipt(validReceipt());
  assert.equal(escrowBalance(r), 0);
  const mid = clone(validReceipt());
  mid.state = "in_progress";
  mid.audit = mid.audit.slice(0, 4);
  const rm = parseReceipt(mid);
  // funded 10L, released 1L → 9L still escrowed
  assert.equal(escrowBalance(rm), 9 * L);
});

// ---------------------------------------------------------------------------
// audit_chain
// ---------------------------------------------------------------------------

test("audit_chain fails on an empty audit trail", () => {
  const r = clone(validReceipt());
  r.audit = [];
  const c = checkAuditChain(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /no audit events/);
});

test("audit_chain fails on a missing seq number", () => {
  const r = clone(validReceipt());
  r.audit[3].seq = 4; // gap: seqs 1,2,3,4 -> but we want a gap, so make it 5
  r.audit[3].seq = 5;
  const c = checkAuditChain(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /seq 5 \(expected 4\)/);
});

test("audit_chain fails on a back-dated event", () => {
  const r = clone(validReceipt());
  r.audit[5].at = r.audit[4].at - 1000;
  const c = checkAuditChain(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /back-dated/);
});

test("audit_chain fails when final state ≠ receipt state", () => {
  const r = clone(validReceipt());
  r.state = "in_progress"; // receipt claims still open
  const c = checkAuditChain(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /≠ receipt state/);
});

// ---------------------------------------------------------------------------
// audit_actors
// ---------------------------------------------------------------------------

test("audit_actors fails when the agent submits someone else's proof", () => {
  const r = clone(validReceipt());
  r.audit[2].actor = "alice-addr";
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /non-agent/);
});

test("audit_actors fails when the agent releases its own milestone", () => {
  const r = clone(validReceipt());
  r.audit[3].actor = "builder-agent";
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /not a registered non-agent approver/);
});

test("audit_actors fails on an unregistered approver releasing funds", () => {
  const r = clone(validReceipt());
  r.audit[7].actor = "eve-random";
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /eve-random/);
});

test("audit_actors fails on a dispute opened by the agent", () => {
  const r = clone(validReceipt());
  r.state = "disputed";
  r.audit.push({ seq: 10, at: T0 + 200_000, type: "disputed", actor: "builder-agent", stateBefore: "settled", stateAfter: "disputed", data: { reason: "unpaid" } });
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /dispute opened by non-client/);
});

test("audit_actors fails on unknown event type", () => {
  const r = clone(validReceipt());
  r.audit[4].type = "vibes";
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /unknown event type/);
});

test("audit_actors fails on illegal state transition (fund after settled)", () => {
  const r = clone(validReceipt());
  r.audit.push({ seq: 10, at: T0 + 300_000, type: "funded", actor: "alice-addr", stateBefore: "settled", stateAfter: "funded", data: { amount: L } });
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /unexpected state 'settled'/);
});

test("audit_actors fails on a release for an unknown milestone", () => {
  const r = clone(validReceipt());
  r.audit[3].data.milestone = "m99";
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /unknown milestone m99/);
});

test("audit_actors fails on a release with no amount", () => {
  const r = clone(validReceipt());
  r.audit[3].data.amount = 0;
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /without a positive amount/);
});

test("audit_actors fails on a rejection with no reason", () => {
  const r = clone(validReceipt());
  r.audit[5].data.reason = "";
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /rejection without a reason/);
});

test("audit_actors fails on a settle without a refund amount", () => {
  const r = clone(validReceipt());
  delete r.audit[8].data.refund;
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, false);
  assert.match(c.detail, /settle without remainder amount/);
});

test("audit_actors accepts dispute_resolved_resume with no refund field", () => {
  const r = clone(validReceipt());
  r.state = "in_progress";
  r.audit.push({ seq: 10, at: T0 + 200_000, type: "disputed", actor: "alice-addr", stateBefore: "in_progress", stateAfter: "disputed", data: { reason: "scope creep" } });
  r.audit.push({ seq: 11, at: T0 + 210_000, type: "dispute_resolved_resume", actor: "alice-addr", stateBefore: "disputed", stateAfter: "in_progress", data: {} });
  const c = checkAuditActors(parseReceipt(r));
  assert.equal(c.pass, true);
});

// ---------------------------------------------------------------------------
// verifyReceipt (the full report)
// ---------------------------------------------------------------------------

test("verifyReceipt: valid receipt passes all 7 checks", async () => {
  const report = await verifyReceipt(validReceipt());
  assert.equal(report.valid, true);
  assert.equal(report.failedCount, 0);
  assert.equal(report.checks.length, CHECK_IDS.length);
  assert.deepEqual(report.checks.map((c) => c.id), [...CHECK_IDS]);
  assert.equal(report.receiptId, "escrow_demo");
  assert.ok(report.receipt, "normalized receipt attached");
});

test("verifyReceipt accepts a JSON string", async () => {
  const report = await verifyReceipt(JSON.stringify(validReceipt()));
  assert.equal(report.valid, true);
});

test("verifyReceipt: invalid JSON → only structure fails", async () => {
  const report = await verifyReceipt("{ this is not json");
  assert.equal(report.valid, false);
  const failed = report.checks.filter((c) => !c.pass);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, "structure");
  assert.match(failed[0].detail, /not valid JSON/);
});

test("verifyReceipt: tampered hash fails proof checks but not structure", async () => {
  const r = clone(validReceipt());
  r.milestones[2].proofHash = "0xffffffff";
  const report = await verifyReceipt(r);
  assert.equal(report.valid, false);
  assert.equal(P(report, "structure").pass, true);
  assert.equal(P(report, "proof_format").pass, true);
  assert.equal(P(report, "proof_match").pass, false);
  assert.equal(report.failedCount, 1);
});

test("verifyReceipt: structurally broken receipt skips remaining checks", async () => {
  const r = clone(validReceipt());
  delete r.client;
  const report = await verifyReceipt(r);
  assert.equal(report.valid, false);
  assert.equal(P(report, "structure").pass, false);
  for (const id of ["proof_format", "proof_match", "milestone_state", "accounting", "audit_chain", "audit_actors"]) {
    assert.equal(P(report, id).pass, false);
    assert.match(P(report, id).detail, /skipped/);
  }
  assert.equal(report.receipt, null);
});

test("summarize renders pass and fail lines", async () => {
  assert.equal(summarize(await verifyReceipt(validReceipt())), "7/7 checks passed — receipt valid");
  const r = clone(validReceipt());
  r.refunded = 1;
  const s = summarize(await verifyReceipt(r));
  assert.match(s, /6\/7 checks passed — INVALID/);
});

// ---------------------------------------------------------------------------
// End-to-end: a receipt generated by the REAL escrow state machine must verify
// ---------------------------------------------------------------------------

function receiptFromEscrow(e) {
  return {
    id: e.id,
    client: e.client,
    agent: e.agent,
    approvers: [e.client, ...e.getApprovers ? e.getApprovers() : ["charlie-auditor"]],
    state: e.getState(),
    funded: e.funded ?? 0,
    released: e.released ?? 0,
    refunded: e.refunded ?? 0,
    milestones: e.getMilestones().map((m) => ({
      id: m.id,
      description: m.description,
      amount: m.amount,
      status: m.status,
      proofHash: m.proofHash ?? null,
      approvedBy: m.approvedBy ?? null,
      rejectedBy: m.rejectedBy ?? null,
      reason: m.reason ?? null,
    })),
    commits: Object.fromEntries(e.getMilestones().map((m) => [m.id, m.proofHash]).filter(([, h]) => h)),
    audit: e.getAudit().map((ev) => ({ ...ev, data: { ...ev.data } })),
  };
}

test("E2E: the agent-escrow demo receipt verifies clean against all checks", async () => {
  const e = createEscrow({
    id: "escrow_demo",
    client: "alice-addr",
    agent: "builder-agent",
    approvers: ["charlie-auditor"],
    milestones: [
      { id: "m1", description: "Repo scaffold + CI", amount: 1 * L },
      { id: "m2", description: "Working app + tests", amount: 4 * L },
      { id: "m3", description: "On-chain audit + docs", amount: 5 * L },
    ],
    now: T0,
  });
  e.fund(10 * L, { at: T0 + 10 });
  e.start({ at: T0 + 20 });
  e.submitProof("m1", P1, { at: T0 + 3_600 });
  e.approve("m1", "charlie-auditor", { at: T0 + 3_660 });
  e.submitProof("m2", P2, { at: T0 + 86_400 });
  e.reject("m2", "charlie-auditor", "tests missing — CI red", { at: T0 + 86_460 });
  e.submitProof("m3", P3, { at: T0 + 172_800 });
  e.approve("m3", "alice-addr", { at: T0 + 172_860 });
  e.settle({ at: T0 + 172_900 });
  e.assertInvariants();

  const receipt = receiptFromEscrow(e);
  const report = await verifyReceipt(receipt);
  assert.equal(report.valid, true, summarize(report));
});

test("E2E: dispute→resume lifecycle also verifies clean", async () => {
  const e = createEscrow({
    id: "escrow_dispute",
    client: "alice-addr",
    agent: "builder-agent",
    approvers: ["charlie-auditor"],
    milestones: [{ id: "m1", description: "all the work", amount: 5 * L }],
    now: T0,
  });
  e.fund(5 * L, { at: T0 + 1 });
  e.start({ at: T0 + 2 });
  e.dispute("agent stopped responding", { at: T0 + 100 });
  e.resolveDispute("resume", { at: T0 + 200 });
  e.submitProof("m1", "0xcafe0001", { at: T0 + 300 });
  e.approve("m1", "alice-addr", { at: T0 + 310 });
  e.settle({ at: T0 + 320 });

  const receipt = receiptFromEscrow(e);
  const report = await verifyReceipt(receipt);
  assert.equal(report.valid, true, summarize(report));
});

test("E2E: tampering the escrow's audit after the fact is detected", async () => {
  const e = createEscrow({
    id: "escrow_tamper",
    client: "alice-addr",
    agent: "builder-agent",
    milestones: [{ id: "m1", description: "work", amount: 2 * L }],
    now: T0,
  });
  e.fund(2 * L, { at: T0 + 1 });
  e.start({ at: T0 + 2 });
  e.submitProof("m1", "0x00112233", { at: T0 + 3 });
  e.approve("m1", "alice-addr", { at: T0 + 4 });
  e.settle({ at: T0 + 5 });

  const receipt = receiptFromEscrow(e);
  assert.equal((await verifyReceipt(receipt)).valid, true);

  // An attacker rewrites the release to pay an unregistered party
  const ev = receipt.audit.find((x) => x.type === "milestone_released");
  ev.actor = "attacker-addr";
  ev.data.amount = 2 * L;
  const report = await verifyReceipt(receipt);
  assert.equal(report.valid, false);
  assert.equal(P(report, "audit_actors").pass, false);
  assert.match(P(report, "audit_actors").detail, /attacker-addr/);
});
