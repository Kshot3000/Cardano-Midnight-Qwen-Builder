# Reward Flow Watch

Live **Cardano monetary-engine dashboard** — where the new ADA goes, epoch by
epoch. Every Cardano epoch the protocol mints new ADA from the gap between
current supply and the **45 billion hard cap**. This page pulls the last 20
completed epochs from the official totals table, measures the real mint, the
headroom consumed, the fee income, and the implied reward claims, and
re-checks two conservation identities in your browser.

Built by the Cardano Midnight Qwen Builder (Qwen3.8-27B) on 2026-09-14.

## What it shows

| Panel | Data |
|-------|------|
| 🩺 Engine-health score (0–100) | Transparent 4-check rubric — see below |
| 🏛 Supply vs the hard cap | Current supply, headroom (reserves), circulation, unclaimed reward pot, treasury, cap utilization bar |
| 📈 Mint per epoch | Per-epoch mint sparkline (supply delta), avg mint, effective rate per epoch and per year (73 epochs) |
| 🔍 Conservation audit | Hard-cap identity (`supply + reserves == 45B`, every epoch) + mint == headroom-decay identity, both recomputed |
| 🪙 Reward pot & fee income | Window reward-pot change, fee income (sum of per-epoch fee income), implied claims (`mint + fees − Δpot`), nominal ρ labeled separately from the effective rate |
| 🕗 Per-epoch ledger | Newest-first table: supply, headroom, mint, effective rate, per-row conservation check |

## Data source

Public, keyless, CORS-enabled [data.cardano.org totals
table](https://data.cardano.org/k/api/v1/totals):

- `GET /k/api/v1/tip` — current (in-progress) epoch + block height/time.
- `GET /k/api/v1/totals?limit=21&select=…` — newest-first lovelace-string
  rows: `epoch_no, supply, reserves, treasury, reward, circulation, fees,
  treasury_donation, treasury_withdrawal, reserves_withdrawal`.

The API lists epochs **newest first**, so the app sorts chronologically and
drops the tip row (the in-progress epoch) before summarizing — a window of
exactly 20 completed epochs.

## Model (verified live 2026-09-14, epochs 635–655)

- `reserves` in this table is the **headroom to the hard max supply**:
  `supply + reserves == 45,000,000,000 ADA`, exact in every fetched row.
- Each epoch the protocol mints from that headroom:
  `mint = Δsupply == −Δreserves`, exact. Every minted coin consumes one coin
  of headroom — there is no third flow.
- The effective rate (`dS/S`, ≈0.16%/epoch recently) is **not** the nominal
  `monetaryExpansion` parameter ρ (0.3%/epoch). ρ sets the maximum reserve
  release; the actual mint is gated by the reserve ratio. The dashboard
  measures the effective rate from the data and labels the nominal parameter
  separately, so the two are never conflated.
- The unclaimed reward pot: `dReward == mint + fees_n − claims`, where `fees_n`
  is the epoch's fee income (the `fees` column is PER-epoch income, not
  cumulative — it oscillates epoch to epoch on live mainnet).

## Health rubric (transparent, in `src/flow.js`)

| Check | Points |
|-------|--------|
| `supply + reserves` conserved in every epoch transition | 40 |
| total mint == headroom consumed (±0.1%) | 25 |
| reward pot stays positive; implied claims plausible (≥ −1 ADA) | 20 |
| effective annual rate within a sane 0.5–5%/yr band (catches lovelace/ADA unit errors and dead epochs) | 15 |

## Tests

`node --test apps/reward-flow/test/flow.test.mjs apps/reward-flow/test/mainnet.test.mjs`

- **flow.test.mjs (15 tests)** — normalization (incl. a real live row and
  null-mapping), conservation + claims identities on exact synthetic series,
  summary math, health-rubric pass/fail paths (drift, absurd rate, dead
  epochs), formatter edge cases.
- **mainnet.test.mjs (6 tests)** — a fixture of **21 verbatim mainnet rows**
  fetched 2026-09-14 run through the exact runtime pipeline (normalize →
  drop tip row → sort → summarize → health). Pins the indexer's field names,
  units, and conservation behavior against real data: if the table ever
  changes, the test fails loudly instead of the page silently showing wrong
  numbers.
