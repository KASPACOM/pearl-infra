import assert from 'node:assert/strict';
import test from 'node:test';

import { hasInjectedEvmWallet, readInjectedEvmWallet, subscribeInjectedEvmWalletChanges, switchInjectedEvmChain } from '../src/evm-wallet.ts';

test('reports no injected wallet during server-side rendering', async () => {
  assert.equal(hasInjectedEvmWallet(), false);
  assert.deepEqual(await readInjectedEvmWallet(), { connected: false });
});

test('reads and switches the injected wallet with hex chain ids', async () => {
  const requests: Array<{ method: string; params?: unknown[] }> = [];
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: {
      ethereum: {
        async request(args: { method: string; params?: unknown[] }) {
          requests.push(args);
          if (args.method === 'eth_accounts') {
            return ['0x3333333333333333333333333333333333333333'];
          }
          if (args.method === 'eth_chainId') {
            return '0x14a34';
          }
          return undefined;
        },
      },
    },
    configurable: true,
  });

  try {
    assert.equal(hasInjectedEvmWallet(), true);
    assert.deepEqual(await readInjectedEvmWallet(), {
      connected: true,
      address: '0x3333333333333333333333333333333333333333',
      chainId: 84532,
    });
    await switchInjectedEvmChain(84532);
    assert.deepEqual(requests.at(-1), {
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x14a34' }],
    });
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
});

test('subscribes to injected wallet account and chain changes', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: {
      ethereum: {
        async request() {
          return undefined;
        },
        on(event: string, listener: (...args: unknown[]) => void) {
          listeners.set(event, listener);
        },
        removeListener(event: string, listener: (...args: unknown[]) => void) {
          if (listeners.get(event) === listener) {
            listeners.delete(event);
          }
        },
      },
    },
    configurable: true,
  });

  try {
    let calls = 0;
    const unsubscribe = subscribeInjectedEvmWalletChanges(() => {
      calls += 1;
    });
    listeners.get('accountsChanged')?.([]);
    listeners.get('chainChanged')?.('0x14a34');
    assert.equal(calls, 2);
    unsubscribe();
    assert.equal(listeners.size, 0);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
});
