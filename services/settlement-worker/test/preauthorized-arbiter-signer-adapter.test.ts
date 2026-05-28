import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  buildPartialPearlEscrowScriptPathPsbt,
  createPearlMultisigEscrowPackage,
  createScriptPathSigner,
  type PearlEscrowPackage,
} from '@kaspacom/pearl-escrow';
import { createPearlP2trPayment } from '@kaspacom/pearl-script';
import { initEccLib } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { OtcTrade } from '@kaspacom/pearl-sdk';

import {
  InMemoryPearlEscrowBroadcastAttemptRepository,
  PreauthorizedArbiterSignerAdapter,
  type SettlementDecisionRecord,
} from '../dist/index.js';

initEccLib(ecc);

interface RoleKey {
  privateKey: Buffer;
  xOnlyHex: string;
}

function randomRoleKey(): RoleKey {
  let privateKey: Buffer;
  do {
    privateKey = randomBytes(32);
  } while (!ecc.isPrivate(privateKey));
  const pub = ecc.pointFromScalar(privateKey, true)!;
  return { privateKey, xOnlyHex: Buffer.from(pub).subarray(1).toString('hex') };
}

function randomP2trAddress(): string {
  return createPearlP2trPayment({
    network: 'simnet',
    internalPubkey: randomRoleKey().xOnlyHex,
  }).address;
}

interface Fixture {
  trade: OtcTrade;
  escrow: PearlEscrowPackage;
  buyer: RoleKey;
  seller: RoleKey;
  arbiter: RoleKey;
  buyerSignedPsbtBase64: string;
  fundingTxid: string;
  buyerDestination: string;
}

function buildFixture(): Fixture {
  const buyer = randomRoleKey();
  const seller = randomRoleKey();
  const arbiter = randomRoleKey();
  const buyerDestination = randomP2trAddress();
  const sellerRefund = randomP2trAddress();
  const expectedAmount = 175_000_000;
  const fee = 10_000;
  const fundingTxid = randomBytes(32).toString('hex');

  const escrow = createPearlMultisigEscrowPackage({
    tradeId: 'trade-preauth-arbiter-1',
    network: 'simnet',
    buyerPubkey: buyer.xOnlyHex,
    sellerPubkey: seller.xOnlyHex,
    arbiterPubkey: arbiter.xOnlyHex,
    refundEligibleAfterHeight: 900_000,
    expectedAmountGrains: String(expectedAmount),
    requiredConfirmations: 1,
    releaseAddress: buyerDestination,
    refundAddress: sellerRefund,
    fundingOutpoint: `${fundingTxid}:0`,
    createdAt: '2026-05-28T00:00:00.000Z',
  });

  const buyerPartial = buildPartialPearlEscrowScriptPathPsbt({
    escrow,
    leafKind: 'buyer_arbiter_release',
    fundingTxid,
    vout: 0,
    amountGrains: expectedAmount,
    destinationAddress: buyerDestination,
    destinationAmountGrains: expectedAmount - fee,
    signers: [createScriptPathSigner(buyer.privateKey)],
  });

  const trade: OtcTrade = {
    tradeId: 'trade-preauth-arbiter-1',
    quoteId: 'quote-preauth-arbiter-1',
    state: 'usdc_escrow_confirmed',
    side: 'buy_prl',
    amountPrl: '1.75000000',
    amountUsdc: '0.297500',
    feePrl: '0.00010000',
    feeUsdc: '0.000000',
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode: 'preauthorize_release',
    buyerPearlAddress: buyerDestination,
    buyerUsdcAddress: '0x1111111111111111111111111111111111111111',
    sellerPearlRefundAddress: sellerRefund,
    sellerUsdcReceiveAddress: '0x2222222222222222222222222222222222222222',
    buyerPearlPubkey: buyer.xOnlyHex,
    sellerPearlPubkey: seller.xOnlyHex,
    pearlEscrow: {
      network: 'simnet',
      address: escrow.escrowAddress,
      expectedAmountGrains: String(expectedAmount),
      requiredConfirmations: 1,
      escrowScriptType: 'p2tr',
      internalPubkeyHex: escrow.keys.internalPubkeyHex,
      taprootOutputScriptHex: escrow.keys.taprootOutputScriptHex,
      fundingOutpoint: `${fundingTxid}:0`,
      signerPubkeys: escrow.keys.signerPubkeys,
      taprootScriptLeaves: escrow.keys.taprootScriptLeaves as OtcTrade['pearlEscrow']['taprootScriptLeaves'],
      buyerReleasePresignature: {
        psbtBase64: buyerPartial.psbtBase64,
        buyerPubkey: buyer.xOnlyHex,
        leafKind: 'buyer_arbiter_release',
        destinationAddress: buyerDestination,
        outputAmountGrains: String(expectedAmount - fee),
        feeGrains: String(fee),
        fundingOutpoint: `${fundingTxid}:0`,
        signedAt: '2026-05-28T11:30:00.000Z',
      },
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: '0x3333333333333333333333333333333333333333',
      usdcToken: '0x4444444444444444444444444444444444444444',
      tradeKey: '0x' + '55'.repeat(32),
      expectedAmountMicros: '297500',
      requiredConfirmations: 12,
      expiresAt: '2026-05-28T13:30:00.000Z',
    },
    deadlines: {
      quoteExpiresAt: '2026-05-28T12:00:00.000Z',
      pearlFundingDeadline: '2026-05-28T13:00:00.000Z',
      usdcDepositDeadline: '2026-05-28T13:30:00.000Z',
      settlementDeadline: '2026-05-28T15:00:00.000Z',
      refundAvailableAt: '2026-05-28T14:00:00.000Z',
    },
    createdAt: '2026-05-28T11:00:00.000Z',
    updatedAt: '2026-05-28T12:00:00.000Z',
  };

  return { trade, escrow, buyer, seller, arbiter, buyerSignedPsbtBase64: buyerPartial.psbtBase64, fundingTxid, buyerDestination };
}

