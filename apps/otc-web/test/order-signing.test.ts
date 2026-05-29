import assert from 'node:assert/strict';
import test from 'node:test';

import { Psbt, initEccLib } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import {
  InMemoryPearlWalletStorage,
  deriveOrderKeyFromMnemonic,
  pearlMnemonicToSeed,
} from '@kaspacom/pearl-wallet';
import { createPearlP2trPrefundEscrowPayment, getPearlScriptNetwork } from '@kaspacom/pearl-script';

import { PearlWalletSession } from '../src/wallet/wallet-session.ts';
import {
  signAndSubmitOrderSpend,
  type OrderSigningClient,
  type PreparedPearlSpendResponse,
  type SubmitSignedSpendRequest,
  type SubmitSignedSpendResponse,
} from '../src/wallet/order-signing.ts';

const FIXED_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FAST_KDF = { algorithm: 'argon2id' as const, memoryKb: 8192, iterations: 1, parallelism: 1, outputBytes: 32 };

const FUNDING_TXID = 'aa'.repeat(32);
const FUNDING_AMOUNT = 100_000_000;
const REFUND_LOCK_UNIX = 1_780_000_000;
const FEE = 10_000;

test.before(() => {
  initEccLib(ecc);
});

interface BuiltPrepared {
  prepared: PreparedPearlSpendResponse;
  derivationIndex: number;
}

/**
 * Builds a realistic Mode B refund prepared payload for derivation index 1
 * (the first order key — index 0 is identity per W8).
 */
function buildRefundPrepared(): BuiltPrepared {
  const derivationIndex = 1;
  const seed = pearlMnemonicToSeed(FIXED_MNEMONIC);
  const derived = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, derivationIndex);
  const operatorPriv = Buffer.from('03'.padStart(64, '0'), 'hex');
  const operatorPub = ecc.pointFromScalar(operatorPriv, true)!;
  const arbiterPriv = Buffer.from('04'.padStart(64, '0'), 'hex');
  const arbiterPub = ecc.pointFromScalar(arbiterPriv, true)!;

  const payment = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'auto_sweep',
    makerPubkey: derived.pubkey,
    operatorPubkey: Buffer.from(operatorPub).subarray(1),
    arbiterPubkey: Buffer.from(arbiterPub).subarray(1),
    refundLockTime: REFUND_LOCK_UNIX,
  });
  const refundLeaf = payment.leaves.find((l) => l.kind === 'maker_timeout_refund')!;

  const psbt = new Psbt({ network: getPearlScriptNetwork('simnet') });
  psbt.setVersion(2);
  psbt.setLocktime(REFUND_LOCK_UNIX);
  psbt.addInput({
    hash: FUNDING_TXID,
    index: 0,
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
  psbt.addOutput({ address: payment.address, value: FUNDING_AMOUNT - FEE });

  return {
    derivationIndex,
    prepared: {
      psbtBase64: psbt.toBase64(),
      leaf: refundLeaf,
      network: 'simnet',
      derivationIndex,
      contract: {
        expectedInputOutpoint: `${FUNDING_TXID}:0`,
        expectedInputAmountGrains: FUNDING_AMOUNT,
        expectedOutputs: [{ address: payment.address, amountGrains: FUNDING_AMOUNT - FEE }],
        feeCapGrains: FEE * 2,
      },
    },
  };
}

class StubClient implements OrderSigningClient {
  readonly sweepSubmits: Array<{ orderId: string; req: SubmitSignedSpendRequest }> = [];
  readonly refundSubmits: Array<{ orderId: string; req: SubmitSignedSpendRequest }> = [];
  private readonly response: SubmitSignedSpendResponse;
  constructor(response: SubmitSignedSpendResponse) {
    this.response = response;
  }
  async getSweepPsbt(): Promise<PreparedPearlSpendResponse> {
    throw new Error('not used in this test');
  }
  async submitSignedSweep(orderId: string, req: SubmitSignedSpendRequest): Promise<SubmitSignedSpendResponse> {
    this.sweepSubmits.push({ orderId, req });
    return this.response;
  }
  async getRefundPsbt(): Promise<PreparedPearlSpendResponse> {
    throw new Error('not used in this test');
  }
  async submitSignedRefund(orderId: string, req: SubmitSignedSpendRequest): Promise<SubmitSignedSpendResponse> {
    this.refundSubmits.push({ orderId, req });
    return this.response;
  }
}

// ---------- happy paths ----------

test('signAndSubmitOrderSpend (sweep) signs locally and POSTs to submitSignedSweep', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const { prepared } = buildRefundPrepared();
  const client = new StubClient({ status: 'broadcast', pearlTxid: 'tx-deadbeef' });
  const result = await signAndSubmitOrderSpend({
    orderId: 'order-1',
    prepared,
    session,
    client,
    kind: 'sweep',
  });
  assert.equal(result.status, 'broadcast');
  assert.equal(result.pearlTxid, 'tx-deadbeef');
  assert.equal(client.sweepSubmits.length, 1);
  assert.equal(client.refundSubmits.length, 0);
  // The submitted PSBT contains the maker's signature.
  const signedPsbt = Psbt.fromBase64(client.sweepSubmits[0]!.req.signedPsbtBase64);
  assert.equal(signedPsbt.data.inputs[0]?.tapScriptSig?.length ?? 0, 1);
  session.lock();
});

