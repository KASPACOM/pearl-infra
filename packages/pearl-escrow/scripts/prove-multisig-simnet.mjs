#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { address as bitcoinAddress, initEccLib, Psbt, Transaction } from 'bitcoinjs-lib';
import * as bip341 from 'bitcoinjs-lib/src/payments/bip341.js';
import * as ecc from 'tiny-secp256k1';

import { createPearlP2trPayment, getPearlScriptNetwork } from '@kaspacom/pearl-script';
import { createPearlMultisigEscrowPackage } from '../dist/index.js';

initEccLib(ecc);

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const OUTPUT_JSON = resolve(REPO_ROOT, 'docs/operations/pearl-multisig-funded-simnet-evidence-20260519.json');
const OUTPUT_MD = resolve(REPO_ROOT, 'docs/operations/pearl-multisig-funded-simnet-evidence-20260519.md');
const PEARL_RPC_URL = process.env.PEARL_SIMNET_RPC_URL ?? 'http://65.21.206.46:18556';
const PEARL_RPC_USER = process.env.PEARL_SIMNET_RPC_USER;
const PEARL_RPC_PASS = process.env.PEARL_SIMNET_RPC_PASS;
const SOURCE_PRIVATE_KEY_HEX = process.env.PEARL_SIMNET_SOURCE_PRIVATE_KEY_HEX;
const INDEXER_REGISTER_URL = process.env.PEARL_INDEXER_WATCH_URL ?? 'http://65.21.206.46:8088';
const INDEXER_READ_URL = process.env.PEARL_INDEXER_READ_URL ?? INDEXER_REGISTER_URL;
const NETWORK = getPearlScriptNetwork('simnet');

if (!PEARL_RPC_USER || !PEARL_RPC_PASS || !SOURCE_PRIVATE_KEY_HEX) {
  throw new Error('PEARL_SIMNET_RPC_USER, PEARL_SIMNET_RPC_PASS, and PEARL_SIMNET_SOURCE_PRIVATE_KEY_HEX are required');
}

const SOURCE_PRIVATE_KEY = parsePrivateKeyHex(SOURCE_PRIVATE_KEY_HEX);
const SOURCE_INTERNAL_PUBKEY = xOnlyPublicKeyFromPrivateKey(SOURCE_PRIVATE_KEY);
const SOURCE_ADDRESS = createPearlP2trPayment({ network: 'simnet', internalPubkey: SOURCE_INTERNAL_PUBKEY }).address;
const SOURCE_OUTPUT_SCRIPT = createPearlP2trPayment({ network: 'simnet', internalPubkey: SOURCE_INTERNAL_PUBKEY }).outputScriptHex;
const FUNDING_FEE_GRAINS = 10_000;
const SPEND_FEE_GRAINS = 10_000;
const OTC_RELEASE_AMOUNT = 125_000_000;
const OTC_REFUND_AMOUNT = 126_000_000;
const BRIDGE_RESERVE_AMOUNT = 127_000_000;

const runId = process.env.PEARL_MULTISIG_PROOF_RUN_ID ?? `multisig-${Date.now()}`;
const startedAt = new Date().toISOString();

const tipAtStart = await rpc('getblockcount');
const refundLockTime = tipAtStart + 3;
const releaseKeys = createRoleKeys();
const refundKeys = createRoleKeys();
const reserveKeys = createRoleKeys();
const releaseAddress = createRandomP2trAddress();
const refundAddress = createRandomP2trAddress();
const bridgeRecipientAddress = createRandomP2trAddress();

