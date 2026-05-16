import assert from 'node:assert/strict';
import test from 'node:test';

import { getAddress } from 'ethers';

import {
  createEscrowContract,
  createEscrowInterface,
  createUsdcInterface,
  getBaseEscrowFrontendConfig,
  prepareEscrowDepositCall,
  prepareUsdcApprovalCall,
  toTransactionRequest,
} from '../src/base-escrow-client.ts';

const TRADE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';

test('loads Base Sepolia escrow config from the shared client package', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');

  assert.equal(config.chainId, 84532);
  assert.equal(getAddress(config.usdcToken), getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'));
  assert.equal(getAddress(config.escrowContract), getAddress('0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9'));
  assert.equal(config.requiredConfirmations, 6);
});

test('prepares a USDC approval call for the configured escrow contract', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');
  const call = prepareUsdcApprovalCall('170000000', 'base_sepolia');
  const parsed = createUsdcInterface().parseTransaction({ data: call.data });

  assert.equal(call.chainId, config.chainId);
  assert.equal(getAddress(call.to), getAddress(config.usdcToken));
  assert.equal(parsed?.name, 'approve');
  assert.equal(getAddress(parsed?.args[0]), getAddress(config.escrowContract));
  assert.equal(parsed?.args[1], 170000000n);
});

test('prepares an escrow deposit call using the shared ABI', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');
  const call = prepareEscrowDepositCall(TRADE_KEY, 'base_sepolia');
  const parsed = createEscrowInterface().parseTransaction({ data: call.data });
  const tx = toTransactionRequest(call);

  assert.equal(call.chainId, config.chainId);
  assert.equal(getAddress(call.to), getAddress(config.escrowContract));
  assert.equal(parsed?.name, 'deposit');
  assert.equal(parsed?.args[0], TRADE_KEY);
  assert.equal(tx.chainId, config.chainId);
  assert.equal(tx.to, config.escrowContract);
  assert.equal(tx.data, call.data);
});

test('creates an ethers contract bound to the configured escrow address', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');
  const contract = createEscrowContract(null, 'base_sepolia');

  assert.equal(getAddress(String(contract.target)), getAddress(config.escrowContract));
});

test('rejects malformed frontend contract inputs before wallet handoff', () => {
  assert.throws(() => prepareEscrowDepositCall('not-bytes32'), /tradeKey must be a 32-byte hex string/);
  assert.throws(() => prepareUsdcApprovalCall('-1'), /amountMicros must be a base-10 integer string/);
});
