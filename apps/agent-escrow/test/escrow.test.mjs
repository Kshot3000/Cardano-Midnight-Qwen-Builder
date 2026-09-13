// Agent Escrow Protocol — Node.js test suite.
// Run: node --test apps/agent-escrow/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEscrow, EscrowError } from "../src/escrow.js";

const t0 = 1_700_000_000;
const L = 1_000_000; // 1 ADA in lovelace

function standardConfig() {
  return {
    client: "client-addr",
    agent: "agent-addr",
    approvers: ["auditor-addr"],
    milestones: [
      { id: "m1", description: "Scaffold", amount: 2 * L, deadline: t0 + 1000 },
      { id: "m2", description: "MVP", amount: 3 * L, deadline: t0 + 2000 },
      { id: "m3", description: "Hardening", amount: 5 * L, deadline: t0 + 3000 },
    ],
    now: t0,
  };
}

test("funds, starts, and settles a full happy path with accounting intact", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.approve("m1", "auditor-addr", { at: t0 + 11 });
  e.submitProof("m2", "0x1234abcd", { at: t0 + 12 });
  e.approve("m2", "client-addr", { at: t0 + 13 });
  e.submitProof("m3", "0xfedcba98", { at: t0 + 14 });
  e.approve("m3", "auditor-addr", { at: t0 + 15 });
  e.settle({ at: t0 + 16 });

  assert.equal(e.getState(), "settled");
  assert.equal(e.balance(), 0);
  const ms = Object.fromEntries(e.getMilestones().map((m) => [m.id, m]));
  assert.equal(ms.m1.status, "released");
  assert.equal(ms.m2.status, "released");
  assert.equal(ms.m3.status, "released");
  e.assertInvariants();
  assert.equal(e.getAudit().length, 9); // funded, started, 3x (proof+approve), settled
});

test("client can approve as a registered approver", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.approve("m1", "client-addr", { at: t0 + 11 });
  assert.equal(e.getMilestones().find((m) => m.id === "m1").approvedBy, "client-addr");
});

test("agent cannot approve its own work (separation of duties)", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  assert.throws(
    () => e.approve("m1", "agent-addr", { at: t0 + 11 }),
    (err) => err instanceof EscrowError && err.code === "SELF_APPROVAL"
  );
});

test("unregistered approver is rejected", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  assert.throws(
    () => e.approve("m1", "stranger-addr", { at: t0 + 11 }),
    (err) => err instanceof EscrowError && err.code === "NOT_APPROVER"
  );
});

test("approve before proof is submitted is rejected", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  assert.throws(
    () => e.approve("m1", "auditor-addr", { at: t0 + 10 }),
    (err) => err instanceof EscrowError && err.code === "NO_PROOF"
  );
});

test("malformed proof hash is rejected", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  for (const bad of ["", "nothex", "0x12", "zzzzzzzz"]) {
    assert.throws(
      () => e.submitProof("m1", bad, { at: t0 + 10 }),
      (err) => err instanceof EscrowError && err.code === "BAD_PROOF"
    );
  }
});

test("only the agent can submit proofs", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  assert.throws(
    () => e.submitProof("m1", "0xabcdef12", { by: "client-addr", at: t0 + 10 }),
    (err) => err instanceof EscrowError && err.code === "FORBIDDEN"
  );
});

test("rejecting a proof keeps funds escrowed and blocks re-approval of the same slot", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.reject("m1", "auditor-addr", "proof does not match commitment", { at: t0 + 11 });
  const m1 = e.getMilestones().find((m) => m.id === "m1");
  assert.equal(m1.status, "rejected");
  assert.equal(m1.reason, "proof does not match commitment");
  assert.equal(e.balance(), 10 * L);
  assert.throws(
    () => e.approve("m1", "auditor-addr", { at: t0 + 12 }),
    (err) => err instanceof EscrowError && err.code === "NO_PROOF"
  );
});

test("settle refunds the leftover after rejections", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.approve("m1", "auditor-addr", { at: t0 + 11 });
  e.submitProof("m2", "0x1234abcd", { at: t0 + 12 });
  e.reject("m2", "auditor-addr", "incomplete", { at: t0 + 13 });
  e.submitProof("m3", "0xfedcba98", { at: t0 + 14 });
  e.reject("m3", "client-addr", "scope change", { at: t0 + 15 });
  e.settle({ at: t0 + 16 });
  assert.equal(e.getState(), "settled");
  // funded 10, released 2 -> refund 8
  assert.equal(e.getAudit().at(-1).data.refund, 8 * L);
  assert.equal(e.balance(), 0);
  e.assertInvariants();
});

test("settle is blocked while milestones are still open", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.approve("m1", "auditor-addr", { at: t0 + 11 });
  assert.throws(
    () => e.settle({ at: t0 + 12 }),
    (err) => err instanceof EscrowError && err.code === "MILESTONES_OPEN"
  );
});

