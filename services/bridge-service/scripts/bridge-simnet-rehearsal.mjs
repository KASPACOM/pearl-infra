#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ethers } from 'ethers';

import {
  createDepositBridgeEvent,
  createExitBridgeEvent,
  evaluateBridgeAttestationQuorum,
} from '../dist/attestations.js';
import { IgraBridgeEventPoller, IgraJsonRpcClient, InMemoryIgraBridgeCheckpointStore } from '../dist/igra-poller.js';
import { createBridgePublicProof } from '../dist/proof.js';
import { InMemoryBridgeStateRepository } from '../dist/repository.js';
import { createBridgeReconciliationSnapshot } from '../dist/reconciliation.js';
import { applyReserveSpendMatchesToExits } from '../dist/reserve-spend-applier.js';
import { decideDepositMint, decideExitRelease } from '../dist/relayer-policy.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const CONTRACT_ROOT = resolve(REPO_ROOT, 'contracts/usdc-escrow');
const OUTPUT_JSON = resolve(REPO_ROOT, 'docs/operations/bridge-simnet-rehearsal-evidence-20260519.json');
const OUTPUT_MD = resolve(REPO_ROOT, 'docs/operations/bridge-simnet-rehearsal-evidence-20260519.md');
const RPC_URL = process.env.BRIDGE_REHEARSAL_RPC_URL ?? 'http://127.0.0.1:19545';
const CHAIN_ID = 19416;
const OBSERVED_AT = '2026-05-19T12:00:00.000Z';
const DEPOSIT_AMOUNT = 322_963_140_676n;
const RELEASE_AMOUNT = 322_963_139_676n;
const RESIDUAL_BACKING = DEPOSIT_AMOUNT - RELEASE_AMOUNT;

const PEARL = {
  network: 'simnet',
  depositWatchId: 'bridge-rehearsal-deposit-20260519',
  reserveWatchId: 'bridge-rehearsal-reserve-20260519',
  depositAddress: 'rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v',
  reserveAddress: 'rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v',
  releaseAddress: 'rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye',
  depositTxid: '442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164',
  depositOutpoint: '442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164:0',
  depositBlockHash: '4ad7c6cce159d28b8467a87efd6cfe08beb24785eb8fa0a97686a67a4d581b9e',
  depositHeight: 2,
  releaseTxid: '22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1',
  releaseBlockHash: '549eaf125f7c846b32f2cd21cca2c7500c09f6caacc3f24b8ca89b3c24eff099',
  releaseHeight: 103,
  requiredConfirmations: 1,
  observedConfirmations: 101,
};

const limits = {
  minDepositGrains: '1',
  maxDepositGrains: (DEPOSIT_AMOUNT + 1n).toString(),
  maxExitGrains: (DEPOSIT_AMOUNT + 1n).toString(),
  pilotSupplyCapGrains: (DEPOSIT_AMOUNT + 1n).toString(),
  rollingWindowCapGrains: (DEPOSIT_AMOUNT + 1n).toString(),
  rollingWindowUsedGrains: '0',
};

const quorumPolicy = {
  relayerIds: ['relayer-a', 'relayer-b'],
  requiredAttestations: 2,
};

