# Pearl Escrow Package

Typed package for constructing Pearl OTC escrow packages.

Current scope:

- creates Pearl P2TR escrow addresses from a provided internal public key;
- creates Pearl 2-of-3 buyer/seller/arbiter P2TR escrow packages with a BIP341
  NUMS internal key for script-path-only custody;
- builds release and refund transaction templates with expected funding amount, optional funding outpoint, signer policy, and refund eligibility;
- validates release/refund destination addresses against the Pearl network;
- creates signer policy requests, fee-cap checks, idempotency keys, and broadcast retry records;
- provides a signer boundary that verifies template hashes, destination/output policy, signer key custody policy, persistent request state, append-only audit records, and retry-safe signing requests;
- blocks mainnet package creation unless `allowMainnet` is explicitly set.

This package does not hold private keys, sign transactions, or broadcast transactions. `PearlSignerBoundary` calls a signer client that signs only and returns signed transaction material; broadcasting stays outside the signer boundary and uses the Pearl RPC package.

## Usage

```ts
import { createPearlEscrowPackage } from '@kaspacom/pearl-escrow';

const escrow = createPearlEscrowPackage({
  tradeId: 'trade_123',
  network: 'testnet2',
  internalPubkey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  expectedAmountGrains: '100000000000',
  requiredConfirmations: 6,
  releaseAddress: 'tprl1...',
  refundAddress: 'tprl1...',
  refundEligibleAfterHeight: 120,
});
```

For `createPearlEscrowPackage`, the caller is responsible for generating and storing the internal key material. Do not use deployer, operator, or user private keys directly in this package. `createPearlMultisigEscrowPackage` does not accept caller-provided internal keys; it uses a BIP341 NUMS internal key so the policy is enforced through the Taproot script leaves.
