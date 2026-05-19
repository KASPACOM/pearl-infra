# Pearl Multisig Simnet Evidence - 2026-05-19

Purpose: prove the repo can construct Pearl simnet P2TR escrow outputs with
2-of-3 buyer/seller/arbiter script-path custody metadata. This closes the
address/package-construction slice only; it does not yet prove a funded simnet
spend.

## What Was Added

- `packages/pearl-script` now builds a P2TR escrow payment with four Taproot
  leaves:
  - `buyer_seller_release`;
  - `buyer_arbiter_release`;
  - `seller_arbiter_release`;
  - `seller_timeout_refund`.
- `packages/pearl-escrow` now exposes
  `createPearlMultisigEscrowPackage(...)`, which returns a normal escrow
  package with script-path signing policies and Taproot leaf metadata.

## Simnet Fixture Output

Generated with fixed test public keys:

```json
{
  "escrowAddress": "rprl1px4a5rvnnfdv8ca8wc52vqhf7m2ss6rw6z6hja5r3y72g0fw0yzrqg8p7w8",
  "outputScriptHex": "5120357b41b2734b587c74eec514c05d3edaa10d0dda16af2ed071279487a5cf2086",
  "releasePolicy": {
    "path": "taproot_script_path",
    "requiredSigners": ["buyer", "seller"]
  },
  "refundPolicy": {
    "path": "taproot_script_path",
    "requiredSigners": ["seller"],
    "timelockSatisfied": false
  },
  "leaves": [
    { "kind": "buyer_seller_release", "requiredSigners": ["buyer", "seller"] },
    { "kind": "buyer_arbiter_release", "requiredSigners": ["buyer", "arbiter"] },
    { "kind": "seller_arbiter_release", "requiredSigners": ["seller", "arbiter"] },
    { "kind": "seller_timeout_refund", "requiredSigners": ["seller"], "lockTime": 144 }
  ]
}
```

## Verification

```bash
npm run typecheck
node --test packages/pearl-script/test/p2tr-multisig.test.ts
node --test packages/pearl-escrow/test/escrow-package.test.ts
npm test
```

Result:

- focused `pearl-script` simnet multisig test: pass;
- focused `pearl-escrow` package test: pass;
- full repo suite: pass, 241 passing and 2 optional live tests skipped.

## Still Needed

- Fund the generated multisig escrow address on writable Pearl simnet.
- Produce and sign a script-path release spend.
- Produce and sign the timeout refund path.
- Register the generated address with the Pearl indexer and prove funding/spend
  classification through the watched-address API.
- Decide whether the first low-cap mainnet OTC pilot uses this 2-of-3 script
  path or the existing coordinator-signed P2TR path.
