import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  PEARL_NETWORKS,
  WATCH_PURPOSES,
  WatchConflictError,
  WatchNotFoundError,
  type PearlNetwork,
  type RegisterWatchInput,
  type WatchPurpose,
} from './watched-address-types.js';
import type { WatchedAddressRepository } from './watched-address-repository.js';

export interface JsonResponse {
  statusCode: number;
  body: unknown;
}

export function createWatchedAddressHttpServer(repo: WatchedAddressRepository): Server {
  return createServer((request, response) => {
    handleWatchedAddressRequest(repo, request)
      .then((result) => writeJson(response, result.statusCode, result.body))
      .catch((error: unknown) => {
        const mapped = mapError(error);
        writeJson(response, mapped.statusCode, mapped.body);
      });
  });
}

export async function handleWatchedAddressRequest(
  repo: WatchedAddressRepository,
  request: IncomingMessage,
): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const parts = path.split('/').filter(Boolean);

  if (method === 'GET' && path === '/healthz') {
    return { statusCode: 200, body: { ok: true } };
  }

  if (method === 'POST' && path === '/watches') {
    const input = parseRegisterInput(await readJsonBody(request));
    const { watch, created } = await repo.register(input);
    return { statusCode: created ? 201 : 200, body: watch };
  }

  if (method === 'GET' && parts.length === 2 && parts[0] === 'watches') {
    const watch = await repo.get(decodeURIComponent(parts[1]));
    if (!watch) {
      return notFound(`no watch for watch_id ${parts[1]}`);
    }
    return { statusCode: 200, body: watch };
  }

  if (method === 'POST' && parts.length === 3 && parts[0] === 'watches' && parts[2] === 'close') {
    const watch = await repo.close(decodeURIComponent(parts[1]));
    return { statusCode: 200, body: watch };
  }

  return {
    statusCode: 404,
    body: { error: 'not_found', message: `route not found: ${method} ${path}` },
  };
}

function parseRegisterInput(body: unknown): RegisterWatchInput {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'bad_request', 'request body must be a JSON object');
  }
  const watchId = requireString(body, 'watch_id');
  const purpose = requireEnum(body, 'purpose', WATCH_PURPOSES) as WatchPurpose;
  const network = requireEnum(body, 'network', PEARL_NETWORKS) as PearlNetwork;
  const address = requireString(body, 'address');
  const requiredConfirmations = requireInt(body, 'required_confirmations', 0, 1_000_000);
  const metadata = body.metadata;
  if (metadata !== undefined && !isPlainObject(metadata)) {
    throw new HttpError(400, 'bad_request', 'metadata must be a JSON object when provided');
  }
  return {
    watchId,
    purpose,
    network,
    address,
    requiredConfirmations,
    metadata: (metadata as Record<string, unknown> | undefined) ?? {},
  };
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'bad_request', `${field} must be a non-empty string`);
  }
  return value;
}

function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = obj[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, 'bad_request', `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function requireInt(obj: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = obj[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, 'bad_request', `${field} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'bad_request', 'request body must be valid JSON');
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function notFound(message: string): JsonResponse {
  return { statusCode: 404, body: { error: 'not_found', message } };
}

class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function mapError(error: unknown): JsonResponse {
  if (error instanceof HttpError) {
    return { statusCode: error.statusCode, body: { error: error.code, message: error.message } };
  }
  if (error instanceof WatchConflictError) {
    return {
      statusCode: 409,
      body: { error: 'conflict', message: error.message, differing_fields: error.differingFields },
    };
  }
  if (error instanceof WatchNotFoundError) {
    return { statusCode: 404, body: { error: 'not_found', message: error.message } };
  }
  const message = error instanceof Error ? error.message : 'unexpected error';
  return { statusCode: 500, body: { error: 'internal_error', message } };
}
