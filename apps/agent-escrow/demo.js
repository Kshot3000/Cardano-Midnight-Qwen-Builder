// Agent Escrow Protocol — interactive demo (pure ES module, zero deps).
// Run: node apps/agent-escrow/demo.js
import { createEscrow } from "./src/escrow.js";

const L = 1_000_000;
const t0 = 1_700_000_000;

function log(e, msg) {
  const a = e.getAudit().at(-1);
  console.log(
    `  [${a.seq}] ${a.type.padEnd(20)} actor=${a.actor.padEnd(14)} ` +
    `state: ${a.stateBefore} -> ${a.stateAfter}` +
    (a.data && Object.keys(a.data).length ? "  " + JSON.stringify(a.data) : "") +
    (msg ? `   # ${msg}` : "")
  );
}

console.log("=== Agent Escrow Protocol — demo walkthrough ===\n");

const escrow = createEscrow({
  id: "escrow_demo",
  client: "alice-addr",
  agent: "builder-agent",
  approvers: ["charlie-auditor"],
  milestones: [
    { id: "m1", description: "Repo scaffold + CI", amount: 1 * L, deadline: t0 + 86_400 },
    { id: "m2", description: "Working app + tests", amount: 4 * L, deadline: t0 + 2 * 86_400 },
    { id: "m3", description: "On-chain audit + docs", amount: 5 * L, deadline: t0 + 3 * 86_400 },
  ],
  now: t0,
});

console.log("1) Alice creates an escrow for a builder agent: 3 milestones, 10 ADA budget.");
console.log("2) She funds it — 10 ADA (10,000,000 lovelace).");
escrow.fund(10 * L, { at: t0 + 10 }); log(escrow);

console.log("\n3) Work starts.");
escrow.start({ at: t0 + 20 }); log(escrow);

console.log("\n4) Milestone 1: the agent submits its proof hash.");
escrow.submitProof("m1", "0x9f2c41ab", { at: t0 + 3_600 }); log(escrow);
console.log("5) The auditor verifies the repo scaffold and releases m1 (1 ADA).");
escrow.approve("m1", "charlie-auditor", { at: t0 + 3_660 }); log(escrow);

console.log("\n6) Milestone 2: the agent submits — but the auditor finds the tests missing.");
escrow.submitProof("m2", "0x41b0de77", { at: t0 + 86_400 }); log(escrow);
console.log("7) Auditor rejects m2 — funds stay escrowed, agent must resubmit. (In this demo we let it slip.)");
escrow.reject("m2", "charlie-auditor", "tests missing — CI red", { at: t0 + 86_460 }); log(escrow);

console.log("\n8) Milestone 3: submitted and approved by the client (a registered approver).");
escrow.submitProof("m3", "0xaa011b3c", { at: t0 + 172_800 }); log(escrow);
escrow.approve("m3", "alice-addr", { at: t0 + 172_860 }); log(escrow);

console.log("\n9) All milestones decided -> settle refunds the unspent remainder.");
escrow.settle({ at: t0 + 172_900 }); log(escrow);

const ms = Object.fromEntries(escrow.getMilestones().map((m) => [m.id, m.status]));
console.log(`\nMilestones: ${JSON.stringify(ms)}`);
console.log(`Final state: ${escrow.getState()} | released: ${(escrow.getAudit().filter(a=>a.type==="milestone_released").reduce((s,a)=>s+a.data.amount,0)/L)} ADA`);
escrow.assertInvariants();
console.log("Invariants OK: released + refunded == funded, audit seqs monotonic.");

console.log("\n=== Security check: the agent tries to approve its own work ===");
const escrow2 = createEscrow({
  client: "alice-addr",
  agent: "builder-agent",
  milestones: [{ id: "m1", amount: 1 * L }],
  now: t0,
});
escrow2.fund(1 * L, { at: t0 + 1 });
escrow2.start({ at: t0 + 2 });
escrow2.submitProof("m1", "0xdeadbeef", { at: t0 + 3 });
try {
  escrow2.approve("m1", "builder-agent", { at: t0 + 4 });
  console.log("UNEXPECTED: self-approval succeeded (BUG)");
  process.exit(1);
} catch (err) {
  console.log(`Blocked as designed: ${err.code} — ${err.message}`);
}
console.log("\nDone. Separation of duties holds: the agent earns, a human releases.");
