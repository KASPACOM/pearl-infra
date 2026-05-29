import assert from 'node:assert/strict';
import test from 'node:test';

import { initEccLib, Psbt } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { createPearlP2trPrefundEscrowPayment, getPearlScriptNetwork } from '@kaspacom/pearl-script';

import {
  deriveOrderKey,
  pearlAddressFromXOnlyPubkey,
  pearlMnemonicToSeed,
  validateAndSignPearlPrefundPsbt,
} from '../dist/index.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Synthetic deterministic keys used across tests so we control the address.
const xPriv = (seed: string) => Buffer.from(seed.padStart(64, '0'), 'hex');
const xOnly = (priv: Buffer) => {
  const p = ecc.pointFromScalar(priv, true);
  if (!p) throw new Error('bad priv');
  return Buffer.from(p).subarray(1);
};

const FUNDING_TXID = 'aa'.repeat(32);
const FUNDING_VOUT = 0;
const FUNDING_AMOUNT = 100_000_000;
const REFUND_LOCK_UNIX = 1_780_000_000;
const FEE = 10_000;

test.before(() => {
  initEccLib(ecc);
});

interface BuildPsbtOptions {
  network?: 'simnet' | 'testnet2';
  inputOutpointTxid?: string;
  inputOutpointVout?: number;
  outputAddress?: string;
  outputAmount?: number;
  swapLeafScript?: boolean;
  extraInput?: boolean;
  extraOutput?: boolean;
}

interface Built {
  payment: ReturnType<typeof createPearlP2trPrefundEscrowPayment>;
  makerPriv: Buffer;
  psbtBase64: string;
}

/**
 * Build a real prefund-spend PSBT signed by the maker through the
 * maker_timeout_refund leaf (Mode A or B both have this leaf so the test
 * fixture is mode-agnostic). The maker's key is the wallet-derived one at
 * index 0.
 */
function buildPrefundSpendPsbt(opts: BuildPsbtOptions = {}): Built {
  const network = opts.network ?? 'simnet';
  const seed = pearlMnemonicToSeed(MNEMONIC);
  const derived = deriveOrderKey(seed, 0);
  const makerPriv = Buffer.from(derived.privkey);
  const operatorPriv = xPriv('03');
  const arbiterPriv = xPriv('04');

  const payment = createPearlP2trPrefundEscrowPayment({
    network,
    mode: 'auto_sweep',
    makerPubkey: derived.pubkey,
    operatorPubkey: xOnly(operatorPriv),
    arbiterPubkey: xOnly(arbiterPriv),
    refundLockTime: REFUND_LOCK_UNIX,
  });
  // Pick the maker_timeout_refund leaf — the maker can sign it solo.
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  // Optionally swap the leaf script to simulate a server tampering attack.
  const psbtLeaf = opts.swapLeafScript
    ? payment.leaves.find((l) => l.kind === 'operator_arbiter_sweep')!
    : refundLeaf;

  const psbt = new Psbt({ network: networkObj(network) });
  psbt.setVersion(2);
  psbt.setLocktime(REFUND_LOCK_UNIX); // required for OP_CHECKLOCKTIMEVERIFY satisfaction

  psbt.addInput({
    hash: opts.inputOutpointTxid ?? FUNDING_TXID,
    index: opts.inputOutpointVout ?? FUNDING_VOUT,
    sequence: 0xfffffffe, // not max, so locktime is honoured
    witnessUtxo: {
      script: Buffer.from(payment.outputScriptHex, 'hex'),
      value: FUNDING_AMOUNT,
    },
    tapInternalKey: Buffer.from(payment.internalPubkeyHex, 'hex'),
    tapLeafScript: [
      {
        leafVersion: psbtLeaf.leafVersion,
        script: Buffer.from(psbtLeaf.scriptHex, 'hex'),
        controlBlock: Buffer.from(psbtLeaf.controlBlockHex, 'hex'),
      },
    ],
  });
  if (opts.extraInput) {
    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 1,
      sequence: 0xfffffffe,
      witnessUtxo: { script: Buffer.from(payment.outputScriptHex, 'hex'), value: 1_000_000 },
      tapInternalKey: Buffer.from(payment.internalPubkeyHex, 'hex'),
      tapLeafScript: [
        {
          leafVersion: refundLeaf.leafVersion,
          script: Buffer.from(refundLeaf.scriptHex, 'hex'),
          controlBlock: Buffer.from(refundLeaf.controlBlockHex, 'hex'),
        },
      ],
    });
  }
  psbt.addOutput({
    address: opts.outputAddress ?? payment.address,
    value: opts.outputAmount ?? FUNDING_AMOUNT - FEE,
  });
  if (opts.extraOutput) {
    psbt.addOutput({ address: payment.address, value: 1000 });
  }
  return { payment, makerPriv, psbtBase64: psbt.toBase64() };
}

function networkObj(name: 'simnet' | 'testnet2') {
  return getPearlScriptNetwork(name);
}

// ---------- happy path ----------

test('validateAndSignPearlPrefundPsbt signs a structurally-valid prefund spend', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  const result = validateAndSignPearlPrefundPsbt({
    psbtBase64,
    leaf: refundLeaf,
    privkey: Uint8Array.from(makerPriv),
    network: 'simnet',
    contract: {
      expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
      expectedInputAmountGrains: FUNDING_AMOUNT,
      expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
      feeCapGrains: FEE * 2,
    },
  });
  assert.match(result.signedPsbtBase64, /^[A-Za-z0-9+/=]+$/);
  // The signature should now be present in the PSBT input.
  const signed = Psbt.fromBase64(result.signedPsbtBase64);
  const tapScriptSigs = signed.data.inputs[0]?.tapScriptSig ?? [];
  assert.equal(tapScriptSigs.length, 1, 'expected exactly one script-path signature');
  // Returned x-only pubkey matches the maker's wallet-derived pubkey.
  const seed = pearlMnemonicToSeed(MNEMONIC);
  const derived = deriveOrderKey(seed, 0);
  assert.deepEqual(result.signedXOnlyPubkey, derived.pubkey);
});

