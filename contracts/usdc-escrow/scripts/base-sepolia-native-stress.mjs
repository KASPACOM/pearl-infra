#!/usr/bin/env node
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  id,
  parseEther,
} from 'ethers';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ESCROW_ARTIFACT_PATH = resolve(__dirname, '../out/PrlUsdcEscrow.sol/PrlUsdcEscrow.json');

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const DEFAULT_RPC_URL = 'https://sepolia.base.org';
const DEFAULT_FEE_RECIPIENT = '0x35C76bF5A701A30629d9706F4c8f77a4a0cA5978';
const CONFIRMATIONS = Number(process.env.USDC_ESCROW_STRESS_CONFIRMATIONS ?? '1');

const erc20Abi = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const escrowReadAbi = [
  'function owner() view returns (address)',
  'function usdcToken() view returns (address)',
  'function trades(bytes32) view returns (address buyer, address seller, uint256 amount, uint256 fee, uint64 expiry, uint8 status)',
  'function paused() view returns (bool)',
];

function envPrivateKey() {
  return process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY
    ?? process.env.DEPLOYER_PRIVATE_KEY
    ?? process.env.IGRA_DEPLOYER_KEY;
}

function requireEnvPrivateKey() {
  const privateKey = envPrivateKey();
  if (!privateKey) {
    throw new Error('Missing BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or IGRA_DEPLOYER_KEY');
  }
  return privateKey;
}

function usdc(amount) {
  return BigInt(Math.round(amount * 1_000_000));
}

function asTradeId(runId, label) {
  return id(`base-sepolia-native-stress:${runId}:${label}`);
}

function jsonReplacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function compactError(error) {
  const message = error?.shortMessage || error?.reason || error?.message || String(error);
  return String(message).split('\n')[0].slice(0, 240);
}

async function latestTimestamp(provider) {
  const block = await provider.getBlock('latest');
  if (!block) throw new Error('missing latest block');
  return Number(block.timestamp);
}

async function waitReceipt(tx, label, evidence) {
  console.log(`sent ${label}: ${tx.hash}`);
  let receipt = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      receipt = await tx.wait(CONFIRMATIONS);
      break;
    } catch (error) {
      lastError = error;
      console.log(`wait retry ${attempt} for ${label}: ${compactError(error)}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 3_000 * attempt));
    }
  }
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed: ${tx.hash}; ${compactError(lastError)}`);
  }
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

async function sendTx(label, promise, evidence) {
  const tx = await promise;
  return waitReceipt(tx, label, evidence);
}

async function expectRevert(label, action, evidence) {
  try {
    const tx = await action();
    await tx.wait(CONFIRMATIONS);
    throw new Error('unexpected success');
  } catch (error) {
    const reason = compactError(error);
    if (reason === 'unexpected success') throw error;
    evidence.expectedReverts.push({ label, reason });
  }
}

