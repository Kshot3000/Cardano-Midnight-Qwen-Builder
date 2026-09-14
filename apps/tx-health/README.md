# Transaction Health Monitor

Live **Midnight settlement-quality dashboard** — how cleanly the chain
actually settles, over its entire life: lifetime applied vs
partial-success extrinsics, the most recent partials on the record, and the
on-chain **D-parameter** timeline (permissioned vs registered
validator-candidate pool, genesis to now).

Built by the Cardano Midnight Qwen Builder (Qwen3.8-27B) on 2026-09-14.

## What it shows

| Panel | Data |
|-------|------|
| 🩺 Settlement health score (0–100) | Transparent 4-check rubric — see below |
| 🧾 Lifetime stats | Applied / partial-success / total, applied share, recomputed partial rate vs indexer-reported rate (pp delta), `applied + partial = total` integrity flag, proportional split bar |
| 🚨 Recent partial-success register | Newest-first de-duplicated list of partial extrinsics: hash, block, time, age — with an honest count of dropped duplicate emissions |
| 🧭 D-parameter timeline | Every state of the on-chain decentralization parameter: block, time, permissioned + registered candidates, permissioned share; genesis & current states tagged |

## Data sources

Public, keyless, CORS-enabled [NightForge explorer API](https://nightforge.jp/api/docs)
(`mainnet.nightforge.jp`):

- `GET /api/analytics/tx-health` — lifetime `applied` / `partialSuccess` /
  `total` / `partialRatePct` (local index), plus `recentPartial[]`
  (`txHash`, `blockHeight`, `timestamp` in **unix seconds**).
- `GET /api/governance/d-parameter` — `history[]` of
  `{blockHeight, timestamp (unix **milliseconds**), numPermissionedCandidates,
  numRegisteredCandidates}`. Shipped **newest-first** and unsorted.

The two endpoints use different timestamp units (seconds vs milliseconds)
and different ordering — both are normalized in pure code (`toSeconds`,
`parseDParam`) and covered by tests.

## The health rubric (pure, unit-tested)

| Pts | Check |
|-----|-------|
| +35 | Clean settlement — recomputed partial rate < 1% |
| +20 | Low partial rate — recomputed partial rate < 5% |
| +25 | Ledger adds up — `applied + partialSuccess == total` |
| +20 | Self-consistent — recomputed rate within 0.1pp of the indexer-reported rate |

Checks 1 and 2 are cumulative (a sub-1% rate earns both).
Bands: ≥80 healthy · ≥50 degraded · ≥25 watch · else critical.

## Layout

```
apps/tx-health/
├── index.html          self-contained page (no build step)
├── app.js              DOM wiring + 60s refresh
├── src/txhealth.js     pure metric logic (zero deps)
└── test/txhealth.test.mjs   30 node --test unit tests
```

`src/txhealth.js` is pure — no network, no `Date.now()` inside — so every
metric is unit-testable. Test fixtures include the **real live payloads**
captured from both endpoints on 2026-09-14 (256,178 tx indexed, 8,740
partial, reported rate 3.41%; D-parameter 10 → 130 permissioned candidates),
including the triple-emitted partial tx that forces de-duplication.

## Run the tests

```sh
node --test apps/tx-health/test/txhealth.test.mjs
```

## Honesty policy

- The partial rate displayed is **recomputed from raw counts**, then
  cross-checked against the indexer-reported value (delta shown in pp).
- Missing fields render as `–` — no invented numbers.
- The recent-partial register is de-duplicated and the number of dropped
  duplicate emissions is displayed, not silently swallowed.
- A partial-success extrinsic is a *settled* extrinsic with a failed inner
  call — a quality signal, not a failed transaction.
