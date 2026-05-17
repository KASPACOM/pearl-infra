import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import { createWatchedAddressHttpServer } from '../src/watched-address-http.ts';
import { MemoryWatchedAddressRepository } from '../src/watched-address-repository.ts';

async function withServer<T>(fn: (baseUrl: string, repo: MemoryWatchedAddressRepository) => Promise<T>): Promise<T> {
  const repo = new MemoryWatchedAddressRepository();
  const server = createWatchedAddressHttpServer(repo);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}`, repo);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const sampleBody = {
  watch_id: 'watch-http-1',
  purpose: 'otc_escrow',
  network: 'testnet2',
  address: 'tprl1pwatch1',
  required_confirmations: 6,
  metadata: { expected_amount_grains: '12500000000' },
};

test('GET /healthz returns ok', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('POST /watches returns 201 with the watch on first register', async () => {
  await withServer(async (baseUrl) => {
    const res = await postJson(baseUrl, '/watches', sampleBody);
    assert.equal(res.status, 201);
    const body = (await res.json()) as { watchId: string; status: string };
    assert.equal(body.watchId, 'watch-http-1');
    assert.equal(body.status, 'active');
  });
});

test('POST /watches returns 200 on identical re-register', async () => {
  await withServer(async (baseUrl) => {
    const first = await postJson(baseUrl, '/watches', sampleBody);
    assert.equal(first.status, 201);

    const second = await postJson(baseUrl, '/watches', sampleBody);
    assert.equal(second.status, 200);
    const body = (await second.json()) as { watchId: string };
    assert.equal(body.watchId, 'watch-http-1');
  });
});

test('POST /watches returns 409 with differing_fields on conflict', async () => {
  await withServer(async (baseUrl) => {
    await postJson(baseUrl, '/watches', sampleBody);

    const conflict = await postJson(baseUrl, '/watches', {
      ...sampleBody,
      address: 'tprl1pother',
      required_confirmations: 3,
    });
    assert.equal(conflict.status, 409);
    const body = (await conflict.json()) as { error: string; differing_fields: string[] };
    assert.equal(body.error, 'conflict');
    assert.deepEqual([...body.differing_fields].sort(), ['address', 'required_confirmations']);
  });
});

test('POST /watches returns 400 on missing required field', async () => {
  await withServer(async (baseUrl) => {
    const { purpose, ...withoutPurpose } = sampleBody;
    void purpose;
    const res = await postJson(baseUrl, '/watches', withoutPurpose);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'bad_request');
    assert.match(body.message, /purpose/);
  });
});

test('POST /watches returns 400 on invalid enum value', async () => {
  await withServer(async (baseUrl) => {
    const res = await postJson(baseUrl, '/watches', { ...sampleBody, purpose: 'not_a_purpose' });
    assert.equal(res.status, 400);
  });
});

test('POST /watches returns 400 on malformed JSON', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/watches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(res.status, 400);
  });
});

test('POST /watches returns 400 when required_confirmations is non-integer', async () => {
  await withServer(async (baseUrl) => {
    const res = await postJson(baseUrl, '/watches', { ...sampleBody, required_confirmations: 'six' });
    assert.equal(res.status, 400);
  });
});

test('GET /watches/:id returns the watch with empty history when fresh', async () => {
  await withServer(async (baseUrl) => {
    await postJson(baseUrl, '/watches', sampleBody);

    const res = await fetch(`${baseUrl}/watches/watch-http-1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { observations: unknown[]; spends: unknown[] };
    assert.deepEqual(body.observations, []);
    assert.deepEqual(body.spends, []);
  });
});

test('GET /watches/:id returns 404 on missing', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/watches/does-not-exist`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'not_found');
  });
});

test('POST /watches/:id/close marks status closed and is idempotent', async () => {
  await withServer(async (baseUrl) => {
    await postJson(baseUrl, '/watches', sampleBody);

    const first = await postJson(baseUrl, '/watches/watch-http-1/close', {});
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { status: string };
    assert.equal(firstBody.status, 'closed');

    const second = await postJson(baseUrl, '/watches/watch-http-1/close', {});
    assert.equal(second.status, 200);
    const secondBody = (await second.json()) as { status: string };
    assert.equal(secondBody.status, 'closed');
  });
});

test('POST /watches/:id/close returns 404 on missing watch', async () => {
  await withServer(async (baseUrl) => {
    const res = await postJson(baseUrl, '/watches/missing/close', {});
    assert.equal(res.status, 404);
  });
});

test('unknown route returns 404 with helpful message', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/totally/unknown`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'not_found');
    assert.match(body.message, /route not found/);
  });
});

test('encoded watch_id with slash is decoded on read', async () => {
  await withServer(async (baseUrl) => {
    await postJson(baseUrl, '/watches', { ...sampleBody, watch_id: 'watch/with/slash' });

    const res = await fetch(`${baseUrl}/watches/${encodeURIComponent('watch/with/slash')}`);
    assert.equal(res.status, 200);
  });
});
