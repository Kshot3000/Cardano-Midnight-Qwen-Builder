# Agent Escrow — Compact port notes

Reference implementations in this folder are **JavaScript** and **Python**
(off-chain state machines). The Midnight **Compact** skeleton lives in a
sister lab:

- https://github.com/Kshot3000/Midnight-GrokBot-Agent/tree/main/contracts/agent-escrow

This document is the bridge: how to take the JS/Python protocol onto Midnight
without inventing APIs or weakening auth.

> **Compile status:** this repo does **not** claim a successful Compact compile.
> Run the official toolchain yourself after installing Compact (~0.31.1 matrix).

## Prefer live starters (Counter is archived)

| Starter | Status | Use for |
| --- | --- | --- |
| [`example-bboard`](https://github.com/midnightntwrk/example-bboard) | **Live** | Witnesses, `persistentHash` identity, full DApp shape |
| [`create-mn-app`](https://github.com/midnightntwrk/create-mn-app) | **Live** | Scaffold (`bboard` / `battleship` / `leaderboard` templates) |
| [`example-counter`](https://github.com/midnightntwrk/example-counter) | **Archived** | Historical only — do not start new work here |

Official docs:

- Compact language: https://docs.midnight.network/compact
- Install toolchain: https://docs.midnight.network/getting-started/installation
- Bboard tutorial: https://docs.midnight.network/examples/dapps/bboard
- Leaderboard contract: https://docs.midnight.network/tutorials/leaderboard/smart-contract

## Auth: never `ownPublicKey()` alone (MPS-0029)

`ownPublicKey()` is **prover-supplied**. Comparing it to a stored public key does
**not** prove possession of the corresponding secret. Anyone who reads a ledger
key can replay it inside a proof.

**Do this instead** (same family as bulletin-board / leaderboard):

```text
roleCommitment(sk, tag) =
  persistentHash([ pad(32, "agent-escrow:role:"), tag, sk ])
```

- Client / agent / approver each hold a `localSecretKey` witness.
- `initialize` stores **commitments**, not raw keys.
- Privileged circuits assert `roleCommitment(localSecretKey(), tag) == storedPk`.
- Enforce `agentPk ≠ clientPk` and `agentPk ≠ approverPk` at init
  (JS/Python now reject registering the agent as an approver — same rule).

The JS/Python `client` / `agent` / `approver` strings are **opaque role ids**.
On Compact they become those witness-derived commitments.

## Circuit map (JS/Python → Compact)

| Off-chain API | Compact circuit (skeleton) | Who |
| --- | --- | --- |
| `createEscrow` + roles | `initialize(agent, approver)` | client witness |
| milestone list at create | `addMilestone(amount, deadline)` | client |
| `fund` | `fund(amount)` | client |
| `start` | `start()` | client |
| `submitProof` | `submitProof(id, proofHash)` | agent |
| `approve` | `approve(id)` | client or approver |
| `reject` | `reject(id)` | client or approver |
| `dispute` | `dispute()` | client |
| `resolveDispute("refund")` | `resolveDisputeRefund()` | client |
| `resolveDispute("resume")` | `resolveDisputeResume()` | client |
| `settle` | `settle()` | client |
| `cancel` | `cancel()` | client |

Amounts stay integer subunits (lovelace off-chain). Proof verification remains
**off-chain / ZK claim** in v0 — the skeleton stores a `Bytes<32>` commitment.

## Pragma / compiler pin

| Piece | Expectation |
| --- | --- |
| Compact compiler | **~0.31.1** (create-mn-app / example-bboard matrix) |
| Language pragma | `pragma language_version >= 0.23;` (or exact `0.23` if `>=` rejected) |
| Proof server | Docker image from Midnight install guide |

## Branding

- **X:** [@kshot9000](https://x.com/kshot9000)
- **ADA:** `addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v`
