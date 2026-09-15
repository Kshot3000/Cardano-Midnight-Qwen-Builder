# DRep Watch

Live **Cardano governance dashboard** — who is registered as a DRep, how much
stake is delegated to DReps each epoch, and how that delegation has grown since
Conway began. This page pulls the live DRep census and every per-epoch
delegation snapshot from the official indexer, decodes each `drep1…`
credential in your browser (CIP-129), and scores governance participation with
a transparent 0–100 rubric.

Built by the Cardano Midnight Qwen Builder (Qwen3.8-27B) on 2026-09-14.

## What it shows

| Panel | Data |
|-------|------|
| 🩺 Participation health (0–100) | Transparent 5-check rubric — see below |
| 📋 DRep census | Registered DReps, key-based (header `0x22`) vs script-based (header `0x23`) split, and the register-integrity bar (share of ids that decode as valid CIP-129 credentials) |
| 📈 Delegation over time | Per-epoch delegated-stake sparkline + active-DRep sparkline, latest-epoch value, growth since Conway, and the multiplier (~88× live) |
| 🧮 Share of circulation | Delegated DRep stake ÷ latest completed epoch's circulation, as a bar + callout |
| 🕗 Recent epochs | Newest-first table: delegated stake, active DReps, and epoch-over-epoch deltas |

## Data source

Public, keyless, CORS-enabled [data.cardano.org Koios endpoints](https://data.cardano.org/k/api/v1/drep_list):

- `GET /tip` — current (in-progress) epoch + block height/time.
- `GET /k/api/v1/drep_epoch_summary` — one row per Conway epoch:
  `{ epoch_no, amount, dreps }`. `amount` is the lovelace of ADA delegated to
  DReps that epoch; `dreps` is the count of distinct DReps holding delegated
  stake. Live: 148 epochs, 508 → 655.
- `GET /k/api/v1/drep_list` — the current census: `{ drep_id, hex, has_script,
  registered }` per DRep.
- `GET /k/api/v1/totals?limit=2` — per-epoch `circulation` (the denominator
  for the share).

The current in-progress epoch is excluded from the trend (same rule as Reward
Flow Watch) so every plotted row is a completed snapshot.

## The credential codec (`src/codec.js`)

CIP-129 ("Governance Identifiers") defines the Conway DRep id: a BIP-173
bech32 string with HRP `drep` whose payload encodes a **1-byte credential
header** (`tttt.cccc`, top 4 bits = key type) followed by a **28-byte
blake2b-224 hash**:

- DRep key hash: `0010.0010` → **`0x22`**
- DRep script hash: `0010.0011` → **`0x23`**

So `drep1…` = `0x22‖hash` (key) or `0x23‖hash` (script). The codec
verifies the bech32 checksum, checks the HRP, decodes the header + hash, and
re-encodes. The 28-byte hash is exactly the 56-hex-char `hex` field Koios
exposes. Two implementation subtleties the tests pin:

- **checksum generation** must XOR the polymod with `1` before extracting the
  top 30 bits (BIP-173); verification is the un-xor'd `== 1`.
- **byte↔5-bit conversion** must mask the accumulator after every extraction —
  without the mask the top byte comes out misaligned and (for 29-byte
  payloads) the accumulator overflows float64.

The codec is pinned to the **CIP-129 official test vector** (28 zero bytes →
`drep1ygq…7vlc9n`) and to **280 real mainnet DReps** fetched live: all 280
decode to the node's exact `hex` field and round-trip to the exact id.

## Model (verified live 2026-09-14, epochs 508–655)

- `drep_epoch_summary.amount` grows ~monotonically over the Conway era:
  **~172.9M ADA at ep 508 → ~15.22B ADA at ep 655** (~88×), as stake moves
  from pool voting into governance DRep voting.
- `drep_epoch_summary.dreps` (active DReps holding delegated stake) grew
  **263 → 870** across the same window.
- The registered **census** (`drep_list`) is the full register; the *active*
  count is the subset holding stake in the latest epoch. Both are shown,
  separately and honestly.
- **Share of circulation** = latest delegated stake ÷ latest completed
  epoch's `totals.circulation` — **~41% live at ep 655**.

## Health rubric (transparent, in `src/trend.js`)

| Check | Points |
|-------|--------|
| delegated stake is a meaningful 10–80% of circulation | 30 |
| delegated stake grew over the window | 25 |
| every registered DRep id is a valid CIP-129 credential | 20 |
| active DRep count grew over the window | 15 |
| indexer data present (circulation + trend) | 10 |

## Tests

`node --test apps/drep-watch/test/codec.test.mjs apps/drep-watch/test/trend.test.mjs apps/drep-watch/test/mainnet.test.mjs`

- **codec.test.mjs (20 tests)** — BIP-173 polymod vectors, the CIP-129 official
  test vector (encode + decode), validate/decode/encode over 6 real mainnet
  pairs, separator/charset/HRP/mixed-case/bad-length rejection, foreign-header
  rejection, and short-id formatting.
- **trend.test.mjs (15 tests)** — normalization (lovelace→ADA exact, string
  inputs, null-mapping), census tally over real live rows, delegation-trend
  growth/delta/sort/skip math, share + null guards, health-rubric pass/fail,
  and formatter edge cases.
- **mainnet.test.mjs (4 tests)** — a fixture of **10 verbatim mainnet epochs**
  (first three Conway + last six completed, fetched 2026-09-14) plus the real
  ep-655 circulation, run through the exact runtime pipeline. Pins the
  ~88× growth, 263→870 active DReps, and ~41% share against real data: if the
  indexer ever changes a field, the test fails loudly instead of the page
  silently showing wrong numbers.
