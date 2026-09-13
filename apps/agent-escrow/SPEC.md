# Agent Escrow Protocol — SPEC

Milestone-based escrow payments for AI-agent work. The core idea: **release
on-chain escrow only after a signed milestone, usage proof, or human
approval.** Low-cost Cardano settlement makes that practical for agent
marketplaces.

The killer feature isn't autonomy. It's **accountable execution**.

## Parties

| Role | Constraints |
|------|-------------|
| **client** | Funds the escrow, may approve milestones, may dispute, may resolve disputes (refund/resume), may cancel before start |
| **agent** | Works the milestones, submits proof hashes. **Never** approves, judges, or cancels its own work |
| **approver(s)** | Registered at creation (client is always one). Releases or rejects milestones against submitted proofs |

## States

```
created ──fund──> funded ──start──> in_progress ──settle──> settled
                     │   │              │  │
                     │   └────cancel────┘  └──dispute──> disputed
                     │                            │
                     └──────────────cancel────────┘
                                            ┌────┴─────┐
                                        refund        resume
                                            │           │
                                         refunded   in_progress
```

- `funded → in_progress`: `start` — requires ≥1 milestone whose total ≤ funded amount.
- `in_progress`: per-milestone loop `proof_submitted → released | rejected`.
- `settle`: allowed when every milestone is `released` or `rejected`; refunds the remainder.
- `disputed`: freezes all releases; only the client resolves — `refund` (returns the
  whole remaining balance, state → `refunded`) or `resume` (back to `in_progress`).
- `cancel`: before work starts (`created`/`funded`), client only, refunds the deposit.

## Milestones

```json
{ "id": "m1", "description": "Scaffold", "amount": 2000000, "deadline": 1700001000 }
```

- `amount` — positive integer **lovelace** (1 ADA = 1,000,000 lovelace).
- `deadline` — optional integer timestamp; approving after it is allowed but the
  release event is flagged `late: true` (a hook for penalty logic).

## Proof model

A proof is a hex hash (`0x` + ≥8 hex chars) the agent submits for a milestone —
e.g. `SHA-256` over the delivered artifact, a ZK witness commitment, or a signed
milestone receipt. **This reference spec does not verify proofs on-chain**; it
defines the off-chain workflow the on-chain contract enforces:

1. agent submits `proof_hash(m_i)` (only the agent may do this)
2. a registered approver (not the agent) verifies the proof off-chain
3. approver calls `approve(m_i)` → that milestone's amount leaves escrow
4. if verification fails → `reject(m_i, reason)` → funds stay escrowed

On Midnight, step 2 can be replaced with a ZK proof of the milestone claim and
selective disclosure of *that* claim only — no raw data ever leaves the agent.

## Guarantees (asserted in tests)

1. **Separation of duties** — the agent can never release funds for itself.
2. **No release without proof** — approval requires a submitted proof hash.
3. **Accounting** — `released + refunded ≤ funded` always holds; released total
   always equals the sum of released milestones.
4. **Auditability** — every transition appends an immutable audit event
   `(seq, at, type, actor, stateBefore, stateAfter, data)` with a monotonic seq.
5. **Idempotency of intent** — each state transition is allowed exactly from its
   documented pre-state; everything else raises a typed `EscrowError(code, msg)`.

## Cardano mapping (next step, on-chain)

- One UTxO per escrow (state token) + a treasury UTxO (the lovelace).
- Validator script enforces exactly the transition table above; the audit log is
  re-anchored in the token's script data per transition.
- Proof hashes live in the token metadata; Midnight's ZK network can selectively
  disclose "milestone i is proven" without revealing the artifact.

## Run the tests

```bash
node --test apps/agent-escrow/test/
python -m unittest discover -s apps/agent-escrow/test -v
```
