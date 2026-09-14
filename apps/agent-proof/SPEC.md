# AgentProof — verify agent escrow receipts

**What it is.** A browser-based public-audit page for [Agent Escrow
Protocol](../agent-escrow/SPEC.md) receipts. Paste any receipt (JSON) and
re-derive its validity locally — the same pure `src/proofs.js` module that
the unit tests exercise. No server, no network calls, nothing leaves the
page.

**Why it exists.** The escrow app defines *how* an agent gets paid; AgentProof
is the *auditor*. Anyone — the client, an uninvolved third party, an indexer —
can take the receipt an escrow publishes and independently re-check it,
because the protocol's guarantees are stated as re-derivable invariants, not
trusted assertions.

## The seven checks

| # | Check | What it re-derives |
|---|-------|--------------------|
| 1 | `structure` | The receipt parses and every field has a valid shape (ids, states, integer lovelace, milestone/audit invariants). |
| 2 | `proof_format` | Every released milestone carries a well-formed proof hash (`0x` + ≥8 hex); any malformed hash anywhere is flagged. |
| 3 | `proof_match` | Each released milestone's proof hash equals the commitment in `commits` (case-insensitive hex). A release with no published commitment is **unverifiable** and fails. |
| 4 | `milestone_state` | Released milestones were approved by a *registered, non-agent* approver; rejected ones carry a reason. Self-approval fails. |
| 5 | `accounting` | `funded = released + refunded`, `released = Σ released milestones`, and no negative balance. |
| 6 | `audit_chain` | Audit events are exactly seq 1..N in order, monotonically timestamped, and the final `stateAfter` equals the receipt's claimed state. |
| 7 | `audit_actors` | Every event is allowed for its actor, state transition, and payload: only the client funds/starts/disputes/resolves, only the agent submits proofs, only registered non-agent approvers release/reject, refunds carry amounts, and no illegal transition (e.g. `funded` after `settled`) appears. |

A structurally invalid receipt (or unparseable JSON) fails `structure` and
skips the remaining six — they have nothing valid to look at.

## Escrow balance is audit-derived, not header-trusted

`escrowBalance(r)` re-derives the locked amount from the audit trail —
`Σ funded.amount − Σ milestone_released.amount − Σ (settled|cancelled|
dispute_resolved_refund).refund` — not from the header. A tampered header
(`refunded` rewritten) cannot hide where the money went: the accounting and
audit checks both still fire.

## Files

- `index.html` — the Pages page (paste → report).
- `app.js` — browser entry; builds the demo receipt by driving the **real**
  `agent-escrow` state machine (`createEscrow`), so the sample is a genuine
  artifact, not a hand-written fixture.
- `src/proofs.js` — the pure verification module (zero deps, browser-safe:
  `sha256Hex` uses WebCrypto).
- `test/proofs.test.mjs` — 64 unit tests, including three E2E tests that
  build live escrows (settle, dispute→resume, and post-hoc tampering) and
  verify the exported receipts.

## Run the tests

```sh
node --test apps/agent-proof/test/proofs.test.mjs
```

## Try it

<https://Kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/agent-proof/>
