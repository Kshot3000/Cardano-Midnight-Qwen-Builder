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

## Cardano on-chain mapping (next)

One UTxO per escrow (state token) + treasury UTxO (lovelace). The validator
script enforces the transition table from SPEC.md; the audit log is re-anchored
in the token's script data per transition; proof hashes live in token metadata;
Midnight ZK networks can selectively disclose "milestone i is proven" without
revealing the artifact.
