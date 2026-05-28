import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type OrderSweepBroadcaster, type OrderSweepSigner } from '../src/trade-service.ts';
import type { OtcApiConfig, OtcOrder, OtcOrderSweep } from '../src/types.ts';

const NOW = new Date('2026-05-28T20:00:00.000Z');
const config: OtcApiConfig = {
  pearlNetwork: 'testnet2',
  pearlEscrowAllocator: 'mock',
  pearlEscrowDerivationPrefix: '0',
  allowMainnetPearlEscrow: false,
  quoteTtlMs: 5 * 60 * 1000,
  pearlFundingTtlMs: 10 * 60 * 1000,
  usdcDepositTtlMs: 15 * 60 * 1000,
  settlementTtlMs: 30 * 60 * 1000,
  priceUsdcPerPrl: '0.170000',
  feeBps: 0,
  pearlEscrowConfirmations: 3,
  baseEscrowContract: '0x0000000000000000000000000000000000000000',
  baseNetwork: 'base_sepolia',
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
};

const order: OtcOrder = {
  orderId: 'order-sweep-1',
  makerUserId: 'user-1',
  side: 'sell_prl',
  fundingAsset: 'PRL',
  makerPearlAddress: 'tprl1pmaker',
  makerUsdcAddress: '0x1111111111111111111111111111111111111111',
  makerPearlPubkey: 'aa'.repeat(32),
  makerPearlPubkeyProof: 'bb'.repeat(64),
  pearlReleaseSigningMode: 'preauthorize_release',
  amountPrl: '100.00000000',
  remainingPrl: '100.00000000',
  priceUsdcPerPrl: '0.170000',
  status: 'open',
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-05-28T00:00:00.000Z',
  prefundMode: 'auto_sweep',
  prefundState: 'funded',
  prefundEscrowAddress: 'tprl1pprefund',
  prefundFundedOutpoint: 'fundingtx:0',
  prefundFundedGrains: '10000000000',
  prefundRemainingGrains: '10000000000',
};

class FakeSigner implements OrderSweepSigner {
  prepareCalls = 0;
  cosignCalls = 0;
  async prepareSweepPsbt(): Promise<{ psbtBase64: string; inputAmountGrains: string; outputAmountGrains: string; feeGrains: string }> {
    this.prepareCalls += 1;
    return { psbtBase64: 'prepared-psbt', inputAmountGrains: '10000000000', outputAmountGrains: '9990000', feeGrains: '10000' };
  }
  async cosignSweepPsbt(): Promise<{ signedPsbtBase64: string; signedTxHex: string; signedTxid: string }> {
    this.cosignCalls += 1;
    return { signedPsbtBase64: 'cosigned-psbt', signedTxHex: '00deadbeef', signedTxid: 'tx-' + Math.random() };
  }
}

class FakeBroadcaster implements OrderSweepBroadcaster {
  broadcasts: Array<{ sweepId: string }> = [];
  async broadcastSweep(input: { sweep: OtcOrderSweep }): Promise<{ txid: string }> {
    this.broadcasts.push({ sweepId: input.sweep.sweepId });
    return { txid: 'broadcast-' + input.sweep.sweepId };
  }
}

async function setupSweep(repo: InMemoryOtcRepository, opts: { mode: 'auto_sweep' | 'manual_confirm' }): Promise<{ service: OtcTradeService; sweepId: string }> {
  await repo.saveOrder({ ...order, prefundMode: opts.mode });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const { sweep } = await service.initiateOrderSweep({
    sweepId: 'sweep-x',
    order: { ...order, prefundMode: opts.mode },
    tradeId: 'trade-x',
    sweptGrains: '5000000000',
  });
  return { service, sweepId: sweep.sweepId };
}