function decisionRecord(tradeId: string): SettlementDecisionRecord {
  return {
    decisionId: `decision-${tradeId}`,
    action: 'prepare_prl_release',
    idempotencyKey: `dec:${tradeId}`,
    reason: 'both Pearl and Base legs are funded',
    snapshotHash: 'hash',
    sourceEventIds: ['pearl:event', 'base:event'],
    toState: 'release_pending',
    createdAt: '2026-05-28T12:30:00.000Z',
    metadata: {
      tradeState: 'usdc_escrow_confirmed',
      pearlStatus: 'confirmed',
      pearlConfirmations: 6,
      baseStatus: 'deposited',
      baseConfirmations: 12,
    },
  };
}

test('PreauthorizedArbiterSignerAdapter combines buyer presig + arbiter sig and records a signed broadcast attempt', async () => {
  const fixture = buildFixture();
  const repo = new InMemoryPearlEscrowBroadcastAttemptRepository();
  const adapter = new PreauthorizedArbiterSignerAdapter({
    arbiterSigner: createScriptPathSigner(fixture.arbiter.privateKey),
    broadcastAttempts: repo,
    refreshTrade: async () => fixture.trade,
    signerKeyId: 'arbiter-dev',
    now: () => new Date('2026-05-28T12:31:00.000Z'),
  });
  const prepared = await adapter.preparePrlRelease(fixture.trade, decisionRecord(fixture.trade.tradeId));
  assert.equal(prepared.status, 'prepared');
  assert.equal(prepared.metadata.adapter, 'preauthorized_arbiter');
  assert.equal(prepared.metadata.broadcastAttemptStatus, 'signed');
  assert.equal(prepared.metadata.broadcastAttemptCreated, true);
  const attempts = await repo.listBroadcastAttempts();
  assert.equal(attempts.length, 1);
  assert.ok(attempts[0]!.signedTxHex && attempts[0]!.signedTxHex.length > 0);
  assert.equal(attempts[0]!.signedTxid, prepared.metadata.signedTxid);
});

