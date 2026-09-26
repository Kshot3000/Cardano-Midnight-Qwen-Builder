# 🤝 Agent Escrow Protocol

Milestone-based escrow payments for AI-agent work — the building block for
**verifiable workloads** on Cardano + Midnight.

> AI agents need budgets, not vibes. Release on-chain escrow only after a signed
> milestone, usage proof, or human approval. Low-cost Cardano settlement makes
> that practical for agent marketplaces. The killer feature isn't autonomy. It's
> accountable execution.

- **Spec:** [SPEC.md](SPEC.md)
- **JS implementation:** [src/escrow.js](src/escrow.js) (ES module, zero deps)
- **Python implementation:** [src/escrow.py](src/escrow.py) (stdlib only)
- **Live page:** https://Kshot3000.github.io/Cardano-Midnight-Qwen-Builder/apps/agent-escrow/

## Quick start (JavaScript)

```js
import { createEscrow } from "./src/escrow.js";

const L = 1_000_000; // 1 ADA
const escrow = createEscrow({
  client: "alice",
  agent: "agent-1",
  approvers: ["auditor"],
  milestones: [
    { id: "m1", description: "scaffold", amount: 1 * L, deadline: Date.now() + 86400_000 },
    { id: "m2", description: "app", amount: 4 * L, deadline: Date.now() + 2 * 86400_000 },
  ],
});

escrow.fund(5 * L);
escrow.start();
escrow.submitProof("m1", "0x9f2c41ab");
escrow.approve("m1", "auditor");        // agent can NEVER do this
escrow.submitProof("m2", "0x41b0de77");
escrow.reject("m2", "auditor", "CI red");
escrow.settle();                        // refunds the unspent remainder
escrow.assertInvariants();              // accounting + audit checks
```

## Quick start (Python)

```python
import time
from src.escrow import Escrow, Milestone

now = lambda: int(time.time())
L = 1_000_000
e = Escrow(
    client="alice", agent="agent-1", approvers=["auditor"],
    milestones=[
        Milestone(id="m1", description="scaffold", amount=1 * L, deadline=now() + 86400),
        Milestone(id="m2", description="app", amount=4 * L, deadline=now() + 2 * 86400),
    ],
)
e.fund(5 * L).start()
e.submit_proof("m1", "0x9f2c41ab")
e.approve("m1", "auditor")
e.submit_proof("m2", "0x41b0de77")
e.reject("m2", "auditor", "CI red")
e.settle()
assert e.assert_invariants()
```

## Run the tests

```bash
node --test apps/agent-escrow/test/escrow.test.mjs
python -m unittest discover -s apps/agent-escrow/test -v
```

## Run the demo

```bash
node apps/agent-escrow/demo.js
python apps/agent-escrow/demo.py
```


## Compact / Midnight port

Off-chain JS + Python is the **reference protocol**. The Compact skeleton and
MPS-0029 auth notes live here:

- Port guide: [COMPACT-PORT.md](COMPACT-PORT.md)
- Compact skeleton: [Kshot3000/Midnight-GrokBot-Agent/contracts/agent-escrow](https://github.com/Kshot3000/Midnight-GrokBot-Agent/tree/main/contracts/agent-escrow)

**Live starters** (do not use archived Counter):
[`example-bboard`](https://github.com/midnightntwrk/example-bboard) ·
[`create-mn-app`](https://github.com/midnightntwrk/create-mn-app).

**Auth (MPS-0029):** never authorize with `ownPublicKey()` alone. This reference
rejects registering the agent as an approver at create time — Compact stores
witness-derived role commitments with the same separation of duties.

## Branding

- **X:** [@kshot9000](https://x.com/kshot9000)
- **ADA:** `addr1q8hnl6vl5a6k3rw3n5g3jtte696zcl76kfatzv7gpswa9r0dj7fma6klq55y4ffm7tf0em09udnyhuk4ah92pl5x9jpqjae44v`

## Cardano on-chain mapping (next)

One UTxO per escrow (state token) + treasury UTxO (lovelace). The validator
script enforces the transition table from SPEC.md; the audit log is re-anchored
in the token's script data per transition; proof hashes live in token metadata;
Midnight ZK networks can selectively disclose "milestone i is proven" without
revealing the artifact.
