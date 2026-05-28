import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

import type { BridgeStateRepository } from './repository.js';
import type { BridgeAdminDecision } from './types.js';

const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface BridgeHttpOptions {
  adminToken?: string;
}

export interface JsonResponse {
  statusCode: number;
  body: unknown;
}

export function createBridgeHttpServer(repository: BridgeStateRepository, options: BridgeHttpOptions = {}): Server {
  return createServer((request, response) => {
    handleBridgeHttpRequest(repository, request, options)
      .then((result) => writeJson(response, result.statusCode, result.body))
      .catch((error: unknown) => {
        writeJson(response, 400, {
          error: 'bad_request',
          message: error instanceof Error ? error.message : 'bridge request failed',
        });
      });
  });
}

export async function handleBridgeHttpRequest(
  repository: BridgeStateRepository,
  request: IncomingMessage,
  options: BridgeHttpOptions = {},
): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const parts = path.split('/').filter(Boolean);

  if (method === 'GET' && path === '/healthz') {
    return { statusCode: 200, body: { ok: true } };
  }

  if (method === 'GET' && parts.length === 2 && parts[0] === 'bridge' && parts[1] === 'proof') {
    return { statusCode: 200, body: await buildBridgeProof(repository) };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'bridge' && parts[1] === 'exits') {
    const exit = await repository.findExitRequest(parts[2]);
    return exit
      ? { statusCode: 200, body: exit }
      : { statusCode: 404, body: { error: 'not_found', message: `bridge exit not found: ${parts[2]}` } };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'bridge' && parts[1] === 'deposits') {
    const latestSnapshot = await repository.latestReconciliationSnapshot();
    const deposit = latestSnapshot?.snapshot && isRecord(latestSnapshot.snapshot)
      ? readDepositFromSnapshot(latestSnapshot.snapshot, parts[2])
      : undefined;
    return deposit
      ? { statusCode: 200, body: deposit }
      : { statusCode: 404, body: { error: 'not_found', message: `bridge deposit not found: ${parts[2]}` } };
  }

  if (parts[0] === 'bridge' && parts[1] === 'admin') {
    if (!authorizeAdmin(request, options)) {
      return { statusCode: 401, body: { error: 'unauthorized', message: 'bridge admin token required' } };
    }
    return handleAdminRequest(repository, request, parts);
  }

  return {
    statusCode: 404,
    body: {
      error: 'not_found',
      message: `route not found: ${method} ${path}`,
    },
  };
}

async function handleAdminRequest(repository: BridgeStateRepository, request: IncomingMessage, parts: string[]): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  if (method === 'GET' && parts.length === 3 && parts[2] === 'decisions') {
    return { statusCode: 200, body: await repository.listAdminDecisions() };
  }
  if (method === 'POST' && parts.length === 3 && parts[2] === 'decisions') {
    const body = await readJsonBody(request);
    const decision = buildAdminDecision(body);
    return { statusCode: 201, body: await repository.saveAdminDecision(decision) };
  }
  return {
    statusCode: 404,
    body: {
      error: 'not_found',
      message: `bridge admin route not found: ${method} /${parts.join('/')}`,
    },
  };
}

async function buildBridgeProof(repository: BridgeStateRepository): Promise<Record<string, unknown>> {
  const [latestSnapshot, exits, events, decisions] = await Promise.all([
    repository.latestReconciliationSnapshot(),
    repository.listExitRequests(),
    repository.listIgraEvents(),
    repository.listAdminDecisions(),
  ]);
  return {
    latestSnapshot,
    exits,
    events,
    decisions,
  };
}

function buildAdminDecision(raw: unknown): BridgeAdminDecision {
  if (!isRecord(raw)) throw new Error('admin decision body must be an object');
  const kind = requireEnum(raw, 'kind', ['mint', 'exit_release', 'rejection', 'pause_recommendation', 'replay']);
  const targetId = requireString(raw, 'targetId');
  const actor = requireString(raw, 'actor');
  const reason = requireString(raw, 'reason');
  const createdAt = new Date().toISOString();
  const metadata = readMetadata(raw.metadata);
  const idempotencyKey = typeof raw.idempotencyKey === 'string' && raw.idempotencyKey.length > 0
    ? raw.idempotencyKey
    : stableDecisionId('bridge-admin', { kind, targetId, actor, reason });
  return {
    decisionId: stableDecisionId('bridge-decision', { idempotencyKey }),
    kind,
    targetId,
    actor,
    reason,
    idempotencyKey,
    metadata,
    createdAt,
  };
}

function readDepositFromSnapshot(snapshot: Record<string, unknown>, depositId: string): unknown {
  const deposits = snapshot.deposits;
  return Array.isArray(deposits)
    ? deposits.find((deposit) => isRecord(deposit) && deposit.depositId === depositId)
    : undefined;
}

function authorizeAdmin(request: IncomingMessage, options: BridgeHttpOptions): boolean {
  if (!options.adminToken) return true;
  const header = request.headers.authorization;
  return header === `Bearer ${options.adminToken}`;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_JSON_BODY_BYTES) {
        reject(new Error('request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (body.trim() === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a string`);
  return value;
}

function requireEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = requireString(record, key);
  if (!allowed.includes(value as T)) throw new Error(`${key} is invalid`);
  return value as T;
}

function readMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('metadata must be an object');
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean | null] => (
      typeof entry[1] === 'string' ||
      typeof entry[1] === 'number' ||
      typeof entry[1] === 'boolean' ||
      entry[1] === null
    )),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableDecisionId(prefix: string, fields: Record<string, string | number | boolean | null>): string {
  return `${prefix}:${createHash('sha256').update(stableJson(fields)).digest('hex').slice(0, 24)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