test('PreauthorizedArbiterSignerAdapter defers if the trade revoked the presig between decision and signing (L9)', async () => {
  const fixture = buildFixture();
  const revokedTrade: OtcTrade = {
    ...fixture.trade,
    pearlEscrow: {
      ...fixture.trade.pearlEscrow,
      buyerReleasePresignature: {
        ...fixture.trade.pearlEscrow.buyerReleasePresignature!,
        revokedAt: '2026-05-28T12:29:00.000Z',
      },
    },
  };
  const repo = new InMemoryPearlEscrowBroadcastAttemptRepository();
  const adapter = new PreauthorizedArbiterSignerAdapter({
    arbiterSigner: createScriptPathSigner(fixture.arbiter.privateKey),
    broadcastAttempts: repo,
    refreshTrade: async () => revokedTrade,
    signerKeyId: 'arbiter-dev',
    now: () => new Date('2026-05-28T12:31:00.000Z'),
  });
  const prepared = await adapter.preparePrlRelease(fixture.trade, decisionRecord(fixture.trade.tradeId));
  assert.equal(prepared.metadata.skipReason, 'buyer_presignature_missing_or_revoked');
  assert.equal(prepared.metadata.deferredToOperator, true);
  const attempts = await repo.listBroadcastAttempts();
  assert.equal(attempts.length, 0);
});

test('PreauthorizedArbiterSignerAdapter defers for non-multisig trades instead of crashing the loop (L-AUDIT-4)', async () => {
  const fixture = buildFixture();
  const coordinatorTrade: OtcTrade = {
    ...fixture.trade,
    pearlEscrowMode: 'coordinator',
    pearlReleaseSigningMode: 'manual_after_base_deposit',
  };
  const repo = new InMemoryPearlEscrowBroadcastAttemptRepository();
  const adapter = new PreauthorizedArbiterSignerAdapter({
    arbiterSigner: createScriptPathSigner(fixture.arbiter.privateKey),
    broadcastAttempts: repo,
    refreshTrade: async () => coordinatorTrade,
    signerKeyId: 'arbiter-dev',
    now: () => new Date('2026-05-28T12:31:00.000Z'),
  });
  const prepared = await adapter.preparePrlRelease(coordinatorTrade, decisionRecord(coordinatorTrade.tradeId));
  assert.equal(prepared.metadata.skipReason, 'not_multisig_escrow');
  const attempts = await repo.listBroadcastAttempts();
  assert.equal(attempts.length, 0);
});

test('PreauthorizedArbiterSignerAdapter is idempotent — repeated calls return the existing broadcast attempt', async () => {
  const fixture = buildFixture();
  const repo = new InMemoryPearlEscrowBroadcastAttemptRepository();
  const adapter = new PreauthorizedArbiterSignerAdapter({
    arbiterSigner: createScriptPathSigner(fixture.arbiter.privateKey),
    broadcastAttempts: repo,
    refreshTrade: async () => fixture.trade,
    signerKeyId: 'arbiter-dev',
    now: () => new Date('2026-05-28T12:31:00.000Z'),
  });
  const decision = decisionRecord(fixture.trade.tradeId);
  const first = await adapter.preparePrlRelease(fixture.trade, decision);
  const second = await adapter.preparePrlRelease(fixture.trade, decision);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.metadata.signedTxid, second.metadata.signedTxid);
  assert.equal(second.metadata.broadcastAttemptCreated, false);
  const attempts = await repo.listBroadcastAttempts();
  assert.equal(attempts.length, 1);
});

test('PreauthorizedArbiterSignerAdapter defers refund to the user paste flow without signing', async () => {
  const fixture = buildFixture();
  const repo = new InMemoryPearlEscrowBroadcastAttemptRepository();
  const adapter = new PreauthorizedArbiterSignerAdapter({
    arbiterSigner: createScriptPathSigner(fixture.arbiter.privateKey),
    broadcastAttempts: repo,
    refreshTrade: async () => fixture.trade,
    signerKeyId: 'arbiter-dev',
  });
  const prepared = await adapter.preparePrlRefund(fixture.trade, { ...decisionRecord(fixture.trade.tradeId), action: 'prepare_prl_refund' });
  assert.equal(prepared.metadata.deferredToUserPasteFlow, true);
  const attempts = await repo.listBroadcastAttempts();
  assert.equal(attempts.length, 0);
});