const otcReleaseEscrow = createMultisigPackage({
  tradeId: `${runId}-otc-release`,
  keys: releaseKeys,
  expectedAmountGrains: String(OTC_RELEASE_AMOUNT),
  releaseAddress,
  refundAddress,
  refundLockTime,
});
const otcRefundEscrow = createMultisigPackage({
  tradeId: `${runId}-otc-refund`,
  keys: refundKeys,
  expectedAmountGrains: String(OTC_REFUND_AMOUNT),
  releaseAddress,
  refundAddress,
  refundLockTime,
});
const bridgeReserveEscrow = createMultisigPackage({
  tradeId: `${runId}-bridge-reserve`,
  keys: reserveKeys,
  expectedAmountGrains: String(BRIDGE_RESERVE_AMOUNT),
  releaseAddress: bridgeRecipientAddress,
  refundAddress: createRandomP2trAddress(),
  refundLockTime: refundLockTime + 100,
});

await registerOtcWatch(otcReleaseEscrow, 'release');
await registerOtcWatch(otcRefundEscrow, 'refund');
await registerBridgeReserveWatch(bridgeReserveEscrow);

const sourceUtxo = await selectSourceUtxo(
  OTC_RELEASE_AMOUNT + OTC_REFUND_AMOUNT + BRIDGE_RESERVE_AMOUNT + FUNDING_FEE_GRAINS,
);
const fundingTxHex = createFundingTx(sourceUtxo, [
  { address: otcReleaseEscrow.escrowAddress, amountGrains: OTC_RELEASE_AMOUNT },
  { address: otcRefundEscrow.escrowAddress, amountGrains: OTC_REFUND_AMOUNT },
  { address: bridgeReserveEscrow.escrowAddress, amountGrains: BRIDGE_RESERVE_AMOUNT },
]);
const fundingTxid = await rpc('sendrawtransaction', [fundingTxHex]);
await rpc('generate', [1]);

const releaseFunding = await waitForObservation(otcReleaseEscrow.tradeId, `${fundingTxid}:0`);
const refundFunding = await waitForObservation(otcRefundEscrow.tradeId, `${fundingTxid}:1`);
const reserveFunding = await waitForObservation(bridgeReserveEscrow.tradeId, `${fundingTxid}:2`);

const releaseTxHex = createScriptPathSpendTx({
  escrow: otcReleaseEscrow,
  fundingTxid,
  vout: 0,
  amountGrains: OTC_RELEASE_AMOUNT,
  destinationAddress: releaseAddress,
  destinationAmountGrains: OTC_RELEASE_AMOUNT - SPEND_FEE_GRAINS,
  leafKind: 'buyer_seller_release',
  signers: [releaseKeys.buyer, releaseKeys.seller],
});
const releaseTxid = await rpc('sendrawtransaction', [releaseTxHex]);
await rpc('generate', [1]);

while ((await rpc('getblockcount')) < refundLockTime) {
  await rpc('generate', [1]);
}

const refundTxHex = createScriptPathSpendTx({
  escrow: otcRefundEscrow,
  fundingTxid,
  vout: 1,
  amountGrains: OTC_REFUND_AMOUNT,
  destinationAddress: refundAddress,
  destinationAmountGrains: OTC_REFUND_AMOUNT - SPEND_FEE_GRAINS,
  leafKind: 'seller_timeout_refund',
  signers: [refundKeys.seller],
  lockTime: refundLockTime,
  sequence: Transaction.DEFAULT_SEQUENCE - 1,
});
const refundTxid = await rpc('sendrawtransaction', [refundTxHex]);

const reserveReleaseTxHex = createScriptPathSpendTx({
  escrow: bridgeReserveEscrow,
  fundingTxid,
  vout: 2,
  amountGrains: BRIDGE_RESERVE_AMOUNT,
  destinationAddress: bridgeRecipientAddress,
  destinationAmountGrains: BRIDGE_RESERVE_AMOUNT - SPEND_FEE_GRAINS,
  leafKind: 'buyer_seller_release',
  signers: [reserveKeys.buyer, reserveKeys.seller],
});
const reserveReleaseTxid = await rpc('sendrawtransaction', [reserveReleaseTxHex]);
await rpc('generate', [1]);

