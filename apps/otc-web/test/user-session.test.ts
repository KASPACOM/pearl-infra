import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureReferralFromUrl,
  readStoredReferralAttribution,
  readStoredReferralCode,
} from '../dist/user-session.js';

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
