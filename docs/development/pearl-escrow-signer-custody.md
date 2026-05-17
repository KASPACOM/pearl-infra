# Pearl Escrow Signer And Custody Design

This document defines the signer, custody, and recovery model for the Pearl OTC
MVP. It covers `packages/pearl-escrow`, `services/otc-api`, and the future
settlement worker broadcast path.

## Scope

This design is for the current RFQ settlement desk implementation:

- OTC API creates one Pearl P2TR escrow package per accepted trade.
- OTC API derives escrow addresses from an xpub only.
- Settlement worker later asks a signer boundary to sign Pearl release/refund
  transactions.
- Pearl indexer and Base escrow state decide whether a release/refund is allowed.

This is not the final non-custodial 2-of-3 design in
[`escrow-multisig-on-pearl.md`](escrow-multisig-on-pearl.md). The current MVP
uses a coordinator-controlled Taproot key-path signer with strict policy gates.

## Current Implementation Facts

- `packages/pearl-escrow` creates P2TR packages and unsigned release/refund
  transactions.
- `services/otc-api` can use `PEARL_ESCROW_ALLOCATOR=p2tr_xpub` and
  `PEARL_ESCROW_XPUB` to derive one non-hardened child P2TR escrow address per
  trade.
- Mainnet package creation is blocked unless
  `PEARL_ESCROW_ALLOW_MAINNET=true`.
- Release/refund templates are metadata and unsigned transaction material.
  They do not by themselves enforce a covenant or script-path timelock.

## Custody Model

### MVP: Coordinator-Signed P2TR

The MVP custody model is a constrained coordinator signer:

- OTC API holds only an account xpub.
- Signer service holds or can access the matching account xprv through an
  operator-controlled secret boundary.
- Settlement worker cannot sign directly.
- Settlement worker can only request signatures by presenting a policy package
  whose trade, outpoint, destination, amount, fee, and deadlines match indexed
  state.

This means KaspaCom has signing capability for funded Pearl escrow outputs. The
protection is operational and software-policy based, not a fully non-custodial
script guarantee.

### Non-Custodial Upgrade Path

The upgrade path is a Taproot script/MuSig design:

- cooperative key-path spend through MuSig2 or FROST;
- script-path dispute leaves using `OP_CHECKSIGADD`;
- script-path timeout/refund leaves using CLTV or CSV;
- optional future OP_CAT constraints only after separate review.

That design remains a later milestone. The MVP must not market current xpub
escrow as non-custodial.

## Key Boundaries

### OTC API

Allowed:

- stores `PEARL_ESCROW_XPUB`;
- derives child public keys and P2TR escrow addresses;
- stores derivation path, internal pubkey, output script, templates, expected
  amount, deadlines, and watch metadata.

Forbidden:

- stores xprv, seed, WIF, mnemonic, or child private keys;
- signs transactions;
- broadcasts Pearl transactions;
- accepts frontend-provided transaction outputs as authoritative.

### Settlement Worker

Allowed:

- reads canonical trade state;
- reads Pearl indexer observations and spends;
- reads Base escrow contract state;
- constructs or loads unsigned release/refund tx packages;
- writes idempotent side-effect records;
- requests a signature from the signer boundary after all release/refund guards
  pass.

Forbidden:

- stores signing keys;
- bypasses the signer policy verifier;
- signs from environment variables;
- retries broadcast under a new idempotency key for the same trade/action.

### Signer Boundary

The signer boundary can be one of:

- a local signer service with an encrypted xprv loaded at boot;
- a remote signer service behind mTLS;
- a hardware/KMS-backed signer once Pearl Schnorr support is available there;
- a manual offline signer during early mainnet pilot.

Required behavior:

- accepts only policy packages, not arbitrary raw transactions;
- re-derives the child key from trade derivation metadata;
- verifies the transaction spends the expected outpoint;
- verifies every output address and amount against the intended release/refund
  package;
- verifies fee is under configured cap;
- verifies release/refund authorization state hash;
- signs at most once per `(tradeId, action, fundingOutpoint, txTemplateHash)`;
- returns a signed transaction hex plus a signer audit record.

## Derivation Policy

`PEARL_ESCROW_XPUB` enables non-hardened public child derivation:

```text
m / <PEARL_ESCROW_DERIVATION_PREFIX> / tradeIndex
```

Rules:

- `tradeIndex` is deterministically derived from `tradeId`.
- `PEARL_ESCROW_DERIVATION_PREFIX` must contain non-hardened indexes only.
- xpub is treated as sensitive operational metadata even though it is public-key
  material.
- child private keys must never be exported or persisted.
- signer derives child private keys in memory and zeroizes/lets process memory
  die after signing.

Risk:

- With BIP32 non-hardened derivation, leaking any child private key plus the
  account xpub can compromise the account private key.

Mitigation:

- never expose child private keys outside the signer;
- rotate to a fresh account xpub/xprv if any signer host is suspected
  compromised;
