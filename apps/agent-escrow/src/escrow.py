"""Agent Escrow Protocol — Python reference implementation.

Milestone-based escrow for AI-agent work:

    client deposits ADA (lovelace) -> agent works per milestone ->
    agent submits a proof hash per milestone -> a registered approver
    (never the agent itself) releases that milestone's funds.

Core rules (see SPEC.md):
  * single funding event; escrow holds until released or refunded
  * separation of duties: the agent submits proofs but never approves
  * release only against a submitted proof, per milestone
  * disputes freeze the escrow; only the client resolves them
  * every transition appends to an immutable audit log
  * amounts are integer lovelace (1 ADA = 1_000_000 lovelace)

Stdlib only — no dependencies.
"""
from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

LOVELACE_PER_ADA = 1_000_000

# ---------------------------------------------------------------- states

CREATED = "created"
FUNDED = "funded"
IN_PROGRESS = "in_progress"
DISPUTED = "disputed"
SETTLED = "settled"
REFUNDED = "refunded"
CANCELLED = "cancelled"

PENDING = "pending"
PROOF_SUBMITTED = "proof_submitted"
RELEASED = "released"
REJECTED = "rejected"

PROOF_HASH_RE = re.compile(r"^0x[0-9a-f]{8,}$", re.IGNORECASE)