test('signAndSubmitOrderSpend (refund) POSTs to submitSignedRefund', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const { prepared } = buildRefundPrepared();
  const client = new StubClient({ status: 'broadcast', pearlTxid: 'tx-refund' });
  const result = await signAndSubmitOrderSpend({
    orderId: 'order-1',
    prepared,
    session,
    client,
    kind: 'refund',
  });
  assert.equal(result.pearlTxid, 'tx-refund');
  assert.equal(client.refundSubmits.length, 1);
  assert.equal(client.sweepSubmits.length, 0);
  session.lock();
});

// ---------- failure paths ----------

test('signAndSubmitOrderSpend rejects without ever posting if the contract mismatches the PSBT', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const { prepared } = buildRefundPrepared();
  const client = new StubClient({ status: 'broadcast' });
  // Pretend the server tried to trick us: the contract says we're sending
  // to attacker_addr but the PSBT actually sends to payment.address.
  const tampered: PreparedPearlSpendResponse = {
    ...prepared,
    contract: {
      ...prepared.contract,
      expectedOutputs: [{ address: 'tprl1pattacker', amountGrains: prepared.contract.expectedOutputs[0]!.amountGrains }],
    },
  };
  await assert.rejects(
    () => signAndSubmitOrderSpend({ orderId: 'order-1', prepared: tampered, session, client, kind: 'sweep' }),
    /output 0 address mismatch/,
  );
  // The client was never called.
  assert.equal(client.sweepSubmits.length, 0);
  assert.equal(client.refundSubmits.length, 0);
  session.lock();
});

test('signAndSubmitOrderSpend throws if the session is locked', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  session.lock();
  const { prepared } = buildRefundPrepared();
  const client = new StubClient({ status: 'broadcast' });
  await assert.rejects(
    () => signAndSubmitOrderSpend({ orderId: 'order-1', prepared, session, client, kind: 'sweep' }),
    /locked/,
  );
});

test('signAndSubmitOrderSpend uses the correct derivation index from the prepared payload', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const { prepared, derivationIndex } = buildRefundPrepared();
  assert.equal(derivationIndex, 1); // index 0 reserved for identity
  const client = new StubClient({ status: 'broadcast' });
  await signAndSubmitOrderSpend({ orderId: 'o', prepared, session, client, kind: 'sweep' });
  // Verify the signature is from the index-1 key, not index-0 (identity).
  const signedPsbt = Psbt.fromBase64(client.sweepSubmits[0]!.req.signedPsbtBase64);
  const tapScriptSig = signedPsbt.data.inputs[0]?.tapScriptSig?.[0];
  const expectedPubkey = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, 1).pubkey;
  assert.deepEqual(Uint8Array.from(tapScriptSig!.pubkey), expectedPubkey);
  session.lock();
});
