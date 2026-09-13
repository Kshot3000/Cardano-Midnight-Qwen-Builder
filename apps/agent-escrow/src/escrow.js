"use strict";
/**
 * Agent Escrow Protocol — reference implementation (pure ES module, zero deps).
 *
 * Milestone-based escrow for AI-agent work:
 *   client deposits ADA (lovelace) -> agent works per milestone ->
 *   agent submits a proof hash per milestone -> a registered approver
 *   (never the agent itself) releases that milestone's funds.
 *
 * Core rules (see SPEC.md):
 *   - Single funding event; escrow holds until released or refunded.
 *   - Separation of duties: the agent can submit proofs but never approve.
 *   - Release happens only against a submitted proof, per milestone.
 *   - Disputes freeze the escrow; only the client resolves them.
 *   - Every transition is appended to an immutable audit log with seq,
 *     timestamp, actor, and before/after state.
 *   - Units are integer lovelace (1 ADA = 1,000,000 lovelace).
 */

export class EscrowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EscrowError";
    this.code = code;
  }
}

export const STATES = Object.freeze({
  CREATED: "created",
  FUNDED: "funded",
  IN_PROGRESS: "in_progress",
  DISPUTED: "disputed",
  SETTLED: "settled",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
});

export const MILESTONE_STATES = Object.freeze({
  PENDING: "pending",
  PROOF_SUBMITTED: "proof_submitted",
  RELEASED: "released",
  REJECTED: "rejected",
});

const PROOF_HASH_RE = /^0x[0-9a-f]{8,}$/i;

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

function defaultNow() {
  return Date.now();
}

function toMilestone(m, i) {
  if (!m || typeof m !== "object") {
    throw new EscrowError("BAD_CONFIG", "milestone " + (i + 1) + " must be an object");
  }
  if (!isPositiveInt(m.amount)) {
    throw new EscrowError("BAD_CONFIG", "milestone " + (i + 1) + " needs a positive integer amount (lovelace)");
  }
  const deadline = m.deadline == null ? null : m.deadline;
  if (deadline != null && !Number.isInteger(deadline)) {
    throw new EscrowError("BAD_CONFIG", "milestone " + (i + 1) + " deadline must be an integer timestamp");
  }
  return {
    id: m.id || "m" + (i + 1),
    description: m.description || "",
    amount: m.amount,
    deadline,
    status: MILESTONE_STATES.PENDING,
    proofHash: null,
    decidedAt: null,
    approvedBy: null,
    rejectedBy: null,
    reason: null,
    late: false,
  };
}

