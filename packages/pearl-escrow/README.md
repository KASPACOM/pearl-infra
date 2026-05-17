# Pearl Escrow Package

Typed package for constructing Pearl OTC escrow packages.

Current scope:

- creates Pearl P2TR escrow addresses from a provided internal public key;
- builds release and refund transaction templates with expected funding amount, optional funding outpoint, signer policy, and refund eligibility;
- validates release/refund destination addresses against the Pearl network;
- blocks mainnet package creation unless `allowMainnet` is explicitly set.

This package does not yet sign or broadcast transactions. Signing, XMSS policy, simnet transaction fixtures, and settlement-worker broadcast hooks are tracked separately in `9.7.3` through `9.7.5`.

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

The caller is responsible for generating and storing the internal key material. Do not use deployer, operator, or user private keys directly in this package.
