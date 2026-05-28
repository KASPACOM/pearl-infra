import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OysterWalletRpcClient,
  OysterWalletSignerClient,
} from '../src/oyster-wallet.ts';

const VALID_TX_HEX = '02000000010000000000000000000000000000000000000000000000000000000000000000ffffffff00ffffffff010000000000000000015100000000';
const VALID_TXID = '249fadff0effc2d439b123dc16df0d55f509e8e6e189be4fd505cac750f2132b';

test('oyster wallet RPC wraps address, balance, funding, and signing calls', async () => {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const wallet = new OysterWalletRpcClient({
    async call<T>(method: string, params: unknown[]): Promise<T> {
      calls.push({ method, params });
      if (method === 'getnewaddress') return 'rprl1pabc' as T;
      if (method === 'getbalance') return 123 as T;
      if (method === 'validateaddress') {
        return {
          isvalid: true,
          address: params[0],
          ismine: true,
          pubkey: '02'.padEnd(66, '1'),
        } as T;
      }
      if (method === 'listunspent') return [] as T;
      if (method === 'sendmany') return 'aa'.repeat(32) as T;
      if (method === 'signrawtransactionwithwallet') return { hex: VALID_TX_HEX, complete: true } as T;
      throw new Error(`unexpected method: ${method}`);
    },
  });

  assert.equal(await wallet.getNewAddress(), 'rprl1pabc');
  assert.equal(await wallet.getBalance('default', 0), 123);
  assert.equal((await wallet.validateAddress('rprl1pabc')).ismine, true);
  assert.deepEqual(await wallet.listUnspent({ minConfirmations: 0, addresses: ['rprl1pabc'] }), []);
  assert.equal(await wallet.sendMany({ outputs: { rprl1pabc: 1.23 }, minConfirmations: 0 }), 'aa'.repeat(32));
  assert.deepEqual(await wallet.signRawTransactionWithWallet(VALID_TX_HEX), {
    hex: VALID_TX_HEX,
    complete: true,
  });

  assert.deepEqual(calls, [
    { method: 'getnewaddress', params: ['default'] },
    { method: 'getbalance', params: ['default', 0] },
    { method: 'validateaddress', params: ['rprl1pabc'] },
    { method: 'listunspent', params: [0, 9999999, ['rprl1pabc']] },
    { method: 'sendmany', params: ['default', { rprl1pabc: 1.23 }, 0.0001, 0, ''] },
    { method: 'signrawtransactionwithwallet', params: [VALID_TX_HEX] },
  ]);
});

test('oyster signer client unlocks, signs, maps the boundary response, and locks', async () => {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const wallet = new OysterWalletRpcClient({
    async call<T>(method: string, params: unknown[]): Promise<T> {
      calls.push({ method, params });
      if (method === 'walletpassphrase' || method === 'walletlock') return undefined as T;
      if (method === 'signrawtransactionwithwallet') return { hex: VALID_TX_HEX, complete: true } as T;
      throw new Error(`unexpected method: ${method}`);
    },
  });
  const signer = new OysterWalletSignerClient(wallet, {
    signerKeyId: 'otc-pearl-simnet-oyster-1',
    passphrase: 'password',
    unlockSeconds: 5,
  });

  const response = await signer.sign({
    tradeId: 'trade-oyster-1',
    action: 'release',
    idempotencyKey: 'pearl:trade-oyster-1:release',
    unsignedTxHex: VALID_TX_HEX,
  });

  assert.equal(response.tradeId, 'trade-oyster-1');
  assert.equal(response.action, 'release');
  assert.equal(response.signedTxHex, VALID_TX_HEX);
  assert.equal(response.signedTxid, VALID_TXID);
  assert.equal(response.signerKeyId, 'otc-pearl-simnet-oyster-1');
  assert.match(response.signedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls, [
    { method: 'walletpassphrase', params: ['password', 5] },
    { method: 'signrawtransactionwithwallet', params: [VALID_TX_HEX] },
    { method: 'walletlock', params: [] },
  ]);
});

test('oyster signer client fails closed when the wallet cannot sign every input', async () => {
  const signer = new OysterWalletSignerClient(
    new OysterWalletRpcClient({
      async call<T>(method: string): Promise<T> {
        if (method === 'signrawtransactionwithwallet') return { hex: VALID_TX_HEX, complete: false } as T;
        throw new Error(`unexpected method: ${method}`);
      },
    }),
    { signerKeyId: 'otc-pearl-simnet-oyster-1' },
  );

  await assert.rejects(
    () => signer.sign({
      tradeId: 'trade-oyster-1',
      action: 'refund',
      idempotencyKey: 'pearl:trade-oyster-1:refund',
      unsignedTxHex: VALID_TX_HEX,
    }),
    /oyster wallet did not sign every input/,
  );
});