class EscrowError(Exception):
    """Raised on any invalid transition or malformed argument."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Milestone:
    id: str
    description: str
    amount: int
    deadline: Optional[int]
    status: str = PENDING
    proof_hash: Optional[str] = None
    decided_at: Optional[int] = None
    approved_by: Optional[str] = None
    rejected_by: Optional[str] = None
    reason: Optional[str] = None
    late: bool = False


@dataclass(frozen=True)
class AuditEvent:
    seq: int
    at: int
    type: str
    actor: str
    state_before: str
    state_after: str
    data: dict = field(default_factory=dict)


# ---------------------------------------------------------------- escrow

class Escrow:
    def __init__(
        self,
        client: str,
        agent: str,
        milestones: Optional[List[Milestone]] = None,
        approvers: Optional[List[str]] = None,
        escrow_id: Optional[str] = None,
        now: Optional[Callable[[], int]] = None,
    ):
        if not client or not isinstance(client, str):
            raise EscrowError("BAD_CONFIG", "client is required")
        if not agent or not isinstance(agent, str):
            raise EscrowError("BAD_CONFIG", "agent is required")
        if client == agent:
            raise EscrowError("BAD_CONFIG", "client and agent must differ")

        self._client = client
        self._agent = agent
        self._escrow_id = escrow_id or "escrow_" + hashlib.sha256(
            (client + agent + str(time.time_ns())).encode()
        ).hexdigest()[:8]
        self._approvers = {client, *(approvers or [])}
        self._state = CREATED
        self._funded = 0
        self._released = 0
        self._refunded = 0
        self._created_at = now() if now else _now()
        self._audit: List[AuditEvent] = []

        ids = set()
        for m in milestones or []:
            self._check_milestone(m)
            if m.id in ids:
                raise EscrowError("BAD_CONFIG", "milestone ids must be unique")
            ids.add(m.id)
        self._milestones: List[Milestone] = list(milestones or [])

    # -- helpers --------------------------------------------------------

    @staticmethod
    def _now() -> int:
        return int(time.time())

    @staticmethod
    def _check_milestone(m: Milestone) -> None:
        if not isinstance(m.amount, int) or isinstance(m.amount, bool) or m.amount <= 0:
            raise EscrowError("BAD_CONFIG", f"milestone {m.id} needs a positive integer amount (lovelace)")
        if m.deadline is not None and not isinstance(m.deadline, int):
            raise EscrowError("BAD_CONFIG", f"milestone {m.id} deadline must be an integer timestamp")

    def _require(self, cond: bool, code: str, msg: str) -> None:
        if not cond:
            raise EscrowError(code, msg)

    def _find(self, milestone_id: str) -> Milestone:
        for m in self._milestones:
            if m.id == milestone_id:
                return m
        raise EscrowError("UNKNOWN_MILESTONE", f"no milestone with id {milestone_id}")

    def _balance(self) -> int:
        return self._funded - self._released - self._refunded

    def _all_decided(self) -> bool:
        return all(m.status in (RELEASED, REJECTED) for m in self._milestones)

    def _record(self, type_: str, actor: str, data: dict, at: Optional[int], before: Optional[str]) -> None:
        ts = at if at is not None else _now()
        ev = AuditEvent(
            seq=len(self._audit) + 1,
            at=ts,
            type=type_,
            actor=actor,
            state_before=before if before is not None else self._state,
            state_after=self._state,
            data=dict(data),
        )
        self._audit.append(ev)

    def _replace_milestone(self, old: Milestone, new: Milestone) -> None:
        for i, m in enumerate(self._milestones):
            if m is old:
                self._milestones[i] = new
                return
        raise AssertionError("milestone not found (internal)")

    # -- transitions ----------------------------------------------------

    def fund(self, amount: int, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == CREATED, "INVALID_STATE", "can only fund in created state")
        self._require(
            isinstance(amount, int) and not isinstance(amount, bool) and amount > 0,
            "BAD_AMOUNT",
            "amount must be a positive integer (lovelace)",
        )
        before = self._state
        self._funded = amount
        self._state = FUNDED
        self._record("funded", self._client, {"amount": amount}, now, before)
        return self

    def start(self, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == FUNDED, "INVALID_STATE", "can only start in funded state")
        self._require(self._milestones, "NO_MILESTONES", "escrow needs at least one milestone")
        total = sum(m.amount for m in self._milestones)
        self._require(total <= self._funded, "OVER_ALLOCATED", "milestone total exceeds funded amount")
        before = self._state
        self._state = IN_PROGRESS
        self._record("started", self._client, {"milestoneTotal": total}, now, before)
        return self

    def submit_proof(self, milestone_id: str, proof_hash: str, by: Optional[str] = None, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == IN_PROGRESS, "INVALID_STATE", "can only submit proofs while in_progress")
        m = self._find(milestone_id)
        self._require(m.status == PENDING, "INVALID_MILESTONE_STATE", "milestone has no open proof slot")
        by = by or self._agent
        self._require(by == self._agent, "FORBIDDEN", "only the agent can submit proofs")
        self._require(
            isinstance(proof_hash, str) and PROOF_HASH_RE.match(proof_hash),
            "BAD_PROOF",
            "proof_hash must be a hex string (0x + at least 8 hex chars)",
        )
        self._replace_milestone(m, Milestone(
            id=m.id, description=m.description, amount=m.amount, deadline=m.deadline,
            status=PROOF_SUBMITTED, proof_hash=proof_hash,
        ))
        self._record("proof_submitted", by, {"milestone": m.id, "proofHash": proof_hash}, now, None)
        return self

    def approve(self, milestone_id: str, approver: str, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == IN_PROGRESS, "INVALID_STATE", "can only approve while in_progress")
        m = self._find(milestone_id)
        self._require(m.status == PROOF_SUBMITTED, "NO_PROOF", "milestone needs a submitted proof before approval")
        self._require(approver and approver != self._agent, "SELF_APPROVAL", "the agent cannot approve its own work")
        self._require(approver in self._approvers, "NOT_APPROVER", "approver is not registered for this escrow")
        ts = now if now is not None else _now()
        late = m.deadline is not None and ts > m.deadline
        self._replace_milestone(m, Milestone(
            id=m.id, description=m.description, amount=m.amount, deadline=m.deadline,
            status=RELEASED, proof_hash=m.proof_hash, decided_at=ts,
            approved_by=approver, late=late,
        ))
        self._released += m.amount
        self._record("milestone_released", approver, {"milestone": m.id, "amount": m.amount, "late": late}, now, None)
        return self

    def reject(self, milestone_id: str, approver: str, reason: str, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == IN_PROGRESS, "INVALID_STATE", "can only reject while in_progress")
        m = self._find(milestone_id)
        self._require(m.status == PROOF_SUBMITTED, "NO_PROOF", "only a submitted proof can be rejected")
        self._require(approver and approver != self._agent, "SELF_APPROVAL", "the agent cannot judge its own work")
        self._require(approver in self._approvers, "NOT_APPROVER", "approver is not registered for this escrow")
        self._require(isinstance(reason, str) and reason, "BAD_REASON", "rejection needs a reason")
        ts = now if now is not None else _now()
        self._replace_milestone(m, Milestone(
            id=m.id, description=m.description, amount=m.amount, deadline=m.deadline,
            status=REJECTED, proof_hash=m.proof_hash, decided_at=ts,
            rejected_by=approver, reason=reason,
        ))
        self._record("milestone_rejected", approver, {"milestone": m.id, "reason": reason}, now, None)
        return self

    def dispute(self, reason: str, by: Optional[str] = None, now: Optional[int] = None) -> "Escrow":
        self._require(
            self._state in (FUNDED, IN_PROGRESS),
            "INVALID_STATE",
            "only funded or in_progress escrows can be disputed",
        )
        by = by or self._client
        self._require(by == self._client, "FORBIDDEN", "only the client can open a dispute")
        self._require(isinstance(reason, str) and reason, "BAD_REASON", "dispute needs a reason")
        before = self._state
        self._state = DISPUTED
        self._record("disputed", by, {"reason": reason}, now, before)
        return self

    def resolve_dispute(self, action: str, by: Optional[str] = None, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == DISPUTED, "INVALID_STATE", "escrow is not in dispute")
        by = by or self._client
        self._require(by == self._client, "FORBIDDEN", "only the client can resolve a dispute")
        before = self._state
        if action == "refund":
            bal = self._balance()
            self._refunded += bal
            self._state = REFUNDED
            self._record("dispute_resolved_refund", by, {"refund": bal}, now, before)
        elif action == "resume":
            self._state = IN_PROGRESS
            self._record("dispute_resolved_resume", by, {}, now, before)
        else:
            raise EscrowError("BAD_ACTION", "action must be 'refund' or 'resume'")
        return self

    def settle(self, now: Optional[int] = None) -> "Escrow":
        self._require(self._state == IN_PROGRESS, "INVALID_STATE", "only in_progress escrows can be settled")
        self._require(self._all_decided(), "MILESTONES_OPEN", "all milestones must be released or rejected first")
        before = self._state
        bal = self._balance()
        self._refunded += bal
        self._state = SETTLED
        self._record("settled", self._client, {"refund": bal}, now, before)
        return self

    def cancel(self, by: Optional[str] = None, now: Optional[int] = None) -> "Escrow":
        self._require(
            self._state in (CREATED, FUNDED),
            "INVALID_STATE",
            "can only cancel before work starts",
        )
        by = by or self._client
        self._require(by == self._client, "FORBIDDEN", "only the client can cancel")
        before = self._state
        bal = self._balance()
        if bal > 0:
            self._refunded += bal
        self._state = CANCELLED
        self._record("cancelled", by, {"refund": bal}, now, before)
        return self

    # -- introspection ----------------------------------------------------

    @property
    def state(self) -> str:
        return self._state

    @property
    def balance(self) -> int:
        return self._balance()

    def milestones(self) -> List[Milestone]:
        return list(self._milestones)

    def audit(self) -> List[AuditEvent]:
        return list(self._audit)

    def assert_invariants(self) -> bool:
        """Bookkeeping check — call after any sequence of transitions."""
        for i, ev in enumerate(self._audit, start=1):
            if ev.seq != i:
                raise EscrowError("AUDIT_BROKEN", "audit seq is not monotonic")
        if self._released + self._refunded > self._funded:
            raise EscrowError("ACCOUNTING_BROKEN", "paid out more than funded")
        released_sum = sum(m.amount for m in self._milestones if m.status == RELEASED)
        if released_sum != self._released:
            raise EscrowError("ACCOUNTING_BROKEN", "released total does not match milestone releases")
        return True


def _now() -> int:
    return int(time.time())
