# Validator Watch

Live **Midnight validator-decentralization dashboard** — who is actually
producing the chain's blocks, and how decentralized that is. The official
indexer samples recent blocks and aggregates them by author; this page
counts real sampled blocks per permissioned producer, recomputes the
concentration (top-1 / top-3 / HHI) from raw counts and cross-checks it
against the indexer's own percentages, shows the 6-second block cadence over
the last 24 hours, and tracks the on-chain **D-parameter** journey — how the
permissioned validator pool has grown since genesis.

Built by the Cardano Midnight Qwen Builder (Qwen3.8-27B) on 2026-09-14.

## What it shows

| Panel | Data |
|-------|------|
| ⚖️ Decentralization score (0–100) | Transparent 4-check rubric — see below |
| 📊 Concentration | Active producer count + type, sampled blocks (raw sum vs API sample), top-1 / top-3 / HHI recomputed from raw counts with even-split baseline and pp delta |
| ⛓️ Live producer share | Sampled blocks per producer with recomputed-share bar and the indexer's reported % side by side |
| ⏱️ Block cadence (24h) | Hourly block count vs the 600/hour expectation (6s cadence), mean over complete hours, on-target hour count, 24h blocks + extrinsics |
| 🧭 D-parameter journey | Permissioned vs registered candidate pool state by state; first → latest delta and days elapsed |

## Data sources

Public, keyless, CORS-enabled [NightForge explorer API](https://nightforge.jp/api/docs)
(`mainnet.nightforge.jp`):

- `GET /api/block-producers?limit=200` — `{ totalBlocks, sampled,
  producers: [{ pubkey, blocks, percentage, name, type }] }`. `totalBlocks`
  is the **full chain length**; `sampled` is how many blocks the indexer
  actually aggregated. The API caps `limit` at 200.
- `GET /api/analytics/block-rate?hours=24` — `[{ hour (unix **seconds**),
  blocks, extrinsics }]`, chronological, 24 rows (the current hour is
  partial).
- `GET /api/governance/d-parameter` — `{ history: [{ blockHeight, timestamp
  (unix **milliseconds**), numPermissionedCandidates, numRegisteredCandidates }],
  timestamp }`, shipped newest-first and unsorted.

`block-rate` uses **seconds**, `d-parameter` uses **milliseconds** — both are
normalized in pure code (`toSeconds`) and covered by tests.

## The decentralization rubric (pure, unit-tested)

| Pts | Check |
|-----|-------|
| +30 | Sampled enough — the API actually sampled ≥ 100 blocks (a stable share) |
| +25 | No solo — top-1 producer's recomputed share ≤ 20% |
| +25 | No duopoly — top-3 producers' combined recomputed share ≤ 45% |
| +20 | Self-consistent — raw block counts sum to the API `sampled` value **and** every reported percentage recomputes within 0.5pp (rounding tolerance) |

Bands: ≥90 Healthy · ≥60 Watch · else At risk. A missing/never-run integrity
check is reported as **pending** (not passed, not failed) rather than
invented.

## Layout

```
apps/validator-watch/
├── index.html          self-contained page (no build step)
├── app.js              DOM wiring + 60s refresh
├── src/producers.js    pure metric logic (zero deps)
└── test/producers.test.mjs   36 node --test unit tests
```

`src/producers.js` is pure — no network, no `Date.now()` inside — so every
metric is unit-testable. Test fixtures include the **real live payloads**
captured from all three endpoints on 2026-09-14 (13 permissioned producers,
14,400 blocks sampled, HHI 0.0800; 24h block-rate at exactly 600/hour for 23
complete hours; D-parameter 10 → 130 permissioned candidates), including the
producer name that arrives with an embedded newline (`"Validator\n#13"`).

## Run the tests

```sh
node --test apps/validator-watch/test/producers.test.mjs
```

## Honesty policy

- Concentration (top-1 / top-3 / HHI) is **recomputed from raw block counts**,
  then cross-checked against the indexer's reported percentages — mismatches
  beyond a 0.5pp rounding tolerance are counted and surfaced.
- HHI is reported with the even-split baseline (1/N) so a "perfectly even"
  decentralization reads as the expected ~0.077 for 13 producers, not an
  unexplained 0.08.
- The current partial hour is excluded from the cadence mean (≥98% of
  expected blocks qualifies as "complete") so it can't skew the figure.
- Missing fields render as `–` — no invented numbers.
- A producer with 0 sampled blocks is not a producer and is dropped, not
  shown as a zero share.
