# Privacy Trend Watch

Live **Midnight privacy dashboard** — the shielded-vs-unshielded split of
Midnight transactions, measured hour by hour over any window from **1 hour to
7 days**, plus a register of every unshielded transaction the window contains,
decoded.

Built by the Cardano Midnight Qwen Builder (Qwen3.8-27B) on 2026-09-14.

## What it shows

| Panel | Data |
|-------|------|
| 🩺 Privacy health score (0–100) | Transparent 5-check rubric — see below |
| 🛡️ Window stats | Midnight tx count, shielded / unshielded split, contract calls & deploys, API-reported ratio vs **recomputed** ratio |
| 📈 Hourly activity | Per-hour Midnight tx bars (unshielded hours turn red), avg & peak hour |
| 📊 Half-window growth | Second half of the window vs first half (refuses fake 0% when history is short) |
| 🚨 Unshielded-incident register | Every unshielded tx: Midnight block, age, unique addresses, unique tokens, value spent/created — deduped (the indexer is known to emit the same tx twice), newest first |
| 🌐 Lifetime context | Lifetime shielded ratio + block count from `/api/analytics/overview` |

## Data sources

Public, keyless, CORS-enabled [NightForge explorer API](https://nightforge.jp/api/docs)
(`mainnet.nightforge.jp`):

- `GET /api/analytics/privacy?hours=N` (N ≤ 168) — window counts, hourly
  `trend`, and `unshieldedDetails` (each a JSON **string** payload with
  `spent` / `created` legs: address, tokenType, intentHash, value, outputNo).
- `GET /api/analytics/overview` — lifetime `shieldedRatio`, `blocks`,
  `networkAgeDays`.

## The health rubric (pure, unit-tested)

| Pts | Check |
|-----|-------|
| +35 | Shielding dominant — recomputed shielded/total ≥ 95% |
| +20 | Sustained activity — ≥ 100 Midnight txs in the window |
| +20 | Stable flow — second-half vs first-half tx growth within ±25% |
| +15 | Unshielded rare — unshielded ≤ 1% of txs |
| +10 | Self-consistent — recomputed ratio within 0.5pp of the API-reported ratio |

Bands: ≥80 healthy · ≥50 degraded · ≥25 watch · else critical.

## Layout

```
apps/privacy-watch/
├── index.html          self-contained page (no build step)
├── app.js              DOM wiring + window switching (1h/6h/24h/3d/7d)
├── src/privacy.js      pure metric logic (zero deps)
└── test/privacy.test.mjs   23 node --test unit tests
```

`src/privacy.js` is pure — no network, no `Date.now()` inside — so every
metric is unit-testable. Test fixtures include a **real live payload**
captured from the API on 2026-09-14 (12h window: 298 tx, 297 shielded,
1 unshielded, ratio 0.9966), including the real unshielded payload string
that NightForge double-emits.

## Run the tests

```sh
node --test apps/privacy-watch/test/privacy.test.mjs
```

## Honesty policy

- The shielded ratio displayed is **recomputed from raw counts**, then
  cross-checked against the API-reported value (delta shown in pp).
- Missing fields render as `–` — no invented numbers.
- Unshielded transactions are *valid* Midnight transactions that chose
  transparency (common for contract calls / token-management ops); the
  register is a ledger of exceptions, not a scandal board.
