import assert from 'node:assert/strict';
import test from 'node:test';

import type { OtcQuote, OtcTrade, PublicTradeProof } from '@kaspacom/pearl-sdk';

import {
  buildAcceptQuotePageModel,
  buildFailureBanner,
  buildPublicProofPageModel,
  buildQuotePageModel,
  buildTradeCheckoutPageModel,
} from '../src/page-models.ts';

const NOW = new Date('2026-05-18T12:00:00.000Z');

test('builds quote request model with locked USDC on Base and validation errors', () => {
  const invalid = buildQuotePageModel({
    side: 'buy_prl',
    amountPrl: '10.123456789',
    buyerPearlAddress: 'not-pearl',
    usdcRefundAddress: '0x123',
    clientRequestId: '',
  });

  assert.equal(invalid.canSubmit, false);
  assert.equal(invalid.lockedSettlement.asset, 'USDC');
  assert.equal(invalid.lockedSettlement.network, 'base');
  assert.match(invalid.errors.amountPrl ?? '', /8 decimals/);
  assert.equal(invalid.request, undefined);

  const valid = buildQuotePageModel({
    side: 'sell_prl',
    amountPrl: '10.12345678',
    buyerPearlAddress: 'tprl1pbuyer01',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-client-1',
  });

  assert.equal(valid.canSubmit, true);
  assert.deepEqual(valid.request, {
    side: 'sell_prl',
    amountPrl: '10.12345678',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer01',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-client-1',
  });
});

test('builds quote acceptance model with role-based seller fields and expiry gating', () => {
  const quote = quoteFixture({ expiresAt: '2026-05-18T12:05:00.000Z' });
  const buyer = buildAcceptQuotePageModel(
    quote,
    {
      buyerPearlAddress: 'tprl1pbuyer01',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      clientRequestId: 'accept-client-1',
    },
    'buyer',
    NOW,
  );

  assert.equal(buyer.sellerFieldsVisible, false);
  assert.equal(buyer.canAccept, true);

  const seller = buildAcceptQuotePageModel(
    quote,
    {
      buyerPearlAddress: 'tprl1pbuyer01',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: '',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      clientRequestId: 'accept-client-1',
    },
    'seller',
    NOW,
  );

  assert.equal(seller.sellerFieldsVisible, true);
  assert.equal(seller.canAccept, false);
  assert.match(seller.errors.sellerPearlRefundAddress ?? '', /seller refund/);

  const expired = buildAcceptQuotePageModel(quoteFixture({ expiresAt: '2026-05-18T11:59:59.000Z' }), {
    buyerPearlAddress: 'tprl1pbuyer01',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    clientRequestId: 'accept-client-1',
  }, 'buyer', NOW);

  assert.equal(expired.quoteExpired, true);
  assert.equal(expired.canAccept, false);
});

test('requires Pearl signer pubkeys when quote acceptance selects multisig escrow', () => {
  const quote = quoteFixture({ expiresAt: '2026-05-18T12:05:00.000Z' });
  const missingPubkeys = buildAcceptQuotePageModel(
    quote,
    {
      buyerPearlAddress: 'tprl1pbuyer01',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      pearlEscrowMode: 'multisig',
      pearlReleaseSigningMode: 'preauthorize_release',
      clientRequestId: 'accept-client-multisig',
    },
    'buyer',
    NOW,
  );

  assert.equal(missingPubkeys.canAccept, false);
  assert.match(missingPubkeys.errors.buyerPearlPubkey ?? '', /buyer Pearl x-only public key/);
  assert.match(missingPubkeys.errors.sellerPearlPubkey ?? '', /seller Pearl x-only public key/);

  const ready = buildAcceptQuotePageModel(
    quote,
    {
      buyerPearlAddress: 'tprl1pbuyer01',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      pearlEscrowMode: 'multisig',
      pearlReleaseSigningMode: 'preauthorize_release',
      buyerPearlPubkey: '11'.repeat(32),
      sellerPearlPubkey: '22'.repeat(32),
      clientRequestId: 'accept-client-multisig',
    },
    'buyer',
    NOW,
  );

  assert.equal(ready.canAccept, true);
});

