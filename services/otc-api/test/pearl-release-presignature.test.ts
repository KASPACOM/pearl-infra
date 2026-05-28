import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import { createPearlSignerProofMessage, type PearlReleaseSigningMode, type PearlSignerProofRole } from '@kaspacom/pearl-sdk';
import {
  buildPartialPearlEscrowScriptPathPsbt,
  createScriptPathSigner,
  type PearlEscrowPackage,
} from '@kaspacom/pearl-escrow';
import { initEccLib, Psbt } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { createConfiguredPearlEscrowAllocator } from '../src/pearl-escrow-allocator.ts';
import type { PearlProofReader } from '../src/pearl-proof-reader.ts';
import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowWatchRegistrar } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';

initEccLib(ecc);

const BUYER_TESTNET_ADDRESS = 'tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef';
const SELLER_TESTNET_REFUND_ADDRESS = 'tprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqpcq7p3';

class RecordingWatchRegistrar implements PearlEscrowWatchRegistrar {
  readonly registrations: { tradeId: string; address: string }[] = [];
  async registerPearlEscrowWatch(trade: Parameters<PearlEscrowWatchRegistrar['registerPearlEscrowWatch']>[0]) {
    this.registrations.push({ tradeId: trade.tradeId, address: trade.pearlEscrow.address });
    return {
      watchId: `watch_${this.registrations.length}`,
      address: trade.pearlEscrow.address,
      network: trade.pearlEscrow.network,
      requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
      metadata: {},
    };
  }
}

class StaticFundingProofReader implements PearlProofReader {
  private readonly outpoint: string;
  constructor(outpoint: string) {
    this.outpoint = outpoint;
  }
  async getPearlIndexedProof() {
    return { escrowOutpoint: this.outpoint, escrowConfirmations: 6, events: [] };
  }
}

function privkeyHexFromSeed(seed: number): Buffer {
  let bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(seed, 28);
  while (!ecc.isPrivate(bytes)) bytes = randomBytes(32);
  return bytes;
}

function xOnlyHex(privkey: Buffer): string {
  const pub = ecc.pointFromScalar(privkey, true);
  if (!pub) throw new Error('invalid privkey');
  return Buffer.from(pub).subarray(1).toString('hex');
}

function signSignerProof(input: {
  quoteId: string;
  role: PearlSignerProofRole;
  pearlAddress: string;
  usdcAddress: string;
  pearlPubkey: string;
  releaseSigningMode: PearlReleaseSigningMode;
  privateKey: Buffer;
}): string {
  const message = createPearlSignerProofMessage({
    quoteId: input.quoteId,
    role: input.role,
    pearlAddress: input.pearlAddress,
    usdcAddress: input.usdcAddress,
    pearlPubkey: input.pearlPubkey,
    releaseSigningMode: input.releaseSigningMode,
  });
  const hash = createHash('sha256').update(message).digest();
  return Buffer.from(ecc.signSchnorr(hash, input.privateKey)).toString('hex');
}

interface PreparedMultisigTrade {
  service: OtcTradeService;
  tradeId: string;
  buyerPrivkey: Buffer;
  sellerPrivkey: Buffer;
  arbiterPrivkey: Buffer;
  fundingOutpoint: string;
}

async function prepareConfirmedMultisigTrade(clientIdSuffix: string): Promise<PreparedMultisigTrade> {
  const buyerPrivkey = privkeyHexFromSeed(0x42 + clientIdSuffix.length);
  const sellerPrivkey = privkeyHexFromSeed(0x43 + clientIdSuffix.length);
  const arbiterPrivkey = privkeyHexFromSeed(0x44 + clientIdSuffix.length);
  const buyerPubkey = xOnlyHex(buyerPrivkey);
  const sellerPubkey = xOnlyHex(sellerPrivkey);
  const arbiterPubkey = xOnlyHex(arbiterPrivkey);

  const config: OtcApiConfig = {
    pearlNetwork: 'testnet2',
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowDerivationPrefix: '0',
    pearlEscrowArbiterPubkey: arbiterPubkey,
    allowMainnetPearlEscrow: false,
    quoteTtlMs: 5 * 60 * 1000,
    pearlFundingTtlMs: 10 * 60 * 1000,
    usdcDepositTtlMs: 15 * 60 * 1000,
    settlementTtlMs: 30 * 60 * 1000,
    priceUsdcPerPrl: '0.170000',
    feeBps: 100,
    pearlEscrowConfirmations: 3,
    pearlReleaseFeeGrains: '10000',
    baseEscrowContract: '0x1111111111111111111111111111111111111111',
    baseNetwork: 'base_sepolia',
    supportAlertRateLimitWindowMs: 10 * 60 * 1000,
    supportAlertRateLimitMax: 5,
  };
  const fundingOutpoint = `${randomBytes(32).toString('hex')}:0`;
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    config,
    createConfiguredPearlEscrowAllocator(config),
    undefined,
    () => new Date('2026-05-28T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
    new StaticFundingProofReader(fundingOutpoint),
  );

  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: `presig-quote-${clientIdSuffix}`,
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode: 'preauthorize_release',
    buyerPearlPubkey: buyerPubkey,
    sellerPearlPubkey: sellerPubkey,
    buyerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'buyer',
      pearlAddress: BUYER_TESTNET_ADDRESS,
      usdcAddress: '0x3333333333333333333333333333333333333333',
      pearlPubkey: buyerPubkey,
      releaseSigningMode: 'preauthorize_release',
      privateKey: buyerPrivkey,
    }),
    sellerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'seller',
      pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
      usdcAddress: '0x4444444444444444444444444444444444444444',
      pearlPubkey: sellerPubkey,
      releaseSigningMode: 'preauthorize_release',
      privateKey: sellerPrivkey,
    }),
    clientRequestId: `presig-accept-${clientIdSuffix}`,
  });
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', `pearl-seen-${trade.tradeId}`);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', `pearl-confirmed-${trade.tradeId}`);
  return { service, tradeId: trade.tradeId, buyerPrivkey, sellerPrivkey, arbiterPrivkey, fundingOutpoint };
}

