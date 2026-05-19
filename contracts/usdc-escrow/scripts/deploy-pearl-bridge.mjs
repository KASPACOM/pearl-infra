#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ContractFactory,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  formatEther,
  isAddress,
} from 'ethers';

import { validatePearlBridgeDeploymentReadiness } from './pearl-bridge-readiness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const WRAPPED_PEARL_ARTIFACT = resolve(PACKAGE_ROOT, 'out/WrappedPearl.sol/WrappedPearl.json');
const PEARL_BRIDGE_ARTIFACT = resolve(PACKAGE_ROOT, 'out/PearlBridge.sol/PearlBridge.json');
const DEFAULT_IGRA_GAS_PRICE = 2_000_000_000_001n;

const NETWORKS = {
  local: {
    name: 'local',
    chainId: 19416n,
    defaultRpcUrl: 'http://127.0.0.1:19545',
    mainnet: false,
  },
  galleon: {
    name: 'galleon',
    chainId: 38836n,
    defaultRpcUrl: undefined,
    mainnet: false,
  },
  'igra-mainnet': {
    name: 'igra-mainnet',
    chainId: 38833n,
    defaultRpcUrl: undefined,
    mainnet: true,
  },
};

let anvil;
try {
  const networkName = process.env.PEARL_BRIDGE_DEPLOY_NETWORK ?? 'galleon';
  const networkConfig = NETWORKS[networkName];
  if (!networkConfig) throw new Error(`Unsupported PEARL_BRIDGE_DEPLOY_NETWORK: ${networkName}`);
  validateMainnetEnvironment(networkConfig);
  const mainnetReadinessManifest = readMainnetReadinessManifest(networkConfig);
  if (networkConfig.name === 'local') anvil = await startLocalAnvil(networkConfig);

  const rpcUrl = rpcUrlFor(networkConfig);
  const provider = new JsonRpcProvider(rpcUrl, Number(networkConfig.chainId));
  const chain = await provider.getNetwork();
  if (chain.chainId !== networkConfig.chainId) {
    throw new Error(`RPC chain mismatch for ${networkConfig.name}: expected ${networkConfig.chainId}, got ${chain.chainId}`);
  }

  const { signer: deployer, address: deployerAddress } = await deployerSigner(networkConfig, provider);
  const owner = addressEnv('PEARL_BRIDGE_OWNER') ?? deployerAddress;
  const relayer = addressEnv('PEARL_BRIDGE_RELAYER') ?? await nonMainnetDefault(networkConfig, provider, 'PEARL_BRIDGE_RELAYER', 1);
  const operator = addressEnv('PEARL_BRIDGE_OPERATOR') ?? await nonMainnetDefault(networkConfig, provider, 'PEARL_BRIDGE_OPERATOR', 2);
  const finalOwner = addressEnv('PEARL_BRIDGE_FINAL_OWNER');
  const bridgeCaps = caps();
  validatePearlBridgeDeploymentReadiness({
    network: networkConfig,
    roles: { owner, finalOwner, relayer, operator },
    caps: bridgeCapsObject(bridgeCaps),
    mainnetApproved: process.env.PEARL_BRIDGE_MAINNET_APPROVED,
    mainnetReadyChecklist: process.env.PEARL_BRIDGE_MAINNET_READY_CHECKLIST,
    readinessManifest: mainnetReadinessManifest,
  });

  const deployerBalance = await provider.getBalance(deployerAddress);
  if (deployerBalance === 0n) throw new Error(`deployer ${deployerAddress} has no native gas balance`);

  const wrappedArtifact = readArtifact(WRAPPED_PEARL_ARTIFACT);
  const bridgeArtifact = readArtifact(PEARL_BRIDGE_ARTIFACT);
  const txOverrides = transactionOverrides(networkConfig);
  const evidence = {
    network: networkConfig.name,
    chainId: Number(chain.chainId),
    rpcUrlRedacted: redactedRpcUrl(rpcUrl),
    deployer: deployerAddress,
    deployerBalanceEthBefore: formatEther(deployerBalance),
    owner,
    finalOwner: finalOwner ?? null,
    relayer,
    operator,
    caps: bridgeCaps.map((value) => value.toString()),
    transactions: [],
    startedAt: new Date().toISOString(),
  };

  const wrappedFactory = new ContractFactory(wrappedArtifact.abi, artifactBytecode(wrappedArtifact), deployer);
  const wrappedPearl = await wrappedFactory.deploy(owner, txOverrides);
  const wrappedPearlReceipt = await waitReceipt(wrappedPearl.deploymentTransaction(), 'deploy WrappedPearl', evidence);
  const wrappedPearlAddress = await wrappedPearl.getAddress();

  const bridgeFactory = new ContractFactory(bridgeArtifact.abi, artifactBytecode(bridgeArtifact), deployer);
  const pearlBridge = await bridgeFactory.deploy(wrappedPearlAddress, bridgeCaps, owner, txOverrides);
  const pearlBridgeReceipt = await waitReceipt(pearlBridge.deploymentTransaction(), 'deploy PearlBridge', evidence);
  const pearlBridgeAddress = await pearlBridge.getAddress();

  const ownerSigner = owner.toLowerCase() === deployerAddress.toLowerCase() ? deployer : undefined;
  if (!ownerSigner) {
    throw new Error('PEARL_BRIDGE_OWNER must be the deployer for this first guarded deployment script; transfer to final owner happens after setup');
  }
  await waitReceipt(await wrappedPearl.connect(ownerSigner).setBridge(pearlBridgeAddress, txOverrides), 'set WrappedPearl bridge', evidence);
  await waitReceipt(await pearlBridge.connect(ownerSigner).setRelayer(relayer, true, txOverrides), 'enable bridge relayer', evidence);
  await waitReceipt(await pearlBridge.connect(ownerSigner).setOperator(operator, true, txOverrides), 'enable bridge operator', evidence);

  let ownershipTransferTx = null;
  if (finalOwner && finalOwner.toLowerCase() !== owner.toLowerCase()) {
    await waitReceipt(await wrappedPearl.connect(ownerSigner).transferOwnership(finalOwner, txOverrides), 'start WrappedPearl ownership transfer', evidence);
    await waitReceipt(await pearlBridge.connect(ownerSigner).transferOwnership(finalOwner, txOverrides), 'start PearlBridge ownership transfer', evidence);
    ownershipTransferTx = evidence.transactions.at(-1)?.hash ?? null;
  }

  evidence.wrappedPearl = {
    address: wrappedPearlAddress,
    deployTx: wrappedPearlReceipt.hash,
    owner: await wrappedPearl.owner(),
    pendingOwner: await wrappedPearl.pendingOwner(),
    bridge: await wrappedPearl.bridge(),
  };
  evidence.pearlBridge = {
    address: pearlBridgeAddress,
    deployTx: pearlBridgeReceipt.hash,
    owner: await pearlBridge.owner(),
    pendingOwner: await pearlBridge.pendingOwner(),
    wrappedPearl: await pearlBridge.wrappedPearl(),
    relayerEnabled: await pearlBridge.relayers(relayer),
    operatorEnabled: await pearlBridge.operators(operator),
    entryPaused: await pearlBridge.entryPaused(),
    exitRequestPaused: await pearlBridge.exitRequestPaused(),
    exitProcessingPaused: await pearlBridge.exitProcessingPaused(),
    ownershipTransferTx,
  };
  evidence.completedAt = new Date().toISOString();

  const outputPath = deploymentOutputPath(networkConfig);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, jsonReplacer, 2)}\n`);
  console.log(`Pearl bridge deployment evidence written: ${outputPath}`);
} finally {
  if (anvil) {
    anvil.kill('SIGTERM');
    await delay(250);
  }
}

function rpcUrlFor(networkConfig) {
  const url = process.env.PEARL_BRIDGE_RPC_URL ?? process.env.IGRA_RPC_URL ?? networkConfig.defaultRpcUrl;
  if (!url) throw new Error('Missing PEARL_BRIDGE_RPC_URL or IGRA_RPC_URL');
  return url;
}

async function deployerSigner(networkConfig, provider) {
  const key = process.env.PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY ?? process.env.IGRA_DEPLOYER_KEY;
  if (key) {
    const wallet = new Wallet(key, provider);
    return { signer: new NonceManager(wallet), address: wallet.address };
  }
  if (networkConfig.name === 'local') {
    const signer = await provider.getSigner(0);
    return { signer: new NonceManager(signer), address: await signer.getAddress() };
  }
  throw new Error('Missing PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY or IGRA_DEPLOYER_KEY');
}

function addressEnv(name) {
  const value = process.env[name];
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address`);
  return value;
}

