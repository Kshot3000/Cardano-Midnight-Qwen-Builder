"use strict";
/**
 * AgentProof — verification of Agent Escrow Protocol receipts.
 *
 * A receipt is the off-chain artifact an escrow publishes for public audit
 * (SPEC: apps/agent-escrow/SPEC.md). Anyone can re-derive whether it is valid:
 *
 *   {
 *     "id": "escrow_...",
 *     "client": "addr1...", "agent": "agent:...",
 *     "approvers": ["addr1..."],              // registered approvers (client always one)
 *     "state": "settled",                     // terminal / current protocol state
 *     "funded": 10000000, "released": 6000000, "refunded": 4000000,   // lovelace
 *     "milestones": [
 *       { "id": "m1", "description": "...", "amount": 2000000,
 *         "status": "released", "proofHash": "0x...", "approvedBy": "..." }
 *     ],
 *     "commits": { "m1": "0x..." },           // proof hashes committed at escrow creation
 *     "audit": [ { "seq": 1, "at": 1700000000, "type": "funded",
 *                  "actor": "addr1...", "stateBefore": "created",
 *                  "stateAfter": "funded", "data": { "amount": 10000000 } } ]
 *   }
 *
 * Checks (each independently reported):
 *   structure        receipt parses and every field has a valid shape
 *   proof_format     every released milestone carries a well-formed proof hash
 *   proof_match      every proof hash equals the commitment published at creation
 *   milestone_state  released milestones were approved by a registered
 *                    non-agent approver; rejected ones carry a reason
 *   accounting       funded == released + refunded; released == Σ released milestones
 *   audit_chain      audit events are exactly seq 1..N in order
 *   audit_actors     every audit event is allowed for its actor, state, and data
 *
 * The module is pure and zero-dependency. `sha256Hex` is async because the
 * browser path uses WebCrypto (`crypto.subtle`); Node callers can use
 * `sha256HexNode` (sync, node:crypto) to precompute commitments.
 */

export class ProofError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProofError";
    this.code = code;
  }
}

export const RECEIPT_STATES = Object.freeze([
  "created", "funded", "in_progress", "disputed", "settled", "refunded", "cancelled",
]);

export const MILESTONE_STATES = Object.freeze([
  "pending", "proof_submitted", "released", "rejected",
]);

export const CHECK_IDS = Object.freeze([
  "structure", "proof_format", "proof_match", "milestone_state",
  "accounting", "audit_chain", "audit_actors",
]);

const PROOF_RE = /^0x[0-9a-f]{8,}$/i;
const HEX_RE = /^[0-9a-f]+$/i;
const HASH_RE = /^(0x)?[0-9a-f]+$/i; // proof hash with optional 0x prefix
const POS_INT = (n) => Number.isInteger(n) && n > 0;

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * SHA-256 over UTF-8 bytes, returned as a lowercase hex string without a
 * prefix (use `proofHash()` to get the canonical `0x…` form).
 * Works in the browser (crypto.subtle) and Node ≥15 (globalThis.crypto).
 */