let anvil;
try {
  execFileSync('npm', ['--workspace', '@kaspacom/prl-usdc-escrow-contracts', 'run', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  anvil = await startAnvil();
  const deployment = await deployContracts();
  const repository = new InMemoryBridgeStateRepository();

  const depositEvent = createDepositBridgeEvent({
    pearlTxid: PEARL.depositTxid,
    vout: 0,
    amountGrains: DEPOSIT_AMOUNT.toString(),
    igraRecipient: deployment.userAddress,
    pearlNetwork: PEARL.network,
    depositWatchId: PEARL.depositWatchId,
    requiredConfirmations: PEARL.requiredConfirmations,
    observedConfirmations: PEARL.observedConfirmations,
  });
  const depositQuorum = approveEvent(depositEvent);
  const depositObservation = {
    outpoint: PEARL.depositOutpoint,
    watchId: PEARL.depositWatchId,
    blockHash: PEARL.depositBlockHash,
    height: PEARL.depositHeight,
    amountGrains: DEPOSIT_AMOUNT.toString(),
    confirmations: PEARL.observedConfirmations,
    matchStatus: 'confirmed',
    classification: 'on_time',
    observedAt: OBSERVED_AT,
  };
  const depositWatch = createDepositWatch(deployment.userAddress, depositEvent, depositQuorum, depositObservation);
  const depositDecision = decideDepositMint({
    watch: depositWatch,
    observation: depositObservation,
    limits,
    mintedSupplyGrains: '0',
    attestationQuorum: depositQuorum,
    manualApprovalId: 'bridge-rehearsal-mint-approval-20260519',
  });
  assert.equal(depositDecision.action, 'prepare_mint');

  const mintReceipt = await (await deployment.bridge
    .connect(deployment.relayer)
    .claimDeposit(`0x${PEARL.depositTxid}`, 0, deployment.userAddress, DEPOSIT_AMOUNT)).wait();
  const mintLog = findEvent(deployment.bridge, mintReceipt, 'DepositClaimed');

  depositWatch.spends.push({
    spendTxid: mintReceipt.hash,
    spentOutpoint: PEARL.depositOutpoint,
    blockHash: mintReceipt.blockHash,
    height: mintReceipt.blockNumber,
    classification: 'claim',
    classificationData: {
      claim_id: mintLog.args.claimId,
      igra_mint_tx_hash: mintReceipt.hash,
    },
    observedAt: OBSERVED_AT,
  });
  depositWatch.metadata.igra_mint_tx_hash = mintReceipt.hash;

  const preExitReserveWatch = createReserveWatch([]);
  const exitReceipt = await (await deployment.bridge
    .connect(deployment.user)
    .requestExit(PEARL.releaseAddress, RELEASE_AMOUNT)).wait();
  const requestedLog = findEvent(deployment.bridge, exitReceipt, 'ExitRequested');
  const pendingExit = {
    exitId: requestedLog.args.exitId,
    igraBurnTxid: exitReceipt.hash,
    igraBurnLogIndex: requestedLog.index,
    igraBurnBlock: exitReceipt.blockNumber,
    igraChainId: CHAIN_ID,
    requestedAmountGrains: RELEASE_AMOUNT.toString(),
    pearlRecipient: PEARL.releaseAddress,
    status: 'pending',
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
  const exitEvent = createExitBridgeEvent({
    exitId: pendingExit.exitId,
    igraBurnTxid: pendingExit.igraBurnTxid,
    igraBurnLogIndex: pendingExit.igraBurnLogIndex,
    igraBurnBlock: pendingExit.igraBurnBlock,
    igraChainId: CHAIN_ID,
    bridgeAddress: deployment.bridgeAddress,
    amountGrains: pendingExit.requestedAmountGrains,
    pearlRecipient: pendingExit.pearlRecipient,
    requiredConfirmations: 1,
    observedConfirmations: 1,
  });
  const exitQuorum = approveEvent(exitEvent);
  const exitPreReleaseReconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [depositWatch],
    reserveWatches: [preExitReserveWatch],
    exits: [],
    mintedSupplyGrains: await tokenSupply(deployment.token),
    now: new Date(OBSERVED_AT),
  });
  const exitDecision = decideExitRelease({
    exit: pendingExit,
    reconciliation: exitPreReleaseReconciliation,
    limits,
    attestationQuorum: exitQuorum,
    manualApprovalId: 'bridge-rehearsal-release-approval-20260519',
  });
  assert.equal(exitDecision.action, 'prepare_exit_release');

  const processReceipt = await (await deployment.bridge
    .connect(deployment.operator)
    .processExit(pendingExit.exitId, `0x${PEARL.releaseTxid}`)).wait();

  const poller = new IgraBridgeEventPoller({
    client: new IgraJsonRpcClient(RPC_URL),
    bridgeAddress: deployment.bridgeAddress,
    chainId: CHAIN_ID,
    eventRepository: repository,
    exitRepository: repository,
    checkpointStore: new InMemoryIgraBridgeCheckpointStore(),
    startBlock: 1,
  });
  const pollResult = await poller.pollOnce(new Date(OBSERVED_AT));
  const mirroredExit = await repository.findExitRequest(pendingExit.exitId);
  assert.equal(mirroredExit?.status, 'processed');
  assert.equal(mirroredExit.pearlReleaseTxid, PEARL.releaseTxid);

  const exitWithMetadata = {
    ...mirroredExit,
    metadata: {
      ...(mirroredExit.metadata ?? {}),
      canonical_event_id: exitEvent.eventId,
      canonical_event_hash: exitEvent.eventHash,
      relayer_attestation_count: exitQuorum.validAttestationCount,
      relayer_quorum_required: exitQuorum.requiredAttestations,
      release_decision_idempotency_key: exitDecision.idempotencyKey,
    },
  };
  await repository.upsertExitRequest(exitWithMetadata);

  const reserveSpend = {
    spendTxid: PEARL.releaseTxid,
    spentOutpoint: PEARL.depositOutpoint,
    blockHash: PEARL.releaseBlockHash,
    height: PEARL.releaseHeight,
    classification: 'exit_release',
    classificationData: {
      amount_grains: RELEASE_AMOUNT.toString(),
      pearl_recipient: PEARL.releaseAddress,
    },
    observedAt: OBSERVED_AT,
  };
  const finalReserveWatch = createReserveWatch([reserveSpend]);
  const spendMatches = await applyReserveSpendMatchesToExits({
    repository,
    spends: [reserveSpend],
    now: new Date(OBSERVED_AT),
  });
  assert.equal(spendMatches[0]?.status, 'matched_exit_release');
  const finalExits = await repository.listExitRequests();
  assert.equal(finalExits[0]?.status, 'released');

  const finalSupply = await tokenSupply(deployment.token);
  assert.equal(finalSupply, RESIDUAL_BACKING.toString());
  const finalReconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [depositWatch],
    reserveWatches: [finalReserveWatch],
    exits: finalExits,
    mintedSupplyGrains: finalSupply,
    now: new Date(OBSERVED_AT),
  });
  assert.deepEqual(finalReconciliation.blockers, []);
  assert.equal(finalReconciliation.reserveDeficitGrains, '0');
  assert.equal(finalReconciliation.reserveSurplusGrains, '0');
  assert.equal(finalReconciliation.reserveAvailableGrains, RESIDUAL_BACKING.toString());

  const publicProof = createBridgePublicProof({
    reconciliation: finalReconciliation,
    depositWatches: [depositWatch],
    exits: finalExits,
  });

  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: 'bridge-simnet-rehearsal',
    limitation: 'Pearl-side txids are reused from the public simnet indexer evidence because this session has no writable pearld RPC or wallet credentials; Igra receipts are fresh local Anvil receipts.',
    pearlEvidence: {
      depositTxid: PEARL.depositTxid,
      depositOutpoint: PEARL.depositOutpoint,
      depositAmountGrains: DEPOSIT_AMOUNT.toString(),
      depositBlockHash: PEARL.depositBlockHash,
      depositHeight: PEARL.depositHeight,
      releaseTxid: PEARL.releaseTxid,
      releaseAmountGrains: RELEASE_AMOUNT.toString(),
      releaseBlockHash: PEARL.releaseBlockHash,
      releaseHeight: PEARL.releaseHeight,
      reserveAddress: PEARL.reserveAddress,
      pearlRecipient: PEARL.releaseAddress,
    },
    igraEvidence: {
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      wrappedPearlAddress: deployment.tokenAddress,
      pearlBridgeAddress: deployment.bridgeAddress,
      mintTxHash: mintReceipt.hash,
      exitRequestTxHash: exitReceipt.hash,
      exitProcessTxHash: processReceipt.hash,
      exitId: pendingExit.exitId,
    },
    policyDecisions: {
      depositMint: depositDecision,
      exitRelease: exitDecision,
    },
    pollResult,
    spendMatches,
    finalReconciliation,
    publicProof,
  };

  await writeJson(OUTPUT_JSON, evidence);
  await writeMarkdown(OUTPUT_MD, evidence);
  console.log(`bridge rehearsal evidence written: ${OUTPUT_JSON}`);
} finally {
  if (anvil) {
    anvil.kill('SIGTERM');
    await delay(250);
  }
}

