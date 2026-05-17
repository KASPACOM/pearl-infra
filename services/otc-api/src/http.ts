import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { OtcTradeService } from './trade-service.js';

export interface JsonResponse {
  statusCode: number;
  body: unknown;
}

export function createOtcHttpServer(service: OtcTradeService): Server {
  return createServer((request, response) => {
    handleOtcHttpRequest(service, request)
      .then((result) => writeJson(response, result.statusCode, result.body))
      .catch((error: unknown) => {
        const mapped = mapError(error);
        writeJson(response, mapped.statusCode, mapped.body);
      });
  });
}

export async function handleOtcHttpRequest(service: OtcTradeService, request: IncomingMessage): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const parts = path.split('/').filter(Boolean);

  if (method === 'GET' && path === '/healthz') {
    return { statusCode: 200, body: { ok: true } };
  }

  if (method === 'POST' && path === '/otc/quotes') {
    return { statusCode: 201, body: await service.createQuote(await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'quotes' && parts[3] === 'accept') {
    return { statusCode: 201, body: await service.acceptQuote(parts[2], await readJsonBody(request)) };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'otc' && parts[1] === 'trades') {
    return { statusCode: 200, body: await service.getTrade(parts[2]) };
  }

  if (method === 'GET' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'trades' && parts[3] === 'proof') {
    return { statusCode: 200, body: await service.getPublicProof(parts[2]) };
  }

  if (
    method === 'POST' &&
    parts.length === 5 &&
    parts[0] === 'otc' &&
    parts[1] === 'trades' &&
    parts[3] === 'usdc-escrow' &&
    parts[4] === 'create-intent'
  ) {
    return { statusCode: 200, body: await service.prepareUsdcCreateTrade(parts[2], await readJsonBody(request)) };
  }

  if (
    method === 'GET' &&
    parts.length === 5 &&
    parts[0] === 'otc' &&
    parts[1] === 'trades' &&
    parts[3] === 'usdc-escrow' &&
    parts[4] === 'verification'
  ) {
    return { statusCode: 200, body: await service.verifyUsdcEscrowTerms(parts[2]) };
  }

  if (method === 'POST' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'trades' && parts[3] === 'side-effects') {
    return { statusCode: 201, body: await service.recordSideEffect(parts[2], await readJsonBody(request)) };
  }

  if (method === 'GET' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'trades' && parts[3] === 'side-effects') {
    return { statusCode: 200, body: await service.listSideEffects(parts[2]) };
  }

  return {
    statusCode: 404,
    body: {
      error: 'not_found',
      message: `route not found: ${method} ${path}`,
    },
  };
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body must be valid JSON');
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
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
    return {
      statusCode: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
      },
    };
  }

  const message = error instanceof Error ? error.message : 'unexpected error';
  if (message.includes('not found')) {
    return { statusCode: 404, body: { error: 'not_found', message } };
  }
  if (message.includes('already accepted')) {
    return { statusCode: 409, body: { error: 'conflict', message } };
  }
  if (message.includes('expired') || message.includes('unsupported') || message.includes('not active')) {
    return { statusCode: 400, body: { error: 'bad_request', message } };
  }
  if (message.includes('deadline passed') || message.includes('terminal')) {
    return { statusCode: 400, body: { error: 'bad_request', message } };
  }
  if (message.includes('unavailable')) {
    return { statusCode: 503, body: { error: 'unavailable', message } };
  }

  return { statusCode: 500, body: { error: 'internal_error', message } };
}