export async function sha256Hex(text) {
  const subtle =
    globalThis.crypto && globalThis.crypto.subtle
      ? globalThis.crypto.subtle
      : null;
  if (!subtle) {
    throw new ProofError("NO_WEB_CRYPTO", "no WebCrypto in this environment — use sha256HexNode");
  }
  const data = new TextEncoder().encode(text);
  const buf = await subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Canonical proof-hash form: 0x + lowercase hex. Accepts an optional 0x prefix. */
export function proofHash(hex) {
  if (typeof hex !== "string") {
    throw new ProofError("BAD_PROOF", "proofHash must be a hex string (0x + at least 8 hex chars)");
  }
  const bare = hex.toLowerCase().startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{8,}$/i.test(bare)) {
    throw new ProofError("BAD_PROOF", "proofHash must be hex (0x + at least 8 hex chars)");
  }
  return "0x" + bare.toLowerCase();
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export function makeCheck(id, pass, detail) {
  return { id, pass: Boolean(pass), detail: detail || "" };
}

export function checkList(receipt, checks) {
  const failed = checks.filter((c) => !c.pass);
  return {
    receiptId: receipt && receipt.id,
    valid: failed.length === 0,
    checks,
    failedCount: failed.length,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isStr(v) {
  return typeof v === "string" && v.length > 0;
}

function auditEvent(ev, seq) {
  return {
    seq: ev.seq,
    at: ev.at,
    type: ev.type,
    actor: ev.actor,
    stateBefore: ev.stateBefore,
    stateAfter: ev.stateAfter,
    data: ev.data || {},
  };
}

/**
 * Parse a raw receipt into a normalized internal view.
 * Throws ProofError("BAD_RECEIPT", …) on any structural problem — a
 * structurally invalid receipt fails the `structure` check only.
 */
export function parseReceipt(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProofError("BAD_RECEIPT", "receipt must be a JSON object");
  }
  const r = raw;
  if (!isStr(r.id)) throw new ProofError("BAD_RECEIPT", "id is required");
  if (!isStr(r.client)) throw new ProofError("BAD_RECEIPT", "client is required");
  if (!isStr(r.agent)) throw new ProofError("BAD_RECEIPT", "agent is required");
  if (r.client === r.agent) throw new ProofError("BAD_RECEIPT", "client and agent must differ");
  if (!Array.isArray(r.approvers) || r.approvers.some((a) => !isStr(a))) {
    throw new ProofError("BAD_RECEIPT", "approvers must be a list of names");
  }
  if (!RECEIPT_STATES.includes(r.state)) {
    throw new ProofError("BAD_RECEIPT", "unknown state " + r.state);
  }
  // Structure only requires integer units here — negative or inconsistent
  // amounts are *tampering*, which the accounting check is built to catch.
  if (!Number.isInteger(r.funded) || r.funded < 0) {
    throw new ProofError("BAD_RECEIPT", "funded must be a non-negative integer (lovelace)");
  }
  for (const k of ["released", "refunded"]) {
    if (!Number.isInteger(r[k])) {
      throw new ProofError("BAD_RECEIPT", k + " must be an integer (lovelace)");
    }
  }
  if (!Array.isArray(r.milestones)) throw new ProofError("BAD_RECEIPT", "milestones must be a list");
  const mids = new Set();
  for (const m of r.milestones) {
    if (!m || typeof m !== "object") throw new ProofError("BAD_RECEIPT", "milestone must be an object");
    if (!isStr(m.id)) throw new ProofError("BAD_RECEIPT", "milestone id is required");
    if (mids.has(m.id)) throw new ProofError("BAD_RECEIPT", "duplicate milestone id " + m.id);
    mids.add(m.id);
    if (!POS_INT(m.amount)) throw new ProofError("BAD_RECEIPT", "milestone " + m.id + " needs a positive integer amount");
    if (!MILESTONE_STATES.includes(m.status)) {
      throw new ProofError("BAD_RECEIPT", "milestone " + m.id + " has unknown status " + m.status);
    }
    if (m.proofHash != null && (typeof m.proofHash !== "string" || !HASH_RE.test(m.proofHash))) {
      throw new ProofError("BAD_RECEIPT", "milestone " + m.id + " proofHash must be hex");
    }
  }
  if (r.commits != null && (typeof r.commits !== "object" || Array.isArray(r.commits))) {
    throw new ProofError("BAD_RECEIPT", "commits must be an object map");
  }
  if (!Array.isArray(r.audit)) throw new ProofError("BAD_RECEIPT", "audit must be a list");
  for (const ev of r.audit) {
    if (!ev || typeof ev !== "object") throw new ProofError("BAD_RECEIPT", "audit event must be an object");
    if (!Number.isInteger(ev.seq)) throw new ProofError("BAD_RECEIPT", "audit seq must be an integer");
    if (!Number.isInteger(ev.at)) throw new ProofError("BAD_RECEIPT", "audit at must be an integer timestamp");
    if (!isStr(ev.type)) throw new ProofError("BAD_RECEIPT", "audit type is required");
    if (!isStr(ev.actor)) throw new ProofError("BAD_RECEIPT", "audit actor is required");
  }
  return {
    id: r.id,
    client: r.client,
    agent: r.agent,
    approvers: [...new Set(r.approvers)],
    state: r.state,
    funded: r.funded,
    released: r.released,
    refunded: r.refunded,
    milestones: r.milestones.map((m) => ({
      id: m.id,
      description: m.description || "",
      amount: m.amount,
      status: m.status,
      proofHash: m.proofHash || null,
      approvedBy: m.approvedBy || null,
      rejectedBy: m.rejectedBy || null,
      reason: m.reason || null,
    })),
    commits: r.commits || {},
    audit: r.audit.map(auditEvent),
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function hexEq(a, b) {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

function balance(r) {
  return r.funded - r.released - r.refunded;
}

export function checkStructure(raw) {
  let p;
  try {
    p = parseReceipt(raw);
  } catch (e) {
    if (e instanceof ProofError) return makeCheck("structure", false, e.message);
    throw e;
  }
  void p;
  return makeCheck("structure", true, "receipt parsed");
}

export function checkProofFormat(r) {
  const bad = r.milestones.filter(
    (m) => m.status === "released" && (!m.proofHash || !PROOF_RE.test(m.proofHash))
  );
  if (bad.length) {
    return makeCheck("proof_format", false, "released milestone(s) without a well-formed proof hash: " + bad.map((m) => m.id).join(", "));
  }
  const all = r.milestones.filter((m) => m.proofHash && !PROOF_RE.test(m.proofHash));
  if (all.length) {
    return makeCheck("proof_format", false, "malformed proof hash on: " + all.map((m) => m.id).join(", "));
  }
  return makeCheck("proof_format", true, "all proof hashes well-formed");
}

export function checkProofMatch(r) {
  const missing = [];
  const mismatch = [];
  for (const m of r.milestones) {
    if (m.status !== "released") continue;
    const commit = r.commits[m.id];
    if (commit == null) missing.push(m.id);
    else if (!hexEq(m.proofHash, commit)) mismatch.push(m.id);
  }
  if (mismatch.length) {
    return makeCheck("proof_match", false, "proof hash differs from the commitment made at escrow creation: " + mismatch.join(", "));
  }
  if (missing.length) {
    return makeCheck("proof_match", false, "released without a published commitment (unverifiable): " + missing.join(", "));
  }
  return makeCheck("proof_match", true, "every released proof matches its published commitment");
}

export function checkMilestoneState(r) {
  const problems = [];
  for (const m of r.milestones) {
    if (m.status === "released") {
      if (m.approvedBy === r.agent) {
        problems.push(m.id + ": the agent approved its own work");
      } else if (!r.approvers.includes(m.approvedBy)) {
        problems.push(m.id + ": approver '" + (m.approvedBy || "—") + "' is not registered");
      }
    } else if (m.status === "rejected" && !m.reason) {
      problems.push(m.id + ": rejected without a reason");
    }
  }
  if (problems.length) return makeCheck("milestone_state", false, problems.join("; "));
  return makeCheck("milestone_state", true, "approvals come from registered non-agent approvers");
}

export function checkAccounting(r) {
  const problems = [];
  if (r.funded !== r.released + r.refunded) {
    problems.push(`funded (${r.funded}) ≠ released + refunded (${r.released + r.refunded})`);
  }
  const sum = r.milestones.filter((m) => m.status === "released").reduce((s, m) => s + m.amount, 0);
  if (sum !== r.released) {
    problems.push(`released total (${r.released}) ≠ Σ released milestones (${sum})`);
  }
  if (r.released < 0 || r.refunded < 0) problems.push("released or refunded is negative");
  if (balance(r) < 0) problems.push("balance is negative");
  if (problems.length) return makeCheck("accounting", false, problems.join("; "));
  return makeCheck("accounting", true, `funded ${r.funded} = released ${r.released} + refunded ${r.refunded}`);
}

export function checkAuditChain(r) {
  if (r.audit.length === 0) {
    return makeCheck("audit_chain", false, "receipt carries no audit events");
  }
  for (let i = 0; i < r.audit.length; i++) {
    const ev = r.audit[i];
    if (ev.seq !== i + 1) {
      return makeCheck("audit_chain", false, `event ${i + 1} has seq ${ev.seq} (expected ${i + 1})`);
    }
    if (i > 0 && ev.at < r.audit[i - 1].at) {
      return makeCheck("audit_chain", false, `event ${ev.seq} is back-dated relative to ${r.audit[i - 1].seq}`);
    }
  }
  if (r.audit[r.audit.length - 1].stateAfter !== r.state) {
    return makeCheck("audit_chain", false, "final audit state " + r.audit[r.audit.length - 1].stateAfter + " ≠ receipt state " + r.state);
  }
  return makeCheck("audit_chain", true, r.audit.length + " events, monotonic seq and time");
}

const EVENT_STATES = {
  funded: { before: ["created"], after: "funded" },
  started: { before: ["funded"], after: "in_progress" },
  proof_submitted: { before: null, after: null },
  milestone_released: { before: null, after: null },
  milestone_rejected: { before: null, after: null },
  disputed: { before: ["funded", "in_progress"], after: "disputed" },
  dispute_resolved_refund: { before: ["disputed"], after: "refunded" },
  dispute_resolved_resume: { before: ["disputed"], after: "in_progress" },
  settled: { before: ["in_progress"], after: "settled" },
  cancelled: { before: ["created", "funded"], after: "cancelled" },
};

function actorAllows(r, ev, role) {
  if (role === "client") return ev.actor === r.client;
  if (role === "agent") return ev.actor === r.agent;
  if (role === "approver") return r.approvers.includes(ev.actor) && ev.actor !== r.agent;
  return true;
}

export function checkAuditActors(r) {
  const problems = [];
  const knownMilestones = new Set(r.milestones.map((m) => m.id));
  for (const ev of r.audit) {
    const rule = EVENT_STATES[ev.type];
    if (!rule) {
      problems.push(`#${ev.seq} unknown event type '${ev.type}'`);
      continue;
    }
    if (rule.before && !rule.before.includes(ev.stateBefore)) {
      problems.push(`#${ev.seq} '${ev.type}' from unexpected state '${ev.stateBefore}'`);
    }
    if (rule.after && ev.stateAfter !== rule.after) {
      problems.push(`#${ev.seq} '${ev.type}' must end in '${rule.after}', got '${ev.stateAfter}'`);
    }
    if (ev.type === "funded") {
      if (!actorAllows(r, ev, "client")) problems.push(`#${ev.seq} funded by non-client ${ev.actor}`);
      if (!POS_INT(ev.data.amount)) problems.push(`#${ev.seq} funded without a positive amount`);
    } else if (ev.type === "started") {
      if (!actorAllows(r, ev, "client")) problems.push(`#${ev.seq} started by non-client ${ev.actor}`);
    } else if (ev.type === "proof_submitted") {
      if (!actorAllows(r, ev, "agent")) problems.push(`#${ev.seq} proof submitted by non-agent ${ev.actor}`);
      if (!isStr(ev.data.milestone) || !knownMilestones.has(ev.data.milestone)) {
        problems.push(`#${ev.seq} proof for unknown milestone ${ev.data.milestone}`);
      }
      if (typeof ev.data.proofHash !== "string" || !PROOF_RE.test(ev.data.proofHash)) {
        problems.push(`#${ev.seq} malformed proof hash in audit`);
      }
    } else if (ev.type === "milestone_released") {
      if (!actorAllows(r, ev, "approver")) problems.push(`#${ev.seq} released by ${ev.actor} (not a registered non-agent approver)`);
      if (!isStr(ev.data.milestone) || !knownMilestones.has(ev.data.milestone)) {
        problems.push(`#${ev.seq} release of unknown milestone ${ev.data.milestone}`);
      }
      if (!POS_INT(ev.data.amount)) problems.push(`#${ev.seq} release without a positive amount`);
    } else if (ev.type === "milestone_rejected") {
      if (!actorAllows(r, ev, "approver")) problems.push(`#${ev.seq} rejected by ${ev.actor} (not a registered non-agent approver)`);
      if (!isStr(ev.data.reason)) problems.push(`#${ev.seq} rejection without a reason`);
    } else if (ev.type === "disputed") {
      if (!actorAllows(r, ev, "client")) problems.push(`#${ev.seq} dispute opened by non-client ${ev.actor}`);
      if (!isStr(ev.data.reason)) problems.push(`#${ev.seq} dispute without a reason`);
    } else if (ev.type === "dispute_resolved_refund" || ev.type === "dispute_resolved_resume") {
      if (!actorAllows(r, ev, "client")) problems.push(`#${ev.seq} dispute resolved by non-client ${ev.actor}`);
      if (ev.type === "dispute_resolved_refund" && (!Number.isInteger(ev.data.refund) || ev.data.refund < 0)) {
        problems.push(`#${ev.seq} refund event without amount`);
      }
    } else if (ev.type === "settled") {
      if (!actorAllows(r, ev, "client")) problems.push(`#${ev.seq} settle by non-client ${ev.actor}`);
      if (!Number.isInteger(ev.data.refund) || ev.data.refund < 0) problems.push(`#${ev.seq} settle without remainder amount`);
    } else if (ev.type === "cancelled") {
      if (!actorAllows(r, ev, "client")) problems.push(`#${ev.seq} cancel by non-client ${ev.actor}`);
    }
  }
  if (problems.length) return makeCheck("audit_actors", false, problems.slice(0, 6).join("; "));
  return makeCheck("audit_actors", true, "every event is allowed for its actor, state, and payload");
}

const ALL_CHECKS = [
  ["proof_format", checkProofFormat],
  ["proof_match", checkProofMatch],
  ["milestone_state", checkMilestoneState],
  ["accounting", checkAccounting],
  ["audit_chain", checkAuditChain],
  ["audit_actors", checkAuditActors],
];

/**
 * Verify a receipt (raw object or JSON string) against all checks.
 * Returns { receiptId, valid, checks, failedCount, receipt } where receipt is
 * the normalized view (null when structure fails).
 */
export async function verifyReceipt(raw) {
  let input = raw;
  if (typeof raw === "string") {
    try {
      input = JSON.parse(raw);
    } catch (e) {
      // Unparseable input fails the structure check only; the remaining
      // checks have nothing to look at and are reported as skipped-passing.
      const checks = CHECK_IDS.map((id) =>
        makeCheck(
          id,
          id !== "structure",
          id === "structure" ? "not valid JSON: " + e.message : "skipped — receipt is not valid JSON"
        )
      );
      return checkList(null, checks);
    }
  }
  const structure = checkStructure(input);
  let receipt = null;
  if (structure.pass) receipt = parseReceipt(input);
  const checks = [structure];
  for (const [id, fn] of ALL_CHECKS) {
    checks.push(receipt ? fn(receipt) : makeCheck(id, false, "skipped — structure failed"));
  }
  const report = checkList(input, checks);
  report.receipt = receipt;
  return report;
}

/** One-line human summary, e.g. "7/7 checks passed — receipt valid". */
export function summarize(report) {
  const total = report.checks.length;
  const passed = report.checks.filter((c) => c.pass).length;
  const head = `${passed}/${total} checks passed`;
  if (report.valid) return head + " — receipt valid";
  const first = report.checks.find((c) => !c.pass);
  return head + " — INVALID: " + (first ? first.detail : "unknown");
}

/**
 * Money still locked in escrow, re-derived from the audit trail (not the
 * header) so a tampered header cannot hide it: Σ funded − Σ released −
 * Σ refunded, over the audit events. Falls back to the header when the
 * receipt carries no audit events.
 */
export function escrowBalance(r) {
  if (!r.audit || r.audit.length === 0) return r.funded - r.released - r.refunded;
  let funded = 0;
  let released = 0;
  let refunded = 0;
  for (const ev of r.audit) {
    const d = ev.data || {};
    if (ev.type === "funded" && POS_INT(d.amount)) funded += d.amount;
    else if (ev.type === "milestone_released" && POS_INT(d.amount)) released += d.amount;
    else if (
      (ev.type === "settled" || ev.type === "cancelled" || ev.type === "dispute_resolved_refund") &&
      Number.isInteger(d.refund) &&
      d.refund >= 0
    ) {
      refunded += d.refund;
    }
  }
  return funded - released - refunded;
}