async function buyerSignReleaseTemplate(prepared: PreparedMultisigTrade): Promise<string> {
  const template = await prepared.service.getPearlReleasePresignTemplate(prepared.tradeId);
  const psbt = Psbt.fromBase64(template.psbtBase64);
  psbt.signTaprootInput(0, createScriptPathSigner(prepared.buyerPrivkey));
  return psbt.toBase64();
}

test('getPearlReleasePresignTemplate returns a deterministic unsigned PSBT for a confirmed multisig trade', async () => {
  const prepared = await prepareConfirmedMultisigTrade('happy-template');
  const template = await prepared.service.getPearlReleasePresignTemplate(prepared.tradeId);
  assert.equal(template.tradeId, prepared.tradeId);
  assert.equal(template.leafKind, 'buyer_arbiter_release');
  assert.equal(template.fundingOutpoint, prepared.fundingOutpoint);
  assert.equal(template.feeGrains, '10000');
  assert.equal(template.outputAmountGrains, (BigInt(template.expectedAmountGrains) - 10000n).toString());
  const psbt = Psbt.fromBase64(template.psbtBase64);
  assert.equal(psbt.inputCount, 1);
  assert.equal(psbt.txOutputs.length, 1);
});

test('submitPearlReleasePresignature accepts a valid buyer-signed PSBT and persists it', async () => {
  const prepared = await prepareConfirmedMultisigTrade('happy-submit');
  const signedPsbt = await buyerSignReleaseTemplate(prepared);
  const updated = await prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: signedPsbt });
  assert.ok(updated.pearlEscrow.buyerReleasePresignature);
  assert.equal(updated.pearlEscrow.buyerReleasePresignature?.leafKind, 'buyer_arbiter_release');
  assert.equal(updated.pearlEscrow.buyerReleasePresignature?.fundingOutpoint, prepared.fundingOutpoint);
  assert.equal(updated.pearlEscrow.buyerReleasePresignature?.feeGrains, '10000');
});

test('submitPearlReleasePresignature rejects a PSBT signed for a different funding outpoint (L1)', async () => {
  const prepared = await prepareConfirmedMultisigTrade('l1-wrong-outpoint');
  const template = await prepared.service.getPearlReleasePresignTemplate(prepared.tradeId);
  const psbt = Psbt.fromBase64(template.psbtBase64);
  // Tamper: substitute the input outpoint with a bogus one before signing.
  const tamperedPsbt = new Psbt({ network: psbt['opts'].network });
  tamperedPsbt.setVersion(2);
  const tapLeaf = psbt.data.inputs[0]!.tapLeafScript![0]!;
  tamperedPsbt.addInput({
    hash: '00'.repeat(32),
    index: 7,
    witnessUtxo: psbt.data.inputs[0]!.witnessUtxo,
    tapInternalKey: psbt.data.inputs[0]!.tapInternalKey,
    tapLeafScript: [{ leafVersion: tapLeaf.leafVersion, script: tapLeaf.script, controlBlock: tapLeaf.controlBlock }],
  });
  tamperedPsbt.addOutput({ script: Buffer.from(psbt.txOutputs[0]!.script), value: Number(psbt.txOutputs[0]!.value) });
  tamperedPsbt.signTaprootInput(0, createScriptPathSigner(prepared.buyerPrivkey));
  await assert.rejects(
    () => prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: tamperedPsbt.toBase64() }),
    /funding outpoint/i,
  );
});