const releaseWatch = await waitForSpend(otcReleaseEscrow.tradeId, releaseTxid, 'release');
const refundWatch = await waitForSpend(otcRefundEscrow.tradeId, refundTxid, 'refund');
const reserveWatch = await waitForSpend(bridgeReserveEscrow.tradeId, reserveReleaseTxid);

const evidence = {
  generatedAt: new Date().toISOString(),
  startedAt,
  runId,
  network: 'simnet',
  pearlRpcUrl: redactUrl(PEARL_RPC_URL),
  indexerRegisterUrl: redactUrl(INDEXER_REGISTER_URL),
  indexerReadUrl: redactUrl(INDEXER_READ_URL),
  sourceAddress: SOURCE_ADDRESS,
  sourceOutpoint: `${sourceUtxo.txid}:${sourceUtxo.vout}`,
  fundingTxid,
  refundLockTime,
  otcRelease: {
    watchId: otcReleaseEscrow.tradeId,
    escrowAddress: otcReleaseEscrow.escrowAddress,
    releaseAddress,
    fundingOutpoint: `${fundingTxid}:0`,
    fundingObservation: releaseFunding,
    releaseTxid,
    spend: releaseWatch.spends.find((spend) => spend.spendTxid === releaseTxid),
  },
  otcRefund: {
    watchId: otcRefundEscrow.tradeId,
    escrowAddress: otcRefundEscrow.escrowAddress,
    refundAddress,
    fundingOutpoint: `${fundingTxid}:1`,
    fundingObservation: refundFunding,
    refundTxid,
    spend: refundWatch.spends.find((spend) => spend.spendTxid === refundTxid),
  },
  bridgeReserve: {
    watchId: bridgeReserveEscrow.tradeId,
    reserveAddress: bridgeReserveEscrow.escrowAddress,
    signerPolicy: 'simnet low-cap 2-of-3 P2TR script-path reserve; two reserve signers required for release',
    recipientAddress: bridgeRecipientAddress,
    fundingOutpoint: `${fundingTxid}:2`,
    fundingObservation: reserveFunding,
    releaseTxid: reserveReleaseTxid,
    spend: reserveWatch.spends.find((spend) => spend.spendTxid === reserveReleaseTxid),
    deployedIndexerClassifiesExitRelease: reserveWatch.spends.some((spend) => (
      spend.spendTxid === reserveReleaseTxid && spend.classification === 'exit_release'
    )),
  },
};