test('autoSignAndBroadcastSweep (Mode A) signs both legs and transitions to broadcast', async () => {
  const repo = new InMemoryOtcRepository();
  const { service, sweepId } = await setupSweep(repo, { mode: 'auto_sweep' });
  const signer = new FakeSigner();
  const broadcaster = new FakeBroadcaster();
  const result = await service.autoSignAndBroadcastSweep({
    sweepId,
    signer,
    broadcaster,
    tradeEscrowAddress: 'tprl1ptradeescrow',
    changeAddress: 'tprl1pprefundchange',
  });
  assert.equal(result.status, 'broadcast');
  assert.equal(result.sweepPsbtBase64, 'cosigned-psbt');
  assert.ok(result.sweepTxid?.startsWith('broadcast-'));
  assert.equal(signer.prepareCalls, 1);
  assert.equal(signer.cosignCalls, 1);
  assert.equal(broadcaster.broadcasts.length, 1);
});

test('autoSignAndBroadcastSweep rejects sweeps not in pending', async () => {
  const repo = new InMemoryOtcRepository();
  const { service, sweepId } = await setupSweep(repo, { mode: 'auto_sweep' });
  // Mutate the sweep to broadcast status to simulate a duplicate signal.
  await repo.updateOrderSweep({ sweepId, status: 'broadcast', updatedAt: NOW.toISOString() });
  await assert.rejects(
    () =>
      service.autoSignAndBroadcastSweep({
        sweepId,
        signer: new FakeSigner(),
        broadcaster: new FakeBroadcaster(),
        tradeEscrowAddress: 'tprl1pte',
      }),
    /not pending/,
  );
});

test('autoSignAndBroadcastSweep rejects Mode B orders (manual path required)', async () => {
  const repo = new InMemoryOtcRepository();
  const { service, sweepId } = await setupSweep(repo, { mode: 'manual_confirm' });
  await assert.rejects(
    () =>
      service.autoSignAndBroadcastSweep({
        sweepId,
        signer: new FakeSigner(),
        broadcaster: new FakeBroadcaster(),
        tradeEscrowAddress: 'tprl1pte',
      }),
    /not pending|not in auto_sweep mode/,
  );
});

test('applyMakerSweepSignature (Mode B) co-signs with maker PSBT and broadcasts', async () => {
  const repo = new InMemoryOtcRepository();
  const { service, sweepId } = await setupSweep(repo, { mode: 'manual_confirm' });
  const signer = new FakeSigner();
  const broadcaster = new FakeBroadcaster();
  const result = await service.applyMakerSweepSignature({
    sweepId,
    makerSignedPsbtBase64: 'maker-signed-psbt',
    signer,
    broadcaster,
  });
  assert.equal(result.status, 'broadcast');
  assert.equal(signer.prepareCalls, 0); // Mode B does NOT re-build the PSBT
  assert.equal(signer.cosignCalls, 1);
  assert.ok(result.sweepTxid?.startsWith('broadcast-'));
});

test('applyMakerSweepSignature rejects sweeps not awaiting maker signature', async () => {
  const repo = new InMemoryOtcRepository();
  const { service, sweepId } = await setupSweep(repo, { mode: 'auto_sweep' });
  await assert.rejects(
    () =>
      service.applyMakerSweepSignature({
        sweepId,
        makerSignedPsbtBase64: 'maker-psbt',
        signer: new FakeSigner(),
        broadcaster: new FakeBroadcaster(),
      }),
    /not awaiting maker signature/,
  );
});

test('recordSweepConfirmed transitions broadcast → confirmed and is idempotent', async () => {
  const repo = new InMemoryOtcRepository();
  const { service, sweepId } = await setupSweep(repo, { mode: 'auto_sweep' });
  await service.autoSignAndBroadcastSweep({
    sweepId,
    signer: new FakeSigner(),
    broadcaster: new FakeBroadcaster(),
    tradeEscrowAddress: 'tprl1pte',
  });
  const confirmed = await service.recordSweepConfirmed({ sweepId });
  assert.equal(confirmed.status, 'confirmed');
  await assert.rejects(() => service.recordSweepConfirmed({ sweepId }), /not in broadcast/);
});