export function createEscrow(config) {
  const client = config && config.client;
  const agent = config && config.agent;
  if (typeof client !== "string" || !client) throw new EscrowError("BAD_CONFIG", "client is required");
  if (typeof agent !== "string" || !agent) throw new EscrowError("BAD_CONFIG", "agent is required");
  if (client === agent) throw new EscrowError("BAD_CONFIG", "client and agent must differ");

  const milestones = (config.milestones || []).map(toMilestone);
  const ids = new Set(milestones.map((m) => m.id));
  if (ids.size !== milestones.length) throw new EscrowError("BAD_CONFIG", "milestone ids must be unique");

  const approvers = new Set([client]);
  for (const a of config.approvers || []) {
    if (typeof a !== "string" || !a) throw new EscrowError("BAD_CONFIG", "approvers must be non-empty strings");
    approvers.add(a);
  }

  const state = {
    id: config.id || "escrow_" + Math.random().toString(16).slice(2, 10),
    state: STATES.CREATED,
    client,
    agent,
    approvers,
    funded: 0,
    released: 0,
    refunded: 0,
    createdAt: config.now != null ? config.now : defaultNow(),
    milestones,
    audit: [],
  };

  function require(cond, code, msg) {
    if (!cond) throw new EscrowError(code, msg);
  }

  function findMilestone(id) {
    const m = state.milestones.find((x) => x.id === id);
    require(m, "UNKNOWN_MILESTONE", "no milestone with id " + id);
    return m;
  }

  function allDecided() {
    return state.milestones.every(
      (m) => m.status === MILESTONE_STATES.RELEASED || m.status === MILESTONE_STATES.REJECTED
    );
  }

  function escrowBalance() {
    return state.funded - state.released - state.refunded;
  }

  const api = {
    id: state.id,
    client: state.client,
    agent: state.agent,

    /** Client deposits the full budget. Only from `created`. */
    fund(amount, opts = {}) {
      require(state.state === STATES.CREATED, "INVALID_STATE", "can only fund in created state");
      require(isPositiveInt(amount), "BAD_AMOUNT", "amount must be a positive integer (lovelace)");
      state.funded = amount;
      const before = state.state;
      state.state = STATES.FUNDED;
      pushEvent("funded", state.client, { amount }, opts.at, before);
      return api;
    },

    /** Open the engagement. Only from `funded`. Milestones must fit the budget. */
    start(opts = {}) {
      require(state.state === STATES.FUNDED, "INVALID_STATE", "can only start in funded state");
      require(state.milestones.length > 0, "NO_MILESTONES", "escrow needs at least one milestone");
      const total = state.milestones.reduce((s, m) => s + m.amount, 0);
      require(total <= state.funded, "OVER_ALLOCATED", "milestone total exceeds funded amount");
      const before = state.state;
      state.state = STATES.IN_PROGRESS;
      pushEvent("started", state.client, { milestoneTotal: total }, opts.at, before);
      return api;
    },

    /** Agent submits a proof hash for a pending milestone. */
    submitProof(milestoneId, proofHash, opts = {}) {
      require(state.state === STATES.IN_PROGRESS, "INVALID_STATE", "can only submit proofs while in_progress");
      const m = findMilestone(milestoneId);
      require(m.status === MILESTONE_STATES.PENDING, "INVALID_MILESTONE_STATE", "milestone has no open proof slot");
      const by = opts.by || state.agent;
      require(by === state.agent, "FORBIDDEN", "only the agent can submit proofs");
      require(
        typeof proofHash === "string" && PROOF_HASH_RE.test(proofHash),
        "BAD_PROOF",
        "proofHash must be a hex string (0x + at least 8 hex chars)"
      );
      m.status = MILESTONE_STATES.PROOF_SUBMITTED;
      m.proofHash = proofHash;
      pushEvent("proof_submitted", by, { milestone: m.id, proofHash }, opts.at, null);
      return api;
    },

    /** A registered approver (never the agent) releases one milestone. */
    approve(milestoneId, approver, opts = {}) {
      require(state.state === STATES.IN_PROGRESS, "INVALID_STATE", "can only approve while in_progress");
      const m = findMilestone(milestoneId);
      require(m.status === MILESTONE_STATES.PROOF_SUBMITTED, "NO_PROOF", "milestone needs a submitted proof before approval");
      require(approver && approver !== state.agent, "SELF_APPROVAL", "the agent cannot approve its own work");
      require(state.approvers.has(approver), "NOT_APPROVER", "approver is not registered for this escrow");
      const ts = opts.at != null ? opts.at : defaultNow();
      m.status = MILESTONE_STATES.RELEASED;
      m.decidedAt = ts;
      m.approvedBy = approver;
      m.late = m.deadline != null && ts > m.deadline;
      state.released += m.amount;
      pushEvent("milestone_released", approver, { milestone: m.id, amount: m.amount, late: m.late }, opts.at, null);
      return api;
    },

    /** A registered approver rejects a submitted proof (funds stay escrowed). */
    reject(milestoneId, approver, reason, opts = {}) {
      require(state.state === STATES.IN_PROGRESS, "INVALID_STATE", "can only reject while in_progress");
      const m = findMilestone(milestoneId);
      require(m.status === MILESTONE_STATES.PROOF_SUBMITTED, "NO_PROOF", "only a submitted proof can be rejected");
      require(approver && approver !== state.agent, "SELF_APPROVAL", "the agent cannot judge its own work");
      require(state.approvers.has(approver), "NOT_APPROVER", "approver is not registered for this escrow");
      require(typeof reason === "string" && reason, "BAD_REASON", "rejection needs a reason");
      m.status = MILESTONE_STATES.REJECTED;
      m.decidedAt = opts.at != null ? opts.at : defaultNow();
      m.rejectedBy = approver;
      m.reason = reason;
      pushEvent("milestone_rejected", approver, { milestone: m.id, reason }, opts.at, null);
      return api;
    },

    /** Client opens a dispute, freezing all releases. */
    dispute(reason, opts = {}) {
      require(
        state.state === STATES.FUNDED || state.state === STATES.IN_PROGRESS,
        "INVALID_STATE",
        "only funded or in_progress escrows can be disputed"
      );
      const by = opts.by || state.client;
      require(by === state.client, "FORBIDDEN", "only the client can open a dispute");
      require(typeof reason === "string" && reason, "BAD_REASON", "dispute needs a reason");
      const before = state.state;
      state.state = STATES.DISPUTED;
      pushEvent("disputed", by, { reason }, opts.at, before);
      return api;
    },

    /** Client resolves a dispute: full refund, or resume the engagement. */
    resolveDispute(action, opts = {}) {
      require(state.state === STATES.DISPUTED, "INVALID_STATE", "escrow is not in dispute");
      const by = opts.by || state.client;
      require(by === state.client, "FORBIDDEN", "only the client can resolve a dispute");
      const before = state.state;
      if (action === "refund") {
        const bal = escrowBalance();
        state.refunded += bal;
        state.state = STATES.REFUNDED;
        pushEvent("dispute_resolved_refund", by, { refund: bal }, opts.at, before);
      } else if (action === "resume") {
        state.state = STATES.IN_PROGRESS;
        pushEvent("dispute_resolved_resume", by, {}, opts.at, before);
      } else {
        throw new EscrowError("BAD_ACTION", "action must be 'refund' or 'resume'");
      }
      return api;
    },

    /** After every milestone is released or rejected, refund the remainder. */
    settle(opts = {}) {
      require(state.state === STATES.IN_PROGRESS, "INVALID_STATE", "only in_progress escrows can be settled");
      require(allDecided(), "MILESTONES_OPEN", "all milestones must be released or rejected first");
      const before = state.state;
      const bal = escrowBalance();
      state.refunded += bal;
      state.state = STATES.SETTLED;
      pushEvent("settled", state.client, { refund: bal }, opts.at, before);
      return api;
    },

    /** Cancel before work starts; refunds anything already funded. */
    cancel(opts = {}) {
      require(
        state.state === STATES.CREATED || state.state === STATES.FUNDED,
        "INVALID_STATE",
        "can only cancel before work starts"
      );
      const by = opts.by || state.client;
      require(by === state.client, "FORBIDDEN", "only the client can cancel");
      const before = state.state;
      const bal = escrowBalance();
      if (bal > 0) state.refunded += bal;
      state.state = STATES.CANCELLED;
      pushEvent("cancelled", by, { refund: bal }, opts.at, before);
      return api;
    },

    getState() {
      return state.state;
    },
    balance() {
      return escrowBalance();
    },
    getMilestones() {
      return state.milestones.map((m) => ({ ...m }));
    },
    getAudit() {
      return state.audit.slice();
    },
    /** Internal bookkeeping check — call after any sequence of transitions. */
    assertInvariants() {
      let prev = 0;
      for (const ev of state.audit) {
        require(ev.seq === prev + 1, "AUDIT_BROKEN", "audit seq is not monotonic");
        prev = ev.seq;
      }
      require(state.released + state.refunded <= state.funded, "ACCOUNTING_BROKEN", "paid out more than funded");
      const releasedSum = state.milestones
        .filter((m) => m.status === MILESTONE_STATES.RELEASED)
        .reduce((s, m) => s + m.amount, 0);
      require(releasedSum === state.released, "ACCOUNTING_BROKEN", "released total does not match milestone releases");
      return true;
    },
  };

  function pushEvent(type, actor, data, at, before) {
    const ts = at != null ? at : defaultNow();
    state.audit.push(
      Object.freeze({
        seq: state.audit.length + 1,
        at: ts,
        type,
        actor,
        stateBefore: before != null ? before : state.state,
        stateAfter: state.state,
        data: data ? Object.freeze({ ...data }) : Object.freeze({}),
      })
    );
  }

  return api;
}