await mkdir(resolve(REPO_ROOT, 'docs/operations'), { recursive: true });
await writeFile(OUTPUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile(OUTPUT_MD, renderMarkdown(evidence));
console.log(JSON.stringify(evidence, null, 2));

function createMultisigPackage(input) {
  return createPearlMultisigEscrowPackage({
    tradeId: input.tradeId,
    network: 'simnet',
    buyerPubkey: input.keys.buyer.xOnlyPubkeyHex,
    sellerPubkey: input.keys.seller.xOnlyPubkeyHex,
    arbiterPubkey: input.keys.arbiter.xOnlyPubkeyHex,
    expectedAmountGrains: input.expectedAmountGrains,
    requiredConfirmations: 1,
    releaseAddress: input.releaseAddress,
    refundAddress: input.refundAddress,
    refundEligibleAfterHeight: input.refundLockTime,
    createdAt: startedAt,
  });
}

async function registerOtcWatch(escrow, expectedTerminalPath) {
  await registerWatch({
    watch_id: escrow.tradeId,
    purpose: 'otc_escrow',
    network: 'simnet',
    address: escrow.escrowAddress,
    required_confirmations: 1,
    metadata: {
      expected_amount_grains: escrow.expectedAmountGrains,
      pearl_funding_deadline_height: refundLockTime + 50,
      buyer_pearl_address: escrow.releaseTemplate.outputs[0].address,
      seller_pearl_refund_address: escrow.refundTemplate.outputs[0].address,
      release_template: escrow.releaseTemplate,
      refund_template: escrow.refundTemplate,
      expected_terminal_path: expectedTerminalPath,
      taproot_output_script_hex: escrow.keys.taprootOutputScriptHex,
      internal_key_policy: escrow.keys.internalKeyPolicy,
    },
  });
}

async function registerBridgeReserveWatch(escrow) {
  await registerWatch({
    watch_id: escrow.tradeId,
    purpose: 'bridge_reserve',
    network: 'simnet',
    address: escrow.escrowAddress,
    required_confirmations: 1,
    metadata: {
      custody_tier: 'hot',
      active_from_height: tipAtStart,
      active_to_height: null,
      reserve_address: escrow.escrowAddress,
      release_signer_policy: '2-of-3 P2TR script path',
      signer_roles: ['reserve_signer_a', 'reserve_signer_b', 'reserve_signer_c'],
      taproot_output_script_hex: escrow.keys.taprootOutputScriptHex,
      internal_key_policy: escrow.keys.internalKeyPolicy,
    },
  });
}

async function registerWatch(body) {
  const response = await fetch(`${INDEXER_REGISTER_URL}/watches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`register watch ${body.watch_id} failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function waitForObservation(watchId, outpoint) {
  const watch = await waitForWatch(watchId, (candidate) => (
    candidate.observations?.some((observation) => (
      observation.outpoint === outpoint &&
      (observation.matchStatus === 'confirmed' || observation.matchStatus === 'spent')
    ))
  ));
  return watch.observations.find((observation) => observation.outpoint === outpoint);
}

async function waitForSpend(watchId, txid, classification) {
  return waitForWatch(watchId, (candidate) => (
    candidate.spends?.some((spend) => (
      spend.spendTxid === txid &&
      (classification === undefined || spend.classification === classification)
    ))
  ));
}

async function waitForWatch(watchId, predicate) {
  const deadline = Date.now() + 90_000;
  let last;
  while (Date.now() < deadline) {
    const response = await fetch(`${INDEXER_READ_URL}/watches/${encodeURIComponent(watchId)}`);
    if (response.ok) {
      last = await response.json();
      if (predicate(last)) return last;
    }
    await delay(1_000);
  }
  throw new Error(`timed out waiting for watch ${watchId}: ${JSON.stringify(last)}`);
}

async function selectSourceUtxo(minAmountGrains) {
  const tip = await rpc('getblockcount');
  const outputs = [];
  const spent = new Set();
  for (let height = 0; height <= tip; height += 1) {
    const hash = await rpc('getblockhash', [height]);
    const block = await rpc('getblock', [hash, 2]);
    for (const tx of block.rawtx ?? []) {
      for (const input of tx.vin ?? []) {
        if (input.txid !== undefined && input.vout !== undefined) {
          spent.add(`${input.txid}:${input.vout}`);
        }
      }
      for (const output of tx.vout ?? []) {
        if (output.scriptPubKey?.address !== SOURCE_ADDRESS) continue;
        outputs.push({
          txid: tx.txid,
          vout: output.n,
          height,
          amountGrains: Math.round(Number(output.value) * 100_000_000),
          scriptPubKeyHex: output.scriptPubKey.hex,
        });
      }
    }
  }
  const mature = outputs
    .filter((output) => output.height <= tip - 100)
    .filter((output) => !spent.has(`${output.txid}:${output.vout}`))
    .filter((output) => output.amountGrains >= minAmountGrains)
    .sort((a, b) => b.amountGrains - a.amountGrains);
  if (mature.length === 0) {
    throw new Error(`no mature source UTXO at ${SOURCE_ADDRESS} for ${minAmountGrains} grains`);
  }
  return mature[0];
}

function createFundingTx(sourceUtxo, outputs) {
  const totalOutput = outputs.reduce((sum, output) => sum + output.amountGrains, 0);
  const change = sourceUtxo.amountGrains - totalOutput - FUNDING_FEE_GRAINS;
  if (change <= 0) throw new Error('source UTXO does not cover funding outputs and fee');
  const psbt = new Psbt({ network: NETWORK });
  psbt.setVersion(2);
  psbt.addInput({
    hash: sourceUtxo.txid,
    index: sourceUtxo.vout,
    witnessUtxo: {
      script: Buffer.from(SOURCE_OUTPUT_SCRIPT, 'hex'),
      value: sourceUtxo.amountGrains,
    },
    tapInternalKey: Buffer.from(SOURCE_INTERNAL_PUBKEY, 'hex'),
  });
  for (const output of outputs) {
    psbt.addOutput({ address: output.address, value: output.amountGrains });
  }
  psbt.addOutput({ address: SOURCE_ADDRESS, value: change });
  psbt.signTaprootInput(0, createKeyPathSigner(SOURCE_PRIVATE_KEY));
  psbt.finalizeAllInputs();
  return psbt.extractTransaction(true).toHex();
}

function createScriptPathSpendTx(input) {
  const leaf = input.escrow.keys.taprootScriptLeaves?.find((candidate) => candidate.kind === input.leafKind);
  if (!leaf?.scriptHex || !leaf.controlBlockHex || leaf.leafVersion === undefined) {
    throw new Error(`missing Taproot leaf metadata for ${input.leafKind}`);
  }
  const psbt = new Psbt({ network: NETWORK });
  psbt.setVersion(2);
  if (input.lockTime !== undefined) psbt.setLocktime(input.lockTime);
  psbt.addInput({
    hash: input.fundingTxid,
    index: input.vout,
    sequence: input.sequence,
    witnessUtxo: {
      script: Buffer.from(input.escrow.keys.taprootOutputScriptHex, 'hex'),
      value: input.amountGrains,
    },
    tapInternalKey: Buffer.from(input.escrow.keys.internalPubkeyHex, 'hex'),
    tapLeafScript: [{
      leafVersion: leaf.leafVersion,
      script: Buffer.from(leaf.scriptHex, 'hex'),
      controlBlock: Buffer.from(leaf.controlBlockHex, 'hex'),
    }],
  });
  psbt.addOutput({
    address: input.destinationAddress,
    value: input.destinationAmountGrains,
  });
  for (const signer of input.signers) {
    psbt.signTaprootInput(0, createScriptSigner(signer.privateKey));
  }
  psbt.finalizeTaprootInput(0);
  return psbt.extractTransaction(true).toHex();
}

function createKeyPathSigner(privateKey) {
  const pubkey = Buffer.from(ecc.pointFromScalar(privateKey, true));
  const xOnly = pubkey.subarray(1);
  const evenPrivateKey = pubkey[0] === 0x03 ? Buffer.from(ecc.privateNegate(privateKey)) : privateKey;
  const tweakedPrivateKey = Buffer.from(ecc.privateAdd(evenPrivateKey, bip341.tapTweakHash(xOnly)));
  const tweakedPublicKey = Buffer.from(ecc.pointFromScalar(tweakedPrivateKey, true));
  return createSigner(tweakedPrivateKey, tweakedPublicKey);
}

function createScriptSigner(privateKey) {
  return createSigner(privateKey, Buffer.from(ecc.pointFromScalar(privateKey, true)));
}

function createSigner(privateKey, publicKey) {
  return {
    publicKey,
    sign(hash) {
      return Buffer.from(ecc.sign(hash, privateKey));
    },
    signSchnorr(hash) {
      return Buffer.from(ecc.signSchnorr(hash, privateKey));
    },
  };
}

function createRoleKeys() {
  return {
    buyer: createRandomKey(),
    seller: createRandomKey(),
    arbiter: createRandomKey(),
  };
}

function createRandomKey() {
  let privateKey;
  do {
    privateKey = randomBytes(32);
  } while (!ecc.isPrivate(privateKey));
  return {
    privateKey,
    xOnlyPubkeyHex: xOnlyPublicKeyFromPrivateKey(privateKey),
  };
}

function createRandomP2trAddress() {
  return createPearlP2trPayment({
    network: 'simnet',
    internalPubkey: createRandomKey().xOnlyPubkeyHex,
  }).address;
}

function xOnlyPublicKeyFromPrivateKey(privateKey) {
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error('invalid private key');
  return Buffer.from(publicKey).subarray(1).toString('hex');
}

function parsePrivateKeyHex(value) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('PEARL_SIMNET_SOURCE_PRIVATE_KEY_HEX must be a 32-byte hex private key');
  }
  const privateKey = Buffer.from(normalized, 'hex');
  if (!ecc.isPrivate(privateKey)) {
    throw new Error('PEARL_SIMNET_SOURCE_PRIVATE_KEY_HEX is not a valid secp256k1 private key');
  }
  return privateKey;
}

async function rpc(method, params = []) {
  const response = await fetch(PEARL_RPC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${PEARL_RPC_USER}:${PEARL_RPC_PASS}`).toString('base64')}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: method, method, params }),
  });
  if (!response.ok) {
    throw new Error(`Pearl RPC ${method} failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`Pearl RPC ${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  }
  return body.result;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

function renderMarkdown(evidence) {
  return `# Pearl Multisig Funded Simnet Evidence - 2026-05-19

This run proves funded Pearl simnet Taproot script-path custody for OTC release,
OTC timeout refund, and a bridge reserve release using the exposed KaspaCom
simnet node and indexer.

## Environment

- Pearl RPC: \`${evidence.pearlRpcUrl}\`
- Indexer read API: \`${evidence.indexerReadUrl}\`
- Indexer watch registration API: \`${evidence.indexerRegisterUrl}\`
- Source fixture address: \`${evidence.sourceAddress}\`
- Source outpoint: \`${evidence.sourceOutpoint}\`
- Funding txid: \`${evidence.fundingTxid}\`
- Refund locktime: \`${evidence.refundLockTime}\`

## OTC Release

- Watch ID: \`${evidence.otcRelease.watchId}\`
- Escrow address: \`${evidence.otcRelease.escrowAddress}\`
- Funding outpoint: \`${evidence.otcRelease.fundingOutpoint}\`
- Release txid: \`${evidence.otcRelease.releaseTxid}\`
- Indexer classification: \`${evidence.otcRelease.spend?.classification}\`

## OTC Refund

- Watch ID: \`${evidence.otcRefund.watchId}\`
- Escrow address: \`${evidence.otcRefund.escrowAddress}\`
- Funding outpoint: \`${evidence.otcRefund.fundingOutpoint}\`
- Refund txid: \`${evidence.otcRefund.refundTxid}\`
- Indexer classification: \`${evidence.otcRefund.spend?.classification}\`

## Bridge Reserve

- Watch ID: \`${evidence.bridgeReserve.watchId}\`
- Reserve address: \`${evidence.bridgeReserve.reserveAddress}\`
- Signer policy: ${evidence.bridgeReserve.signerPolicy}
- Release txid: \`${evidence.bridgeReserve.releaseTxid}\`
- Indexer classification: \`${evidence.bridgeReserve.spend?.classification}\`
- Deployed indexer has current \`exit_release\` classifier:
  \`${evidence.bridgeReserve.deployedIndexerClassifiesExitRelease}\`

## Result

- OTC release path: funded and spent through buyer/seller script-path signatures.
- OTC timeout refund path: funded and spent through seller timeout leaf after CLTV.
- Bridge reserve path: funded and spent through 2-of-3 script-path signatures;
  the deployed simnet indexer observed the spend. If the classification above
  is \`unknown_spend\`, the deployed scanner is older than the repo code that
  classifies \`bridge_reserve\` spends as \`exit_release\`.

Machine-readable evidence is in
[pearl-multisig-funded-simnet-evidence-20260519.json](./pearl-multisig-funded-simnet-evidence-20260519.json).
`;
}