async function deployContracts() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);
  const [deployer, relayer, operator, user] = await Promise.all([
    provider.getSigner(0),
    provider.getSigner(1),
    provider.getSigner(2),
    provider.getSigner(3),
  ]);
  const [deployerAddress, relayerAddress, operatorAddress, userAddress] = await Promise.all([
    deployer.getAddress(),
    relayer.getAddress(),
    operator.getAddress(),
    user.getAddress(),
  ]);
  const wrappedPearlArtifact = await readArtifact('WrappedPearl.sol/WrappedPearl.json');
  const pearlBridgeArtifact = await readArtifact('PearlBridge.sol/PearlBridge.json');
  const tokenFactory = new ethers.ContractFactory(wrappedPearlArtifact.abi, artifactBytecode(wrappedPearlArtifact), deployer);
  const token = await tokenFactory.deploy(deployerAddress);
  await token.waitForDeployment();

  const caps = [
    1n,
    DEPOSIT_AMOUNT + 1n,
    1n,
    DEPOSIT_AMOUNT + 1n,
    86_400n,
    DEPOSIT_AMOUNT + 1n,
    DEPOSIT_AMOUNT + 1n,
  ];
  const bridgeFactory = new ethers.ContractFactory(pearlBridgeArtifact.abi, artifactBytecode(pearlBridgeArtifact), deployer);
  const bridge = await bridgeFactory.deploy(await token.getAddress(), caps, deployerAddress);
  await bridge.waitForDeployment();
  await (await token.setBridge(await bridge.getAddress())).wait();
  await (await bridge.setRelayer(relayerAddress, true)).wait();
  await (await bridge.setOperator(operatorAddress, true)).wait();

  return {
    provider,
    deployer,
    relayer,
    operator,
    user,
    deployerAddress,
    relayerAddress,
    operatorAddress,
    userAddress,
    token,
    bridge,
    tokenAddress: await token.getAddress(),
    bridgeAddress: await bridge.getAddress(),
  };
}