test("dispute freezes releases; client can resume", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.dispute("agent went quiet", { at: t0 + 11 });
  assert.equal(e.getState(), "disputed");
  assert.throws(
    () => e.approve("m1", "auditor-addr", { at: t0 + 12 }),
    (err) => err instanceof EscrowError && err.code === "INVALID_STATE"
  );
  e.resolveDispute("resume", { at: t0 + 13 });
  assert.equal(e.getState(), "in_progress");
  e.approve("m1", "auditor-addr", { at: t0 + 14 });
  assert.equal(e.getMilestones().find((m) => m.id === "m1").status, "released");
});

test("dispute + refund returns the whole escrow balance", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.approve("m1", "auditor-addr", { at: t0 + 11 });
  e.dispute("not worth continuing", { at: t0 + 12 });
  e.resolveDispute("refund", { at: t0 + 13 });
  assert.equal(e.getState(), "refunded");
  assert.equal(e.getAudit().at(-1).data.refund, 8 * L);
  assert.equal(e.balance(), 0);
  e.assertInvariants();
});

test("only the client can dispute or cancel", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  assert.throws(
    () => e.dispute("bad", { by: "agent-addr", at: t0 + 2 }),
    (err) => err instanceof EscrowError && err.code === "FORBIDDEN"
  );
  assert.throws(
    () => e.cancel({ by: "agent-addr", at: t0 + 2 }),
    (err) => err instanceof EscrowError && err.code === "FORBIDDEN"
  );
});

test("cancel before start refunds the deposit", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.cancel({ at: t0 + 2 });
  assert.equal(e.getState(), "cancelled");
  assert.equal(e.getAudit().at(-1).data.refund, 10 * L);
  assert.equal(e.balance(), 0);
});

test("cancel is not allowed after work starts", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  assert.throws(
    () => e.cancel({ at: t0 + 3 }),
    (err) => err instanceof EscrowError && err.code === "INVALID_STATE"
  );
});

test("start is rejected when milestones exceed the budget", () => {
  const cfg = standardConfig();
  cfg.milestones[2].amount = 100 * L; // total 105 > 10 funded
  const e = createEscrow(cfg);
  e.fund(10 * L, { at: t0 + 1 });
  assert.throws(
    () => e.start({ at: t0 + 2 }),
    (err) => err instanceof EscrowError && err.code === "OVER_ALLOCATED"
  );
});

test("start is rejected with no milestones", () => {
  const e = createEscrow({ client: "c", agent: "a", milestones: [], now: t0 });
  e.fund(1 * L, { at: t0 + 1 });
  assert.throws(
    () => e.start({ at: t0 + 2 }),
    (err) => err instanceof EscrowError && err.code === "NO_MILESTONES"
  );
});

test("double funding is rejected", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  assert.throws(
    () => e.fund(5 * L, { at: t0 + 2 }),
    (err) => err instanceof EscrowError && err.code === "INVALID_STATE"
  );
});

test("client and agent must be different addresses", () => {
  assert.throws(
    () => createEscrow({ client: "same", agent: "same", now: t0 }),
    (err) => err instanceof EscrowError && err.code === "BAD_CONFIG"
  );
});

test("late approval is flagged but allowed", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.submitProof("m1", "0xabcdef12", { at: t0 + 10 });
  e.approve("m1", "auditor-addr", { at: t0 + 5000 }); // after deadline t0+1000
  const m1 = e.getMilestones().find((m) => m.id === "m1");
  assert.equal(m1.status, "released");
  assert.equal(m1.late, true);
});

test("audit log is monotonic and records every transition", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  e.dispute("oops", { at: t0 + 3 });
  e.resolveDispute("resume", { at: t0 + 4 });
  const audit = e.getAudit();
  assert.deepEqual(
    audit.map((ev) => ev.type),
    ["funded", "started", "disputed", "dispute_resolved_resume"]
  );
  assert.deepEqual(
    audit.map((ev) => ev.seq),
    [1, 2, 3, 4]
  );
  assert.equal(audit[0].stateBefore, "created");
  assert.equal(audit[0].stateAfter, "funded");
  assert.equal(audit[2].stateBefore, "in_progress");
  assert.equal(audit[2].stateAfter, "disputed");
  e.assertInvariants();
});

test("negative or non-integer amounts are rejected", () => {
  const e = createEscrow(standardConfig());
  for (const bad of [-1, 0, 1.5, "10", null]) {
    assert.throws(
      () => e.fund(bad, { at: t0 + 1 }),
      (err) => err instanceof EscrowError && err.code === "BAD_AMOUNT"
    );
  }
});

test("unknown milestone id is rejected", () => {
  const e = createEscrow(standardConfig());
  e.fund(10 * L, { at: t0 + 1 });
  e.start({ at: t0 + 2 });
  assert.throws(
    () => e.submitProof("nope", "0xabcdef12", { at: t0 + 10 }),
    (err) => err instanceof EscrowError && err.code === "UNKNOWN_MILESTONE"
  );
});