async function nonMainnetDefault(networkConfig, provider, name, signerIndex) {
  if (networkConfig.name === 'local') return provider.getSigner(signerIndex).then((signer) => signer.getAddress());
  throw new Error(`${networkConfig.name} deployment requires explicit ${name}`);
}

function validateMainnetEnvironment(networkConfig) {
  if (!networkConfig.mainnet) return;
  if (process.env.PEARL_BRIDGE_MAINNET_APPROVED !== '1') {
    throw new Error('Igra mainnet deployment requires PEARL_BRIDGE_MAINNET_APPROVED=1');
  }
  if (process.env.PEARL_BRIDGE_MAINNET_READY_CHECKLIST !== '1') {
    throw new Error('Igra mainnet deployment requires PEARL_BRIDGE_MAINNET_READY_CHECKLIST=1');
  }
  requireAddressEnv('PEARL_BRIDGE_FINAL_OWNER');
  requireAddressEnv('PEARL_BRIDGE_RELAYER');
  requireAddressEnv('PEARL_BRIDGE_OPERATOR');
  if (!process.env.PEARL_BRIDGE_MAINNET_READY_FILE) {
    throw new Error('Igra mainnet deployment requires PEARL_BRIDGE_MAINNET_READY_FILE');
  }
}

function requireAddressEnv(name) {
  if (!addressEnv(name)) throw new Error(`Igra mainnet deployment requires ${name}`);
}

