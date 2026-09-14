# Governance Watch

A live dashboard for **Midnight on-chain governance**. It shows who runs the
network — the **council** and the **technical committee** — what they vote on,
how those votes resolve, and how the authority's membership gets rotated.

Data comes from the public, keyless **NightForge explorer API**:

```
GET https://mainnet.nightforge.jp/api/governance
```

The endpoint reports:

| Field | Meaning |
| --- | --- |
| `council.proposals` / `council.votes` | The council's motions and vote events |
| `technicalCommittee.proposals` / `technicalCommittee.votes` | The technical committee's motions and votes |
| `authorityResets[]` | Every rotation of the federated authority's member set (SS58 keys + pubkeys) |
| `summary.totalGovernanceActions` | Lifetime count of proposal + vote + reset events |
| `summary.lastActivity` | Unix seconds of the most recent governance event |

## The data model (and the one real gotcha)

The explorer emits each vote as a **cumulative running tally** — the `data`
tuple on a vote event is `[voter, motionHash, vote, ayes, anos, …]` where
`ayes`/`anos` are the *running totals after that vote*. A single vote can also
be re-emitted, and a voter can re-vote. So a naive "count the rows" tally
double-counts.

**Governance Watch takes the tally from the *latest* vote event per motion**
(largest `(timestamp, block_height)`) as the authoritative result. Each
proposal's `data` tuple is `[proposer, motionIndex, motionHash, threshold, …]`,
where `threshold` is the size of the authority the motion is decided by.

Decision states:

- **approved** — final `ayes >= threshold`.
- **rejected** — approval is arithmetically impossible: even if every
  remaining member voted yes, the yes-total can't reach the threshold.
  (Computed as `ayes + (members - cast) < threshold`.)
- **active** — still undecided (no tally, or the outcome isn't settled yet).

These rules reproduce live mainnet data exactly — all 10 motions, including a
rejected technical-committee motion (0 yes / 5 no). See
`test/governance.test.mjs` (31 tests) which asserts the real numbers.

## Layout

- `index.html` — self-contained dashboard (health gauge, summary stats,
  per-committee motion lists with running-tally bars, authority-reset table).
- `src/governance.js` — pure, dependency-free logic module (parsers, tally
  reduction, decision classification, authority timeline, roll-up stats, and
  the 0–100 health rubric). No network, no `Date.now` inside — fully
  unit-testable.
- `app.js` — thin fetch + render layer that calls the pure module.
- `test/governance.test.mjs` — 31 unit tests (synthetic edge cases +
  end-to-end assertions on the real live fixture in
  `test/fixtures/governance.json`).

## The health score (0–100)

Four named components, 25 points each, computed in `governance.js`
(`governanceHealth`):

1. **Motions are being decided** — share of motions with a final outcome.
2. **Quorum participation** — average (votes cast ÷ threshold) on decided motions.
3. **Authority populated & rotating** — a non-empty authority that has been reset.
4. **Recent governance activity** — freshness of the last governance event.

No invented fields: if the endpoint doesn't expose something, the component
scores conservatively and the UI shows `–` rather than a fake number.

## Run the tests

```sh
node --test apps/governance-watch/test/governance.test.mjs
```

## Notes

- Auto-refreshes every 60 seconds.
- Motion hashes, voter and member SS58 keys are on-chain public identifiers.
- Informational tool — verify governance state against official sources before
  relying on it.