async function waitUntilPast(provider, expiry, evidence, label) {
  const startedAt = Date.now();
  while (await latestTimestamp(provider) <= expiry) {
    if (Date.now() - startedAt > 90_000) {
      throw new Error(`Timed out waiting for expiry in ${label}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  }
  evidence.waits.push({ label, expiry, observedTimestamp: await latestTimestamp(provider) });
}

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || DEFAULT_RPC_URL;
  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(`Base Sepolia only; got chain ${network.chainId}`);
  }

  const deployer = new Wallet(requireEnvPrivateKey(), provider);
  const feeRecipient = process.env.USDC_ESCROW_FEE_RECIPIENT || DEFAULT_FEE_RECIPIENT;
  const usdcToken = new Contract(BASE_SEPOLIA_USDC, erc20Abi, deployer);
  const [deployerEthBefore, deployerUsdcBefore, usdcSymbol, usdcDecimals] = await Promise.all([
    provider.getBalance(deployer.address),
    usdcToken.balanceOf(deployer.address),
    usdcToken.symbol(),
    usdcToken.decimals(),
  ]);

  const runId = process.env.USDC_ESCROW_STRESS_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const evidence = {
    runId,
    network: 'base_sepolia',
    chainId: Number(network.chainId),
    rpcUrl,
    nativeUsdc: BASE_SEPOLIA_USDC,
    feeRecipient,
    deployer: deployer.address,
    startedAt: new Date().toISOString(),
    wallets: {},
    transactions: [],
    expectedReverts: [],
    checks: [],
    waits: [],
  };

  const artifact = JSON.parse(readFileSync(ESCROW_ARTIFACT_PATH, 'utf8'));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
  const escrow = await factory.deploy(feeRecipient, BASE_SEPOLIA_USDC);
  await waitReceipt(escrow.deploymentTransaction(), 'deploy stress escrow', evidence);
  const escrowAddress = await escrow.getAddress();
  evidence.escrow = escrowAddress;

  const escrowRead = new Contract(escrowAddress, escrowReadAbi, provider);
  const escrowAsOwner = escrow.connect(deployer);

  const roles = {
    releaseBuyer: Wallet.createRandom().connect(provider),
    buyerRefundBuyer: Wallet.createRandom().connect(provider),
    ownerRefundBuyer: Wallet.createRandom().connect(provider),
    pauseBuyer: Wallet.createRandom().connect(provider),
    parallelBuyerA: Wallet.createRandom().connect(provider),
    parallelBuyerB: Wallet.createRandom().connect(provider),
    stranger: Wallet.createRandom().connect(provider),
    sellerA: Wallet.createRandom().connect(provider),
    sellerB: Wallet.createRandom().connect(provider),
    sellerC: Wallet.createRandom().connect(provider),
  };

  for (const [name, wallet] of Object.entries(roles)) {
    evidence.wallets[name] = wallet.address;
  }

  const gasWallets = [
    roles.releaseBuyer,
    roles.buyerRefundBuyer,
    roles.ownerRefundBuyer,
    roles.pauseBuyer,
    roles.parallelBuyerA,
    roles.parallelBuyerB,
    roles.stranger,
  ];
  for (const [index, wallet] of gasWallets.entries()) {
    await sendTx(`fund gas wallet ${index + 1}`, deployer.sendTransaction({
      to: wallet.address,
      value: parseEther('0.003'),
    }), evidence);
  }

  const buyerFunding = [
    [roles.releaseBuyer, usdc(1.05), 'fund release buyer USDC'],
    [roles.buyerRefundBuyer, usdc(1.15), 'fund buyer-refund buyer USDC'],
    [roles.ownerRefundBuyer, usdc(0.82), 'fund owner-refund buyer USDC'],
    [roles.pauseBuyer, usdc(0.51), 'fund pause buyer USDC'],
    [roles.parallelBuyerA, usdc(0.41), 'fund parallel buyer A USDC'],
    [roles.parallelBuyerB, usdc(0.31), 'fund parallel buyer B USDC'],
  ];
  for (const [wallet, amount, label] of buyerFunding) {
    await sendTx(label, usdcToken.transfer(wallet.address, amount), evidence);
  }

  async function createTrade(label, tradeId, buyer, seller, amount, fee, expiryOffsetSeconds = 3600) {
    const expiry = (await latestTimestamp(provider)) + expiryOffsetSeconds;
    await sendTx(label, escrowAsOwner.createTrade(tradeId, buyer.address, seller.address, amount, fee, expiry), evidence);
    return expiry;
  }

  async function approveAndDeposit(label, tradeId, buyer, total) {
    const buyerUsdc = usdcToken.connect(buyer);
    const buyerEscrow = escrow.connect(buyer);
    await sendTx(`${label}: approve`, buyerUsdc.approve(escrowAddress, total), evidence);
    await sendTx(`${label}: deposit`, buyerEscrow.deposit(tradeId), evidence);
  }

  async function assertTradeStatus(label, tradeId, expectedStatus) {
    const trade = await escrowRead.trades(tradeId);
    const actual = Number(trade.status);
    const passed = actual === expectedStatus;
    evidence.checks.push({ label, passed, actual, expected: expectedStatus });
    if (!passed) {
      throw new Error(`${label}: expected status ${expectedStatus}, got ${actual}`);
    }
  }

  function balanceCheck(label, actual, expected) {
    const passed = actual === expected;
    evidence.checks.push({ label, passed, actual: actual.toString(), expected: expected.toString() });
    if (!passed) throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }

  const releaseTrade = asTradeId(runId, 'release');
  await createTrade('create release trade', releaseTrade, roles.releaseBuyer, roles.sellerA, usdc(1), usdc(0.05));
  await expectRevert('stranger cannot deposit release trade', () => escrow.connect(roles.stranger).deposit(releaseTrade), evidence);
  await approveAndDeposit('release trade', releaseTrade, roles.releaseBuyer, usdc(1.05));
  await expectRevert('stranger cannot release deposited trade', () => escrow.connect(roles.stranger).release(releaseTrade), evidence);
  await sendTx('owner releases release trade', escrowAsOwner.release(releaseTrade), evidence);
  await assertTradeStatus('release trade status', releaseTrade, 3);

  const buyerRefundTrade = asTradeId(runId, 'buyer-refund');
  const buyerRefundExpiry = await createTrade('create buyer refund trade', buyerRefundTrade, roles.buyerRefundBuyer, roles.sellerB, usdc(1.1), usdc(0.05), 20);
  await approveAndDeposit('buyer refund trade', buyerRefundTrade, roles.buyerRefundBuyer, usdc(1.15));
  await expectRevert('buyer cannot refund before expiry', () => escrow.connect(roles.buyerRefundBuyer).refund(buyerRefundTrade), evidence);
  await waitUntilPast(provider, buyerRefundExpiry, evidence, 'buyer refund trade');
  const buyerBalanceBeforeRefund = await usdcToken.balanceOf(roles.buyerRefundBuyer.address);
  await sendTx('buyer refunds after expiry', escrow.connect(roles.buyerRefundBuyer).refund(buyerRefundTrade), evidence);
  const buyerBalanceAfterRefund = await usdcToken.balanceOf(roles.buyerRefundBuyer.address);
  balanceCheck('buyer refund returned amount plus fee', buyerBalanceAfterRefund - buyerBalanceBeforeRefund, usdc(1.15));
  await assertTradeStatus('buyer refund trade status', buyerRefundTrade, 4);

  const ownerRefundTrade = asTradeId(runId, 'owner-refund');
  await createTrade('create owner refund trade', ownerRefundTrade, roles.ownerRefundBuyer, roles.sellerC, usdc(0.8), usdc(0.02));
  await approveAndDeposit('owner refund trade', ownerRefundTrade, roles.ownerRefundBuyer, usdc(0.82));
  await expectRevert('stranger cannot refund before expiry', () => escrow.connect(roles.stranger).refund(ownerRefundTrade), evidence);
  await sendTx('owner refunds before expiry', escrowAsOwner.refund(ownerRefundTrade), evidence);
  await assertTradeStatus('owner refund trade status', ownerRefundTrade, 4);

  await sendTx('pause escrow', escrowAsOwner.pause(), evidence);
  await expectRevert('owner cannot create while paused', () => escrowAsOwner.createTrade(asTradeId(runId, 'paused-create'), roles.pauseBuyer.address, roles.sellerA.address, usdc(0.1), 0, (Math.floor(Date.now() / 1000) + 3600)), evidence);
  await sendTx('unpause escrow', escrowAsOwner.unpause(), evidence);

  const pauseTrade = asTradeId(runId, 'pause-deposit');
  await createTrade('create pause deposit trade', pauseTrade, roles.pauseBuyer, roles.sellerA, usdc(0.5), usdc(0.01));
  await sendTx('pause before deposit', escrowAsOwner.pause(), evidence);
  await expectRevert('buyer cannot deposit while paused', () => escrow.connect(roles.pauseBuyer).deposit(pauseTrade), evidence);
  await sendTx('unpause before deposit', escrowAsOwner.unpause(), evidence);
  await approveAndDeposit('pause trade after unpause', pauseTrade, roles.pauseBuyer, usdc(0.51));
  await sendTx('owner refunds pause trade cleanup', escrowAsOwner.refund(pauseTrade), evidence);
  await assertTradeStatus('pause trade cleanup status', pauseTrade, 4);

  const cancelTrade = asTradeId(runId, 'cancel-expired');
  const cancelExpiry = await createTrade('create cancel trade', cancelTrade, roles.parallelBuyerA, roles.sellerA, usdc(0.1), 0, 20);
  await waitUntilPast(provider, cancelExpiry, evidence, 'cancel trade');
  await sendTx('stranger cancels expired created trade', escrow.connect(roles.stranger).cancelExpired(cancelTrade), evidence);
  await assertTradeStatus('cancel trade status', cancelTrade, 5);

  await expectRevert('cannot reuse released trade id', () => escrowAsOwner.createTrade(releaseTrade, roles.releaseBuyer.address, roles.sellerA.address, usdc(0.1), 0, (Math.floor(Date.now() / 1000) + 3600)), evidence);
  await expectRevert('cannot reuse refunded trade id', () => escrowAsOwner.createTrade(ownerRefundTrade, roles.ownerRefundBuyer.address, roles.sellerC.address, usdc(0.1), 0, (Math.floor(Date.now() / 1000) + 3600)), evidence);
  await expectRevert('cannot reuse cancelled trade id', () => escrowAsOwner.createTrade(cancelTrade, roles.parallelBuyerA.address, roles.sellerA.address, usdc(0.1), 0, (Math.floor(Date.now() / 1000) + 3600)), evidence);

  const parallelReleaseTrade = asTradeId(runId, 'parallel-release');
  const parallelRefundTrade = asTradeId(runId, 'parallel-refund');
  await createTrade('create parallel release trade', parallelReleaseTrade, roles.parallelBuyerA, roles.sellerB, usdc(0.4), usdc(0.01));
  const parallelRefundExpiry = await createTrade('create parallel refund trade', parallelRefundTrade, roles.parallelBuyerB, roles.sellerC, usdc(0.3), usdc(0.01), 20);
  await Promise.all([
    approveAndDeposit('parallel release trade', parallelReleaseTrade, roles.parallelBuyerA, usdc(0.41)),
    approveAndDeposit('parallel refund trade', parallelRefundTrade, roles.parallelBuyerB, usdc(0.31)),
  ]);
  await sendTx('owner releases one parallel trade', escrowAsOwner.release(parallelReleaseTrade), evidence);
  await waitUntilPast(provider, parallelRefundExpiry, evidence, 'parallel refund trade');
  await sendTx('buyer refunds other parallel trade', escrow.connect(roles.parallelBuyerB).refund(parallelRefundTrade), evidence);
  await assertTradeStatus('parallel release status', parallelReleaseTrade, 3);
  await assertTradeStatus('parallel refund status', parallelRefundTrade, 4);

  const escrowBalance = await usdcToken.balanceOf(escrowAddress);
  balanceCheck('escrow final USDC balance is zero', escrowBalance, 0n);

  const [deployerEthAfter, deployerUsdcAfter] = await Promise.all([
    provider.getBalance(deployer.address),
    usdcToken.balanceOf(deployer.address),
  ]);
  evidence.finishedAt = new Date().toISOString();
  evidence.deployerBalances = {
    before: { eth: formatEther(deployerEthBefore), [usdcSymbol]: formatUnits(deployerUsdcBefore, usdcDecimals) },
    after: { eth: formatEther(deployerEthAfter), [usdcSymbol]: formatUnits(deployerUsdcAfter, usdcDecimals) },
  };
  evidence.summary = {
    success: true,
    escrow: escrowAddress,
    txCount: evidence.transactions.length,
    expectedRevertCount: evidence.expectedReverts.length,
    checkCount: evidence.checks.length,
    failedChecks: evidence.checks.filter((check) => !check.passed).length,
  };

  const evidencePath = resolve(__dirname, `../deployments/base-sepolia-native-stress-${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, jsonReplacer, 2) + '\n');

  console.log(JSON.stringify({ evidencePath, summary: evidence.summary }, jsonReplacer, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