test('checkout model disables USDC deposit after deadline or verification mismatch and never exposes release actions', () => {
  const trade = tradeFixture({ state: 'usdc_escrow_pending' });
  const open = buildTradeCheckoutPageModel(trade, {
    now: NOW,
    wallet: { connected: true, chainId: 84532, address: '0x3333333333333333333333333333333333333333' },
    usdcVerification: { verified: true, depositAllowed: true, mismatches: [] },
  });

  assert.equal(open.base.depositAction.kind, 'deposit_usdc');
  assert.equal(open.base.depositAction.disabled, false);
  assert.equal(open.releaseActionsVisible, false);

  const expired = buildTradeCheckoutPageModel(trade, {
    now: new Date('2026-05-18T12:16:00.000Z'),
    wallet: { connected: true, chainId: 84532, address: '0x3333333333333333333333333333333333333333' },
    usdcVerification: { verified: true, depositAllowed: true, mismatches: [] },
  });

  assert.equal(expired.base.depositAction.kind, 'blocked');
  assert.match(expired.base.depositAction.reason ?? '', /deadline/);

  const mismatched = buildTradeCheckoutPageModel(trade, {
    now: NOW,
    wallet: { connected: true, chainId: 84532, address: '0x3333333333333333333333333333333333333333' },
    usdcVerification: { verified: false, depositAllowed: false, mismatches: ['amountMicros mismatch'] },
  });

  assert.equal(mismatched.base.depositAction.kind, 'blocked');
  assert.match(mismatched.base.depositAction.reason ?? '', /amountMicros mismatch/);

  const unverified = buildTradeCheckoutPageModel(trade, {
    now: NOW,
    wallet: { connected: true, chainId: 84532, address: '0x3333333333333333333333333333333333333333' },
  });

  assert.equal(unverified.base.depositAction.kind, 'blocked');
  assert.match(unverified.base.depositAction.reason ?? '', /not been verified/);

  const wrongWallet = buildTradeCheckoutPageModel(trade, {
    now: NOW,
    wallet: { connected: true, chainId: 84532, address: '0x5555555555555555555555555555555555555555' },
    usdcVerification: { verified: true, depositAllowed: true, mismatches: [] },
  });

  assert.equal(wrongWallet.base.depositAction.kind, 'blocked');
  assert.match(wrongWallet.base.depositAction.reason ?? '', /buyer USDC address/);

  const unconfirmedPrl = buildTradeCheckoutPageModel(tradeFixture({ state: 'pearl_escrow_seen' }), {
    now: NOW,
    wallet: { connected: true, chainId: 84532, address: '0x3333333333333333333333333333333333333333' },
    usdcVerification: { verified: true, depositAllowed: true, mismatches: [] },
  });

  assert.equal(unconfirmedPrl.base.depositAction.kind, 'blocked');
  assert.match(unconfirmedPrl.base.depositAction.reason ?? '', /pearl_escrow_seen/);
});

test('checkout model surfaces Pearl multisig custody and signer policy', () => {
  const trade = tradeFixture({
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode: 'preauthorize_release',
    pearlEscrow: {
      ...tradeFixture().pearlEscrow,
      releaseTemplate: {
        kind: 'release',
        inputs: [{ outpoint: 'pearl_tx_1:0', amountGrains: '100000000000' }],
        outputs: [{ address: 'tprl1pbuyer01', amountGrains: '100000000000', role: 'buyer' }],
        signingPolicy: {
          path: 'taproot_script_path',
          requiredSigners: ['buyer', 'seller'],
          alternativeSignerSets: [
            ['buyer', 'arbiter'],
            ['seller', 'arbiter'],
          ],
        },
      },
    },
  });

  const checkout = buildTradeCheckoutPageModel(trade, { now: NOW });

  assert.equal(checkout.pearl.escrowMode, 'multisig');
  assert.equal(checkout.pearl.releaseSigningMode, 'preauthorize_release');
  assert.deepEqual(checkout.pearl.signerSets, ['buyer + seller', 'buyer + arbiter', 'seller + arbiter']);
});

