import assert from 'node:assert/strict';
import test from 'node:test';

import { getAddress } from 'ethers';

import {
  createEscrowContract,
  createEscrowInterface,
  createUsdcInterface,
  getBaseEscrowFrontendConfig,
  prepareEscrowCreateTradeCall,
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

test('prepares an escrow deposit call with on-chain seller/amount/fee guard', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');
  const expectedSeller = '0x2222222222222222222222222222222222222222';
  const call = prepareEscrowDepositCall(
    { tradeKey: TRADE_KEY, expectedSeller, expectedAmountMicros: '170000000', expectedFeeMicros: '1700000' },
    'base_sepolia',
  );
  const parsed = createEscrowInterface().parseTransaction({ data: call.data });
  const tx = toTransactionRequest(call);

  assert.equal(call.chainId, config.chainId);
  assert.equal(getAddress(call.to), getAddress(config.escrowContract));
  assert.equal(parsed?.name, 'deposit');
  assert.equal(parsed?.args[0], TRADE_KEY);
  assert.equal(getAddress(parsed?.args[1]), getAddress(expectedSeller));
  assert.equal(parsed?.args[2], 170000000n);
  assert.equal(parsed?.args[3], 1700000n);
  assert.equal(tx.chainId, config.chainId);
  assert.equal(tx.to, config.escrowContract);
  assert.equal(tx.data, call.data);
});

test('prepares an operator createTrade call using server-authoritative terms', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');
  const call = prepareEscrowCreateTradeCall(
    {
      tradeKey: TRADE_KEY,
      buyer: '0x3333333333333333333333333333333333333333',
      seller: '0x4444444444444444444444444444444444444444',
      amountMicros: '170000000',
      feeMicros: '1700000',
      expiryUnixSeconds: 1_779_120_900,
    },
    'base_sepolia',
  );
  const parsed = createEscrowInterface().parseTransaction({ data: call.data });

  assert.equal(call.chainId, config.chainId);
  assert.equal(getAddress(call.to), getAddress(config.escrowContract));
  assert.equal(parsed?.name, 'createTrade');
  assert.equal(parsed?.args[0], TRADE_KEY);
  assert.equal(getAddress(parsed?.args[1]), getAddress('0x3333333333333333333333333333333333333333'));
  assert.equal(getAddress(parsed?.args[2]), getAddress('0x4444444444444444444444444444444444444444'));
  assert.equal(parsed?.args[3], 170000000n);
  assert.equal(parsed?.args[4], 1700000n);
  assert.equal(parsed?.args[5], 1_779_120_900n);
});

test('prepares approval and deposit calls from trade-specific API config', () => {
  const callConfig = {
    chainId: 84532,
    usdcToken: '0x5555555555555555555555555555555555555555',
    escrowContract: '0x6666666666666666666666666666666666666666',
  };
  const approval = prepareUsdcApprovalCall('171700000', callConfig);
  const deposit = prepareEscrowDepositCall(
    { tradeKey: TRADE_KEY, expectedSeller: '0x2222222222222222222222222222222222222222', expectedAmountMicros: '170000000', expectedFeeMicros: '1700000' },
    callConfig,
  );
  const parsedApproval = createUsdcInterface().parseTransaction({ data: approval.data });
  const parsedDeposit = createEscrowInterface().parseTransaction({ data: deposit.data });

  assert.equal(approval.chainId, 84532);
  assert.equal(getAddress(approval.to), getAddress(callConfig.usdcToken));
  assert.equal(getAddress(parsedApproval?.args[0]), getAddress(callConfig.escrowContract));
  assert.equal(parsedApproval?.args[1], 171700000n);
  assert.equal(deposit.chainId, 84532);
  assert.equal(getAddress(deposit.to), getAddress(callConfig.escrowContract));
  assert.equal(parsedDeposit?.args[0], TRADE_KEY);
});

test('creates an ethers contract bound to the configured escrow address', () => {
  const config = getBaseEscrowFrontendConfig('base_sepolia');
  const contract = createEscrowContract(null, 'base_sepolia');

  assert.equal(getAddress(String(contract.target)), getAddress(config.escrowContract));
});

test('rejects malformed frontend contract inputs before wallet handoff', () => {
  assert.throws(
    () => prepareEscrowDepositCall({ tradeKey: 'not-bytes32', expectedSeller: '0x2222222222222222222222222222222222222222', expectedAmountMicros: '1', expectedFeeMicros: '0' }),
    /tradeKey must be a 32-byte hex string/,
  );
  assert.throws(() => prepareUsdcApprovalCall('-1'), /amountMicros must be a base-10 integer string/);
  assert.throws(
    () =>
      prepareEscrowCreateTradeCall(
        {
          tradeKey: TRADE_KEY,
          buyer: 'not-address',
          seller: '0x4444444444444444444444444444444444444444',
          amountMicros: '170000000',
          feeMicros: '1700000',
          expiryUnixSeconds: 1_779_120_900,
        },
        'base_sepolia',
      ),
    /buyer must be a valid EVM address/,
  );
  assert.throws(
    () =>
      prepareEscrowDepositCall(
        { tradeKey: TRADE_KEY, expectedSeller: '0x2222222222222222222222222222222222222222', expectedAmountMicros: '1', expectedFeeMicros: '0' },
        {
          chainId: 84532,
          usdcToken: 'not-address',
          escrowContract: '0x6666666666666666666666666666666666666666',
        },
      ),
    /usdcToken must be a valid EVM address/,
  );
});
