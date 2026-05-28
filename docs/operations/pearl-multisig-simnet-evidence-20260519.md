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
- The multisig builder uses the BIP341 NUMS internal key and rejects
  caller-provided internal keys, so the escrow does not expose a known
  Taproot key-path bypass around the script leaves.
- The builder rejects invalid secp256k1 signer keys and duplicate role keys
  that would collapse 2-of-3 custody into a weaker policy.

## Simnet Fixture Output

Generated with fixed test public keys:

```json
{
  "escrowAddress": "rprl1pzr22mk3dcfcqh0k8vx47jy0k9al4th8ser5eqcp4332s8lw67uqs7g2c42",
  "internalPubkeyHex": "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0",
  "internalKeyPolicy": "bip341_nums_script_path_only",
  "outputScriptHex": "512010d4adda2dc2700bbec761abe911f62f7f55dcf0c8e99060358c5503fddaf701",
  "releasePolicy": {
    "path": "taproot_script_path",
    "requiredSigners": ["buyer", "seller"],
    "alternativeSignerSets": [["buyer", "arbiter"], ["seller", "arbiter"]]
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

- focused `pearl-script` and `pearl-escrow` simnet multisig tests: pass;
- full repo suite: pass, 246 passing and 2 optional live tests skipped.

## Still Needed

- Funded release/refund proof is now recorded in
  `docs/operations/pearl-multisig-funded-simnet-evidence-20260519.md`.
- Decide whether the first low-cap mainnet OTC pilot uses this 2-of-3 script
  path or the existing coordinator-signed P2TR path.
