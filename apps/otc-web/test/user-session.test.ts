import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureReferralFromUrl,
  getFirstLinkedEvmAddress,
  isEvmWalletLinked,
  readStoredReferralAttribution,
  readStoredReferralCode,
} from '../dist/user-session.js';
import type { OtcUser } from '../dist/otc-api-client.js';

test('captures referral attribution with the original URL and reuses it after navigation', () => {
  const storage = createStorage();
  withWindow('https://oysters.market/quote?ref=PEARL123', storage, () => {
    const captured = captureReferralFromUrl();

    assert.equal(captured?.referralCode, 'PEARL123');
    assert.equal(captured?.sourceUrl, 'https://oysters.market/quote?ref=PEARL123');
    assert.equal(readStoredReferralCode(), 'PEARL123');
  });

  withWindow('https://oysters.market/profile', storage, () => {
    const stored = readStoredReferralAttribution();

    assert.equal(stored?.referralCode, 'PEARL123');
    assert.equal(stored?.sourceUrl, 'https://oysters.market/quote?ref=PEARL123');
  });
});

test('reads legacy stored referral codes as attribution', () => {
  withWindow('https://oysters.market/profile', createStorage(), () => {
    window.localStorage.setItem('oysters.otc.referral', 'LEGACY1');

    const stored = readStoredReferralAttribution();

    assert.equal(stored?.referralCode, 'LEGACY1');
    assert.equal(stored?.sourceUrl, 'https://oysters.market/profile');
  });
});

test('detects linked EVM wallets without treating Pearl wallets as Base addresses', () => {
  const pearlWallet = {
    userId: 'user_1',
    walletType: 'pearl' as const,
    network: 'testnet2',
    address: 'tprl1pprimary',
    verifiedAt: '2026-05-24T00:00:00.000Z',
    createdAt: '2026-05-24T00:00:00.000Z',
  };
  const evmWallet = {
    userId: 'user_1',
    walletType: 'evm' as const,
    network: 'base_sepolia',
    address: '0xAbC0000000000000000000000000000000000000',
    verifiedAt: '2026-05-24T00:00:00.000Z',
    createdAt: '2026-05-24T00:00:00.000Z',
  };
  const pearlOnly = userFixture({
    wallet: pearlWallet,
    wallets: [pearlWallet],
  });
  const evmLinked = userFixture({
    wallet: pearlWallet,
    wallets: [pearlWallet, evmWallet],
  });

  assert.equal(getFirstLinkedEvmAddress(pearlOnly), undefined);
  assert.equal(isEvmWalletLinked(pearlOnly, '0xabc0000000000000000000000000000000000000'), false);
  assert.equal(getFirstLinkedEvmAddress(evmLinked), '0xAbC0000000000000000000000000000000000000');
  assert.equal(isEvmWalletLinked(evmLinked, '0xabc0000000000000000000000000000000000000'), true);
});

function withWindow(url: string, storage: Storage, run: () => void) {
  const previousWindow = globalThis.window;
  const parsed = new URL(url);
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        href: url,
        pathname: parsed.pathname,
        search: parsed.search,
      },
      localStorage: storage,
      sessionStorage: createStorage(),
    },
    configurable: true,
  });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
}

function userFixture(overrides: Partial<OtcUser>): OtcUser {
  const evmWallet = {
    userId: 'user_1',
    walletType: 'evm' as const,
    network: 'base_sepolia',
    address: '0x1111111111111111111111111111111111111111',
    verifiedAt: '2026-05-24T00:00:00.000Z',
    createdAt: '2026-05-24T00:00:00.000Z',
  };
  return {
    userId: 'user_1',
    referralCode: 'REF123',
    wallet: evmWallet,
    wallets: [evmWallet],
    profile: {
      userId: 'user_1',
      notificationEmailEnabled: false,
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
    },
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