test('submitPearlReleasePresignature rejects a PSBT with tampered output value (L2 fee inflation)', async () => {
  const prepared = await prepareConfirmedMultisigTrade('l2-fee-inflation');
  const template = await prepared.service.getPearlReleasePresignTemplate(prepared.tradeId);
  const psbt = Psbt.fromBase64(template.psbtBase64);
  // Tamper output value to leave most of the input as fee.
  const tampered = new Psbt({ network: psbt['opts'].network });
  tampered.setVersion(2);
  const txInput = psbt.txInputs[0]!;
  const tapLeaf = psbt.data.inputs[0]!.tapLeafScript![0]!;
  tampered.addInput({
    hash: Buffer.from(txInput.hash),
    index: txInput.index,
    witnessUtxo: psbt.data.inputs[0]!.witnessUtxo,
    tapInternalKey: psbt.data.inputs[0]!.tapInternalKey,
    tapLeafScript: [{ leafVersion: tapLeaf.leafVersion, script: tapLeaf.script, controlBlock: tapLeaf.controlBlock }],
  });
  tampered.addOutput({ script: Buffer.from(psbt.txOutputs[0]!.script), value: 1 });
  tampered.signTaprootInput(0, createScriptPathSigner(prepared.buyerPrivkey));
  await assert.rejects(
    () => prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: tampered.toBase64() }),
    /output value/i,
  );
});

test('submitPearlReleasePresignature is rejected when trade is still in pearl_escrow_pending (L3 pre-funding)', async () => {
  const buyerPrivkey = privkeyHexFromSeed(0x99);
  const sellerPrivkey = privkeyHexFromSeed(0x9a);
  const arbiterPrivkey = privkeyHexFromSeed(0x9b);
  const buyerPubkey = xOnlyHex(buyerPrivkey);
  const sellerPubkey = xOnlyHex(sellerPrivkey);
  const arbiterPubkey = xOnlyHex(arbiterPrivkey);
  const config: OtcApiConfig = {
    pearlNetwork: 'testnet2',
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowDerivationPrefix: '0',
    pearlEscrowArbiterPubkey: arbiterPubkey,
    allowMainnetPearlEscrow: false,
    quoteTtlMs: 5 * 60 * 1000,
    pearlFundingTtlMs: 10 * 60 * 1000,
    usdcDepositTtlMs: 15 * 60 * 1000,
    settlementTtlMs: 30 * 60 * 1000,
    priceUsdcPerPrl: '0.170000',
    feeBps: 100,
    pearlEscrowConfirmations: 3,
    pearlReleaseFeeGrains: '10000',
    baseEscrowContract: '0x1111111111111111111111111111111111111111',
    baseNetwork: 'base_sepolia',
    supportAlertRateLimitWindowMs: 10 * 60 * 1000,
    supportAlertRateLimitMax: 5,
  };
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    config,
    createConfiguredPearlEscrowAllocator(config),
    undefined,
    () => new Date('2026-05-28T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
    undefined,
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'presig-l3-quote',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode: 'preauthorize_release',
    buyerPearlPubkey: buyerPubkey,
    sellerPearlPubkey: sellerPubkey,
    buyerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'buyer',
      pearlAddress: BUYER_TESTNET_ADDRESS,
      usdcAddress: '0x3333333333333333333333333333333333333333',
      pearlPubkey: buyerPubkey,
      releaseSigningMode: 'preauthorize_release',
      privateKey: buyerPrivkey,
    }),
    sellerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'seller',
      pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
      usdcAddress: '0x4444444444444444444444444444444444444444',
      pearlPubkey: sellerPubkey,
      releaseSigningMode: 'preauthorize_release',
      privateKey: sellerPrivkey,
    }),
    clientRequestId: 'presig-l3-accept',
  });
  // trade is in pearl_escrow_pending here; getPearlReleasePresignTemplate must reject.
  await assert.rejects(
    () => service.getPearlReleasePresignTemplate(trade.tradeId),
    /does not allow pearl release presignature submission|funding outpoint/i,
  );
});

test('submitPearlReleasePresignature is rejected when called twice without revocation', async () => {
  const prepared = await prepareConfirmedMultisigTrade('idempotency');
  const signedPsbt = await buyerSignReleaseTemplate(prepared);
  await prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: signedPsbt });
  await assert.rejects(
    () => prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: signedPsbt }),
    /already recorded/i,
  );
});

test('revokePearlReleasePresignature succeeds before any Pearl release side effect, then allows re-submission', async () => {
  const prepared = await prepareConfirmedMultisigTrade('revoke-then-resubmit');
  const signed = await buyerSignReleaseTemplate(prepared);
  await prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: signed });
  const revoked = await prepared.service.revokePearlReleasePresignature(prepared.tradeId);
  assert.ok(revoked.pearlEscrow.buyerReleasePresignature?.revokedAt);
  // re-submit a fresh signature
  const signedAgain = await buyerSignReleaseTemplate(prepared);
  const resubmitted = await prepared.service.submitPearlReleasePresignature(prepared.tradeId, { psbtBase64: signedAgain });
  assert.ok(resubmitted.pearlEscrow.buyerReleasePresignature && !resubmitted.pearlEscrow.buyerReleasePresignature.revokedAt);
});
