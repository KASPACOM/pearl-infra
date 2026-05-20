import assert from 'node:assert/strict';
import test from 'node:test';

import { getInitialAdminToken, persistAdminToken } from '../dist/api.js';

test('keeps admin token in session storage instead of build-time env', () => {
  const previousWindow = globalThis.window;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    value: {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
    configurable: true,
  });

  try {
    assert.equal(getInitialAdminToken(), '');
    persistAdminToken(' operator-token ');
    assert.equal(getInitialAdminToken(), 'operator-token');
    persistAdminToken('');
    assert.equal(getInitialAdminToken(), '');
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
});