- keep xpub scoped to OTC escrow only, never reuse it for bridge reserve or
  treasury funds;
- migrate to signer-owned allocation API or script/MuSig design before larger
  mainnet limits.

## Release Authorization

The signer may sign a PRL release only when the settlement worker package proves
all of the following:

- trade is active and not terminal/manual-review;
- Pearl funding output matches expected script, outpoint, amount, and
  confirmations;
- Pearl funding was observed before `pearl_funding_deadline`;
- Base USDC escrow is still `Deposited`;
- Base deposit terms match backend trade terms;
- Base deposit was observed before `usdc_deposit_deadline`;
- neither leg is stale, detached, reorged, underpaid, overpaid, duplicated, or
  unknown;
- no USDC refund, PRL refund, PRL release, or successful previous release
  side-effect exists;
- current time is before `settlement_deadline`;
- fee is under the configured release fee cap.

Any failed check produces no signature and should move the trade to the relevant
manual-review/edge state.

## Refund Authorization

The signer may sign a PRL refund only when one of these paths is true:

- buyer never deposited USDC and `refund_available_at` has passed;
- Base escrow was refunded/cancelled and no PRL release happened;
- operator manually approves refund after failed release or dispute review.

The signer must still verify:

- refund destination is the stored seller Pearl refund address;
- funding outpoint matches the confirmed Pearl escrow observation;
- no PRL release tx is confirmed or pending under the same idempotency key;
- fee is under the configured refund fee cap.

If a buyer deposited USDC, the USDC escrow expired, the buyer refunded USDC, and
seller PRL arrives after expiry, the only valid Pearl action is seller refund or
manual review. Buyer PRL release is permanently disallowed for that trade.

## XMSS Policy

Pearl includes `OP_CHECKXMSSSIG`, and the upstream XMSS package exposes
stateful one-time signing behavior. The local upstream wrapper documents that
`msgUID` must be less than `XMSS_MaxSigns` and each UID can only be used once.

MVP policy:

- do not use XMSS for hot OTC escrow signing;
- do not use XMSS in automated release/refund transactions;
- do not store XMSS private material in OTC API, settlement worker, or signer
  service.

XMSS is allowed only for a later cold-storage/reserve design after a separate
security review. That design must include:

- a durable monotonic UID reservation table;
- write-ahead UID locking before signature generation;
- backup/restore procedure that cannot replay old UID state;
- operator runbook for exhausting or rotating XMSS keys;
- external review of the XMSS signing path.

## Recovery Package Storage

Every accepted trade should have a recovery package stored with the trade record
or adjacent object storage. It must contain only public or unsigned material.

Required fields:

- `tradeId`;
- Pearl network;
- escrow address;
- derivation path;
- internal pubkey hex;
- taproot output script hex;
- expected amount grains;
- required confirmations;
- release address and refund address;
- release/refund template hashes;
- latest unsigned release/refund tx hex;
- funding outpoint once observed;
- refund eligibility height/time;
- signer policy version;
- simnet verification version.

Forbidden fields:

- mnemonic;
- seed;
- xprv;
- WIF;
- child private key;
- raw signer credentials;
- API tokens.

Recovery use cases:

- rebuild unsigned transactions after service loss;
- prove what the signer was asked to sign;
- audit release/refund destination and fee;
- manually reconstruct a refund/release package with the offline signer.

## Signer Audit Record

Every signature attempt must append an immutable audit record:

```json
{
  "tradeId": "trade_...",
  "action": "release",
  "fundingOutpoint": "txid:vout",
  "txTemplateHash": "sha256:...",
  "policyVersion": "pearl-otc-signer-v1",
  "decisionEventId": "event_...",
  "idempotencyKey": "trade:release:...",
  "derivationPath": "m/0/123",
  "signerKeyId": "otc-pearl-warm-1",
  "signedTxid": "txid",
  "signedAt": "2026-05-17T00:00:00.000Z"
}
```

Do not log private keys, raw secrets, or full environment values. Signed tx hex
may be stored in the side-effect ledger because it is intended for broadcast.

## Operational Limits For Mainnet Pilot

Before enabling `PEARL_ESCROW_ALLOW_MAINNET=true`:

- signer must run in a separate process from OTC API;
- signer must have its own credential set and host/container boundary;
- all release/refund policy checks must be unit tested;
- dry-run signing must pass on simnet/testnet2;
- fee caps and min/max trade limits must be configured;
- emergency pause must disable signer requests and settlement-worker broadcasts;
- xpub/xprv pair must be scoped only to OTC pilot funds;
- hot signer balance exposure must stay under the approved pilot cap.

## Next Implementation Hooks

`9.7.5` should implement:

- signer request/response types;
- policy package hash;
- signer audit record type;
- side-effect idempotency keys for Pearl release/refund;
- broadcast retry envelope;
- fee cap validation;
- emergency-pause checks.