function readMainnetReadinessManifest(networkConfig) {
  if (!networkConfig.mainnet) return undefined;
  const path = process.env.PEARL_BRIDGE_MAINNET_READY_FILE;
  const raw = readFileSync(resolve(path), 'utf8');
  return JSON.parse(raw);
}

function caps() {
  return [
    bigintEnv('PEARL_BRIDGE_MIN_DEPOSIT_GRAINS', 1n),
    bigintEnv('PEARL_BRIDGE_MAX_DEPOSIT_GRAINS', 100_000_000n),
    bigintEnv('PEARL_BRIDGE_MIN_EXIT_GRAINS', 1n),
    bigintEnv('PEARL_BRIDGE_MAX_EXIT_GRAINS', 100_000_000n),
    bigintEnv('PEARL_BRIDGE_ROLLING_WINDOW_SECONDS', 86_400n),
    bigintEnv('PEARL_BRIDGE_ROLLING_WINDOW_MINT_CAP_GRAINS', 100_000_000n),
    bigintEnv('PEARL_BRIDGE_PILOT_SUPPLY_CAP_GRAINS', 100_000_000n),
  ];
}

function bridgeCapsObject(values) {
  return {
    minDepositGrains: values[0],
    maxDepositGrains: values[1],
    minExitGrains: values[2],
    maxExitGrains: values[3],
    rollingWindowSeconds: values[4],
    rollingWindowMintCapGrains: values[5],
    pilotSupplyCapGrains: values[6],
  };
}

function bigintEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer`);
  return BigInt(value);
}

function transactionOverrides(networkConfig) {
  if (networkConfig.name === 'local') return {};
  return {
    type: 0,
    gasPrice: bigintEnv('PEARL_BRIDGE_GAS_PRICE_WEI', DEFAULT_IGRA_GAS_PRICE),
  };
}

async function waitReceipt(tx, label, evidence) {
  console.log(`sent ${label}: ${tx.hash}`);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`${label} failed: ${tx.hash}`);
  evidence.transactions.push({
    label,
    hash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    from: tx.from,
    to: tx.to ?? receipt.contractAddress,
  });
  return receipt;
}

async function startLocalAnvil(networkConfig) {
  const anvilBin = process.env.ANVIL_BIN ?? '/root/.foundry/bin/anvil';
  const child = spawn(anvilBin, [
    '--host',
    '127.0.0.1',
    '--port',
    '19545',
    '--chain-id',
    String(networkConfig.chainId),
    '--silent',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(networkConfig.defaultRpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return child;
    } catch {
      // wait for local dev chain
    }
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error('local anvil did not start');
}

function readArtifact(path) {
  if (!existsSync(path)) throw new Error(`Missing artifact: ${path}. Run npm --workspace @kaspacom/prl-usdc-escrow-contracts run build`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function artifactBytecode(artifact) {
  return typeof artifact.bytecode === 'string' ? artifact.bytecode : artifact.bytecode?.object;
}

function deploymentOutputPath(networkConfig) {
  const runId = process.env.PEARL_BRIDGE_DEPLOY_RUN_ID ?? new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return resolve(PACKAGE_ROOT, 'deployments', `${networkConfig.name}-pearl-bridge-${runId}.json`);
}

function redactedRpcUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin;
  } catch {
    return 'unparseable';
  }
}

function jsonReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}
