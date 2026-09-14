# Midnight DID Wallet

Build a `did:midnight` identity — and inspect any `did:midnight` DID — **entirely in the
browser**, with no dependencies, no npm install, and **no network calls**. The same codec the
unit tests exercise runs behind the page.

## Method reference

Official spec: [`midnightntwrk/midnight-did`](https://github.com/midnightntwrk/midnight-did),
file `w3c-spec/midnight-method.md` (W3C DID method spec for Midnight). This app implements the
**offchain** DID method plus ledger-form parsing.

### Offchain DIDs

- **Long (self-contained):** `did:midnight:offchain:<64-hex hash>:<base64url MOD1 state>`
  The resolver recomputes BLAKE2s-256 over the state and **rejects** the DID if the hash does not
  match — a long DID is self-verifying on receipt, no registry needed.
- **Short:** `did:midnight:offchain:<64-hex hash>`
  The state lives out-of-band; the hash pins it.

### Offchain state framing (`MOD1`)

A **fixed 45-chunk** binary frame, base64url-encoded (unpadded, RFC 4648 §5). Each chunk is a
`[length u32 BE][bytes]` pair; the whole thing is one magic + one chunk-count header followed by
the chunks, concatenated:

```
MAGIC "MOD1" (4 B) | chunkCount u32 BE (=45) |
  version u16 BE                                    (1 chunk)
  aka[0..3]                                         (4 chunks; empty = absent)
  vm[0..3] × { present u8, id, keyKind u8, x, y, mask u8 }   (4×6 = 24 chunks)
  svc[0..3] × { present u8, id, type, endpoint }             (4×4 = 16 chunks)
```

Total `1 + 4 + 24 + 16 = 45` chunks. `version` is always `1`. The `aka`, `vm`, and `svc` lists
are fixed-width (≤4) with empty slots for absent entries — there is no separate length byte per
field beyond the per-chunk length prefix. `keyKind`: `1` Jubjub · `2` Ed25519 · `3` P-256 · `4`
X25519 · `5` secp256k1 · `6` BLS12381G1 · `7` BLS12381G2. `mask` is the 5-bit W3C relationship
set (authentication, assertionMethod, keyAgreement, capabilityInvocation, capabilityDelegation).

### Ledger DIDs

`did:midnight:<network>:<64-hex contract id>` where `network ∈ {undeployed, devnet, testnet,
mainnet, preview, preprod}`. The contract state lives on-chain; this wallet encodes/parses the
DID string itself.

## Architecture

| File | Role |
| --- | --- |
| `src/blake2s.js` | Dependency-free pure-JS **BLAKE2s-256** (browsers don't ship it). Exported as `blake2s256Hex` + `blake2s256`. |
| `src/midnight-did.js` | The DID codec: `encodeState`, `decodeState`, `stateHash`, `makeOffchainDid`, `makeLedgerDid`, `parseDid`, `resolveDid`, `projectDocument`, plus base64url helpers and the curve/relationship tables. |
| `app.js` | UI logic — builds state from the form, mints long DIDs, projects the DID Document, and inspects pasted DIDs. |
| `test/did.test.mjs` | `node:test` suite (25 tests) anchored to the official spec test vector + Node-native BLAKE2s cross-checks. |
| `test/spec-vector.txt` | The exact 506-char base64url offchain-state payload from the spec, used as the pinned fixture. |

## Spec conformance

- `encodeState` reproduces the spec's example payload **byte-for-byte** (`3c08b857…fc21`).
- BLAKE2s-256 is cross-checked against Node's native `crypto` implementation across a full
  block-size sweep (0…4096 bytes × 24 seeds).
- Long-form DIDs are self-hashing: `parseDid` recomputes the state hash and throws on mismatch.

## Run the tests

```bash
node --test apps/midnight-did-wallet/test/did.test.mjs
```