async function startAnvil() {
  const anvilBin = await findAnvil();
  const child = spawn(anvilBin, ['--host', '127.0.0.1', '--port', '19545', '--chain-id', String(CHAIN_ID), '--silent'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('exit', (code) => {
    if (code !== null && code !== 0) console.error(`anvil exited with code ${code}`);
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return child;
    } catch {
      // wait for the local dev chain to accept connections
    }
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error('anvil did not start');
}

async function findAnvil() {
  const candidates = [
    process.env.ANVIL_BIN,
    '/root/.foundry/bin/anvil',
    'anvil',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    return candidate;
  }
  throw new Error('anvil binary not found');
}

async function readArtifact(path) {
  return JSON.parse(await readFile(resolve(CONTRACT_ROOT, 'out', path), 'utf8'));
}

function artifactBytecode(artifact) {
  if (typeof artifact.bytecode === 'string') return artifact.bytecode;
  return artifact.bytecode?.object;
}

function findEvent(contract, receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return { ...parsed, index: log.index };
    } catch {
      // ignore logs from other contracts
    }
  }
  throw new Error(`event not found in receipt: ${eventName}`);
}

function approveEvent(event) {
  return evaluateBridgeAttestationQuorum({
    event,
    policy: quorumPolicy,
    attestations: quorumPolicy.relayerIds.map((relayerId) => ({
      relayerId,
      eventId: event.eventId,
      eventHash: event.eventHash,
      observedAt: OBSERVED_AT,
    })),
  });
}

function createDepositWatch(igraRecipient, event, quorum, observation) {
  return {
    watchId: PEARL.depositWatchId,
    purpose: 'bridge_deposit',
    network: PEARL.network,
    address: PEARL.depositAddress,
    requiredConfirmations: PEARL.requiredConfirmations,
    status: 'active',
    metadata: {
      expected_amount_min_grains: DEPOSIT_AMOUNT.toString(),
      expected_amount_max_grains: DEPOSIT_AMOUNT.toString(),
      expiry_height: 500,
      igra_recipient: igraRecipient,
      canonical_event_id: event.eventId,
      canonical_event_hash: event.eventHash,
      relayer_attestation_count: quorum.validAttestationCount,
      relayer_quorum_required: quorum.requiredAttestations,
    },
    observations: [observation],
    spends: [],
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
}

function createReserveWatch(spends) {
  return {
    watchId: PEARL.reserveWatchId,
    purpose: 'bridge_reserve',
    network: PEARL.network,
    address: PEARL.reserveAddress,
    requiredConfirmations: PEARL.requiredConfirmations,
    status: 'active',
    metadata: {
      custody_tier: 'hot',
      active_from_height: 0,
    },
    observations: [{
      outpoint: PEARL.depositOutpoint,
      watchId: PEARL.reserveWatchId,
      blockHash: PEARL.depositBlockHash,
      height: PEARL.depositHeight,
      amountGrains: DEPOSIT_AMOUNT.toString(),
      confirmations: PEARL.observedConfirmations,
      matchStatus: spends.length > 0 ? 'spent' : 'confirmed',
      classification: 'reserve_funding',
      observedAt: OBSERVED_AT,
    }],
    spends,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
  };
}

async function tokenSupply(token) {
  return (await token.totalSupply()).toString();
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, jsonReplacer, 2)}\n`, 'utf8');
}

async function writeMarkdown(path, evidence) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `# Bridge Simnet Rehearsal Evidence - 2026-05-19

This rehearsal uses real Pearl simnet txids from the public Pearl indexer and fresh local Anvil receipts for the Igra bridge contracts.

Limitation: this session did not have writable \`pearld\` RPC or wallet credentials, so the Pearl deposit/release txids are reused public simnet evidence rather than newly-created Pearl transactions.

## Pearl Evidence

- Deposit txid: \`${evidence.pearlEvidence.depositTxid}\`
- Deposit outpoint: \`${evidence.pearlEvidence.depositOutpoint}\`
- Deposit amount grains: \`${evidence.pearlEvidence.depositAmountGrains}\`
- Release txid: \`${evidence.pearlEvidence.releaseTxid}\`
- Release amount grains: \`${evidence.pearlEvidence.releaseAmountGrains}\`
- Reserve address: \`${evidence.pearlEvidence.reserveAddress}\`
- Pearl recipient: \`${evidence.pearlEvidence.pearlRecipient}\`

## Igra Evidence

- Chain id: \`${evidence.igraEvidence.chainId}\`
- WrappedPearl: \`${evidence.igraEvidence.wrappedPearlAddress}\`
- PearlBridge: \`${evidence.igraEvidence.pearlBridgeAddress}\`
- Mint tx: \`${evidence.igraEvidence.mintTxHash}\`
- Exit request tx: \`${evidence.igraEvidence.exitRequestTxHash}\`
- Exit process tx: \`${evidence.igraEvidence.exitProcessTxHash}\`
- Exit id: \`${evidence.igraEvidence.exitId}\`

## Results

- Deposit decision: \`${evidence.policyDecisions.depositMint.action}\`
- Exit decision: \`${evidence.policyDecisions.exitRelease.action}\`
- Igra logs read: \`${evidence.pollResult.logsRead}\`
- Spend match: \`${evidence.spendMatches[0]?.status}\`
- Final minted supply grains: \`${evidence.finalReconciliation.mintedSupplyGrains}\`
- Confirmed reserve grains: \`${evidence.finalReconciliation.confirmedReserveGrains}\`
- Known reserve spend grains: \`${evidence.finalReconciliation.knownReserveSpendGrains}\`
- Reserve available grains: \`${evidence.finalReconciliation.reserveAvailableGrains}\`
- Reserve deficit grains: \`${evidence.finalReconciliation.reserveDeficitGrains}\`
- Reserve blockers: \`${evidence.finalReconciliation.blockers.join(', ') || 'none'}\`

Full machine-readable evidence is in [bridge-simnet-rehearsal-evidence-20260519.json](./bridge-simnet-rehearsal-evidence-20260519.json).
`, 'utf8');
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  return value;
}