// ---------- input validation ----------

test('rejects multi-input PSBTs', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt({ extraInput: true });
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /exactly 1 input, got 2/,
  );
});

test('rejects input outpoint mismatch', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${'cc'.repeat(32)}:0`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /input outpoint mismatch/,
  );
});

test('rejects input amount mismatch', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT - 1,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /input amount mismatch/,
  );
});

// ---------- output validation ----------

test('rejects output count mismatch', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt({ extraOutput: true });
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /exactly 1 outputs, got 2/,
  );
});

test('rejects output address mismatch (the load-bearing diversion-attack check)', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  // PSBT actually pays to payment.address; contract expects a different
  // attacker address. We should reject before signing.
  // Use any valid simnet address that differs from payment.address.
  const attackerAddress = buildPrefundSpendPsbt({ outputAddress: payment.address }).payment.address;
  // Sanity: same key derivation will produce the same address; cook up a
  // different one by changing mnemonic-index of an unrelated key.
  const otherSeed = pearlMnemonicToSeed(MNEMONIC);
  const otherDerived = deriveOrderKey(otherSeed, 7);
  const trulyDifferent: string = pearlAddressFromXOnlyPubkey(otherDerived.pubkey, 'simnet');
  assert.notEqual(trulyDifferent, attackerAddress);
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: trulyDifferent, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /output 0 address mismatch/,
  );
});

test('rejects output amount mismatch', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE - 1 }],
          feeCapGrains: FEE * 2,
        },
      }),
    /output 0 amount mismatch/,
  );
});

// ---------- fee validation ----------

test('rejects PSBTs where the implied fee exceeds the cap', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE - 1, // cap below actual fee
        },
      }),
    /fee 10000 exceeds cap 9999/,
  );
});

test('rejects negative implied fee (outputs exceed input)', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt({
    outputAmount: FUNDING_AMOUNT + 100, // overspend
  });
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT + 100 }],
          feeCapGrains: FEE * 2,
        },
      }),
    /fee would be -100 grains/,
  );
});

// ---------- leaf validation ----------

test('rejects PSBTs whose tapLeafScript does not match the expected leaf (anti-tamper)', () => {
  const { payment, makerPriv, psbtBase64 } = buildPrefundSpendPsbt({ swapLeafScript: true });
  // Caller claims they're signing maker_timeout_refund, but the PSBT actually
  // tries to spend through operator_arbiter_sweep. This is exactly the L-PR-3
  // attack: server hands the maker a PSBT that says "you're refunding" but
  // is actually routed through a different leaf.
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: Uint8Array.from(makerPriv),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /script does not match the expected leaf/,
  );
});

// ---------- privkey validation ----------

test('rejects wrong-sized privkeys', () => {
  const { payment, psbtBase64 } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  assert.throws(
    () =>
      validateAndSignPearlPrefundPsbt({
        psbtBase64,
        leaf: refundLeaf,
        privkey: new Uint8Array(4),
        network: 'simnet',
        contract: {
          expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
          expectedInputAmountGrains: FUNDING_AMOUNT,
          expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
          feeCapGrains: FEE * 2,
        },
      }),
    /privkey must be 32 bytes/,
  );
});

// ---------- two-output (sweep) flow ----------

test('happy path with two outputs (sweep + change to prefund)', () => {
  const { payment, makerPriv } = buildPrefundSpendPsbt();
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;
  const sweepAmount = 60_000_000;
  const changeAmount = FUNDING_AMOUNT - sweepAmount - FEE;
  const psbt = new Psbt({ network: networkObj('simnet') });
  psbt.setVersion(2);
  psbt.setLocktime(REFUND_LOCK_UNIX);
  psbt.addInput({
    hash: FUNDING_TXID,
    index: FUNDING_VOUT,
    sequence: 0xfffffffe,
    witnessUtxo: {
      script: Buffer.from(payment.outputScriptHex, 'hex'),
      value: FUNDING_AMOUNT,
    },
    tapInternalKey: Buffer.from(payment.internalPubkeyHex, 'hex'),
    tapLeafScript: [
      {
        leafVersion: refundLeaf.leafVersion,
        script: Buffer.from(refundLeaf.scriptHex, 'hex'),
        controlBlock: Buffer.from(refundLeaf.controlBlockHex, 'hex'),
      },
    ],
  });
  // Output 0: sweep destination (we just reuse the prefund address as a stand-in).
  psbt.addOutput({ address: payment.address, value: sweepAmount });
  // Output 1: change back to prefund.
  psbt.addOutput({ address: payment.address, value: changeAmount });

  const result = validateAndSignPearlPrefundPsbt({
    psbtBase64: psbt.toBase64(),
    leaf: refundLeaf,
    privkey: Uint8Array.from(makerPriv),
    network: 'simnet',
    contract: {
      expectedInputOutpoint: `${FUNDING_TXID}:${FUNDING_VOUT}`,
      expectedInputAmountGrains: FUNDING_AMOUNT,
      expectedOutputs: [
        { address: payment.address, amountGrains: sweepAmount },
        { address: payment.address, amountGrains: changeAmount },
      ],
      feeCapGrains: FEE * 2,
    },
  });
  const signed = Psbt.fromBase64(result.signedPsbtBase64);
  assert.equal(signed.data.inputs[0]?.tapScriptSig?.length ?? 0, 1);
});
