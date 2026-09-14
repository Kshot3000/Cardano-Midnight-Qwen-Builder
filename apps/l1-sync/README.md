# L1 Sync Watch

Live dashboard of **Midnight's Cardano L1 observation stream** — the on-chain
component in Midnight that watches the Cardano mainchain and folds its blocks
into Midnight. The page answers one question, continuously:

> *Which Cardano block is Midnight observing right now, and how far behind is
> it from the Cardano tip?*

## What it shows

| Panel | Source of truth |
|---|---|
| **Live lag vs tip** | Highest observed L1 block (`/api/extrinsics`) vs `data.cardano.org/k/api/v1/tip` (Koios). Block lag is exact; seconds are an estimate at 20 s/block and labeled as such. |
| **L1 sync health score (0–100)** | Transparent rubric in `src/sync.js` → `syncHealth`: tight lag (≤ 3,000 blocks, +30), steady median observation cadence (≤ 300 s, +30), broad coverage (≥ 10 distinct L1 blocks in window, +20), asset flow (token events present, +20). Status: healthy ≥ 80, degraded ≥ 50, watch ≥ 25, else critical. |
| **Observation cadence** | Seconds between successive `processTokens` observations in the scanned window (median/min/max + bar chart). Gaps without observations are not fabricated. |
| **Scan window** | Midnight block range scanned, distinct Cardano blocks covered, token-event totals (creates / spends, with 6-decimal values). |
| **Recent observations** | Table of the newest observations: Midnight extrinsic hash, Midnight block, observed L1 block, token events, age. |

## Data sources (public, keyless, CORS-enabled)

1. **NightForge explorer** — `https://mainnet.nightforge.jp/api/extrinsics?limit=N`
   (newest-first extrinsics). Midnight's observer is
   `section: "cNightObservation"`, `method: "processTokens"`. Its `args` is a
   JSON string of `[ eventsJson, blockRefJson ]` — two *nested JSON strings*:
   an array of token events and the block reference
   `{ blockHash, blockNumber, blockTimestamp, txIndexInBlock }`.
2. **Koios (data.cardano.org)** — `GET /k/api/v1/tip` for the live Cardano
   tip (`block_height`, `epoch_no`).

## Architecture

- `src/sync.js` — pure logic, zero deps, no `Date.now()`/network:
  - `parseProcessTokens(argsRaw)` — deep-parses the two nested JSON strings,
    identifying the events array vs the block-reference object **by shape**
    (array vs object) rather than position. A batched call can carry events
    from several L1 blocks; the observed L1 block is the **max** of
    { block reference, event `txPosition.blockNumber` }. Tolerates malformed /
    truncated args via a regex fallback on the raw string.
  - `analyzeExtrinsics(extrinsics)` — filters the observation stream, computes
    window bounds, distinct-block coverage, and token-event totals.
  - `observationCadence(analysis)`, `median`, `l1Lag`, `syncHealth`,
    `ageLabel`, `formatTokens`, `normalize`.
- `app.js` — browser bootstrap: fetches both sources in parallel, renders,
  refreshes every 60 s, shows a stale pill on failure (never fake data).
- `index.html` — self-contained page (relative `../../styles.css`,
  `../../assets/common.js` for nav/footer/X account, donate box with the
  project's Cardano address).

## Tests

`node --test apps/l1-sync/test/sync.test.mjs` — 22 tests covering the
parser (empty batch, real multi-block batch fixture, head-vs-events max
folding, garbage input, truncated-args fallback), analysis, cadence, lag,
health rubric boundaries, and formatters. Fixtures are real shapes captured
from the live `/api/extrinsics` stream.