test('checkout and public proof models surface manual-review banners and timeline facts', () => {
  const trade = tradeFixture({ state: 'unknown_spend' });
  const proof = proofFixture({ status: 'unknown_spend' });
  const checkout = buildTradeCheckoutPageModel(trade, { now: NOW, proof });
  const proofPage = buildPublicProofPageModel(proof, NOW);

  assert.equal(checkout.failureBanner?.severity, 'danger');
  assert.match(checkout.failureBanner?.headline ?? '', /unrecognized transaction/);
  assert.equal(checkout.timeline[0]?.chain, 'pearl');
  assert.equal(proofPage.actionsVisible, false);
  assert.equal(proofPage.deadlines.find((deadline) => deadline.key === 'usdcDepositDeadline')?.status, 'open');
});

test('failure banner support links include trade id and state', () => {
  const banner = buildFailureBanner('late_prl_funding', 'trade_123');

  assert.ok(banner);
  assert.match(banner.supportHref, /trade_123/);
  assert.match(banner.supportHref, /late_prl_funding/);
});

function quoteFixture(overrides: Partial<OtcQuote> = {}): OtcQuote {
  return {
    quoteId: 'quote_1',
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    amountUsdc: '170.000000',
    feePrl: '10.00000000',
    feeUsdc: '1.700000',
    priceUsdcPerPrl: '0.170000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    expiresAt: '2026-05-18T12:05:00.000Z',
    status: 'active',
    ...overrides,
  };
}

function tradeFixture(overrides: Partial<OtcTrade> = {}): OtcTrade {
  return {
    tradeId: 'trade_1',
    quoteId: 'quote_1',
    state: 'pearl_escrow_pending',
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    amountUsdc: '170.000000',
    feePrl: '10.00000000',
    feeUsdc: '1.700000',
    buyerPearlAddress: 'tprl1pbuyer01',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1pseller01',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    pearlEscrow: {
      network: 'testnet2',
      address: 'tprl1pescrow01',
      expectedAmountGrains: '100000000000',
      requiredConfirmations: 3,
      fundingOutpoint: 'pearl_tx_1:0',
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: '0x1111111111111111111111111111111111111111',
      usdcToken: '0x2222222222222222222222222222222222222222',
      tradeKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      expectedAmountMicros: '170000000',
      requiredConfirmations: 3,
      expiresAt: '2026-05-18T12:15:00.000Z',
    },
    deadlines: {
      quoteExpiresAt: '2026-05-18T12:05:00.000Z',
      pearlFundingDeadline: '2026-05-18T12:10:00.000Z',
      usdcDepositDeadline: '2026-05-18T12:15:00.000Z',
      settlementDeadline: '2026-05-18T12:30:00.000Z',
      refundAvailableAt: '2026-05-18T12:35:00.000Z',
    },
    createdAt: '2026-05-18T11:55:00.000Z',
    updatedAt: '2026-05-18T12:00:00.000Z',
    ...overrides,
  };
}

function proofFixture(overrides: Partial<PublicTradeProof> = {}): PublicTradeProof {
  const trade = tradeFixture();
  return {
    tradeId: trade.tradeId,
    status: trade.state,
    deadlines: trade.deadlines,
    quote: {
      side: trade.side,
      amountPrl: trade.amountPrl,
      amountUsdc: trade.amountUsdc,
      feePrl: trade.feePrl,
      feeUsdc: trade.feeUsdc,
      priceUsdcPerPrl: '0.170000',
    },
    pearl: {
      escrowAddress: trade.pearlEscrow.address,
      escrowOutpoint: trade.pearlEscrow.fundingOutpoint,
      escrowConfirmations: 1,
    },
    base: {
      chainId: trade.usdcEscrow.chainId,
      contract: trade.usdcEscrow.contract,
      usdcToken: trade.usdcEscrow.usdcToken,
      tradeKey: trade.usdcEscrow.tradeKey,
      requiredConfirmations: trade.usdcEscrow.requiredConfirmations,
    },
    events: [
      {
        tradeId: trade.tradeId,
        fromState: 'pearl_escrow_pending',
        toState: 'pearl_escrow_seen',
        source: 'pearl_indexer',
        sourceEventId: 'pearl-event-1',
        outpoint: 'pearl_tx_1:0',
        confirmations: 1,
        observedAt: '2026-05-18T12:01:00.000Z',
      },
    ],
    observedAt: '2026-05-18T12:02:00.000Z',
    ...overrides,
  };
}
