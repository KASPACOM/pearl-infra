import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { OtcQuoteSide, TradeState } from '@kaspacom/pearl-sdk';

import type { OtcTradeService } from './trade-service.js';
import type { AdminActorContext, OtcNotificationDeliveryStatus, OtcOrderStatus, OtcSideEffectStatus, OrderBookQuery } from './types.js';

const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface JsonResponse {
  statusCode: number;
  body: unknown;
}

export interface OtcHttpOptions {
  adminToken?: string;
  adminCredentials?: AdminCredential[];
}

export interface AdminCredential {
  token: string;
  actor: string;
  roles: string[];
}

export function createOtcHttpServer(service: OtcTradeService, options: OtcHttpOptions = {}): Server {
  return createServer((request, response) => {
    handleOtcHttpRequest(service, request, options)
      .then((result) => writeJson(response, result.statusCode, result.body))
      .catch((error: unknown) => {
        const mapped = mapError(error);
        writeJson(response, mapped.statusCode, mapped.body);
      });
  });
}

export async function handleOtcHttpRequest(
  service: OtcTradeService,
  request: IncomingMessage,
  options: OtcHttpOptions = {},
): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const parts = path.split('/').filter(Boolean);

  if (method === 'GET' && path === '/healthz') {
    return { statusCode: 200, body: { ok: true } };
  }

  if (parts[0] === 'otc' && parts[1] === 'admin') {
    const adminAuth = authorizeAdminRequest(request, options);
    if ('statusCode' in adminAuth) {
      return adminAuth;
    }
    return handleAdminRequest(service, request, parts, adminAuth);
  }

  if (
    method === 'POST' &&
    parts.length === 4 &&
    parts[0] === 'otc' &&
    parts[1] === 'trades' &&
    parts[3] === 'support-alerts'
  ) {
    return {
      statusCode: 201,
      body: await service.recordSupportAlert(
        parts[2],
        {
          ...(await readJsonBody(request)),
          actor: 'user',
          source: 'user',
        },
        {
          rateLimitKey: getClientRateLimitKey(request),
        },
      ),
    };
  }

  if (method === 'POST' && path === '/otc/quotes') {
    return { statusCode: 201, body: await service.createQuote(await readJsonBody(request)) };
  }

  if (method === 'POST' && path === '/otc/users/wallet-challenges') {
    return { statusCode: 201, body: await service.createWalletChallenge(await readJsonBody(request)) };
  }

  if (method === 'POST' && path === '/otc/users') {
    return { statusCode: 201, body: await service.registerUser(await readJsonBody(request)) };
  }

  if (method === 'GET' && path === '/otc/market/stats') {
    return { statusCode: 200, body: await service.getMarketStats() };
  }

  if (method === 'GET' && path === '/otc/market/recent-trades') {
    const url = new URL(request.url ?? '/', 'http://localhost');
    return { statusCode: 200, body: await service.listRecentTrades(parseOptionalInteger(url.searchParams.get('limit')) ?? 25) };
  }

  if (method === 'GET' && path === '/otc/orders') {
    const url = new URL(request.url ?? '/', 'http://localhost');
    return {
      statusCode: 200,
      body: await service.listOrders({
        side: parseOrderSide(url.searchParams.get('side')),
        status: parseOrderStatus(url.searchParams.get('status')),
        minPrl: url.searchParams.get('min_prl') ?? undefined,
        maxPrl: url.searchParams.get('max_prl') ?? undefined,
        minPrice: url.searchParams.get('min_price') ?? undefined,
        maxPrice: url.searchParams.get('max_price') ?? undefined,
        makerUserId: url.searchParams.get('maker_user_id') ?? undefined,
        sort: parseOrderSort(url.searchParams.get('sort')),
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: parseOptionalInteger(url.searchParams.get('limit')),
      }),
    };
  }

  if (method === 'POST' && path === '/otc/orders') {
    return { statusCode: 201, body: await service.createOrder(await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'orders' && parts[3] === 'quotes') {
    return { statusCode: 201, body: await service.createOrderQuote(parts[2], await readJsonBody(request)) };
  }

  if (method === 'GET' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'users' && parts[2] === 'referrals') {
    return { statusCode: 200, body: await service.resolveReferralCode(parts[3]) };
  }

  if (method === 'POST' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'users' && parts[3] === 'profile') {
    return { statusCode: 200, body: await service.updateUserProfile(parts[2], await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 5 && parts[0] === 'otc' && parts[1] === 'users' && parts[3] === 'email' && parts[4] === 'verification') {
    return { statusCode: 201, body: await service.requestEmailVerification(parts[2], await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 5 && parts[0] === 'otc' && parts[1] === 'users' && parts[3] === 'email' && parts[4] === 'verify') {
    return { statusCode: 200, body: await service.verifyEmail(parts[2], await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'users' && parts[3] === 'notification-preferences') {
    return { statusCode: 200, body: await service.updateNotificationPreferences(parts[2], await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 5 && parts[0] === 'otc' && parts[1] === 'users' && parts[3] === 'notification-preferences' && parts[4] === 'read') {
    return { statusCode: 200, body: await service.getNotificationPreferences(parts[2], await readJsonBody(request)) };
  }

  if (method === 'POST' && path === '/otc/notifications/unsubscribe') {
    return { statusCode: 200, body: await service.unsubscribeNotification(await readJsonBody(request)) };
  }

  if (method === 'POST' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'users' && parts[3] === 'dashboard') {
    return { statusCode: 200, body: await service.getUserDashboard(parts[2], await readJsonBody(request)) };
  }

  if (method === 'GET' && parts.length === 3 && parts[0] === 'otc' && parts[1] === 'quotes') {
    return { statusCode: 200, body: await service.getQuote(parts[2]) };
  }

  if (method === 'GET' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'quotes' && parts[3] === 'order-context') {
    return { statusCode: 200, body: await service.getOrderQuoteAcceptContext(parts[2]) };
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
    method === 'GET' &&
    parts.length === 5 &&
    parts[0] === 'otc' &&
    parts[1] === 'trades' &&
    parts[3] === 'pearl-release' &&
    parts[4] === 'intent'
  ) {
    return { statusCode: 200, body: await service.getPearlReleaseSigningIntent(parts[2]) };
  }

  if (
    method === 'POST' &&
    parts.length === 5 &&
    parts[0] === 'otc' &&
    parts[1] === 'trades' &&
    parts[3] === 'usdc-escrow' &&
    parts[4] === 'create-intent'
  ) {
    const adminAuth = authorizeAdminRequest(request, options);
    if ('statusCode' in adminAuth) {
      return adminAuth;
    }
    requireAdminRole(adminAuth, 'operator');
    return {
      statusCode: 200,
      body: await service.prepareUsdcCreateTrade(parts[2], {
        ...(await readJsonBody(request)),
        actor: adminAuth.actor,
      }),
    };
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
    const adminAuth = authorizeAdminRequest(request, options);
    if ('statusCode' in adminAuth) {
      return adminAuth;
    }
    requireAdminRole(adminAuth, 'operator');
    return {
      statusCode: 201,
      body: await service.recordSideEffect(parts[2], {
        ...(await readJsonBody(request)),
        actor: adminAuth.actor,
      }),
    };
  }

  if (method === 'GET' && parts.length === 4 && parts[0] === 'otc' && parts[1] === 'trades' && parts[3] === 'side-effects') {
    const adminAuth = authorizeAdminRequest(request, options);
    if ('statusCode' in adminAuth) {
      return adminAuth;
    }
    requireAdminRole(adminAuth, 'support_read');
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

async function handleAdminRequest(
  service: OtcTradeService,
  request: IncomingMessage,
  parts: string[],
  admin: AdminActorContext,
): Promise<JsonResponse> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (method === 'GET' && parts.length === 3 && parts[2] === 'trades') {
    requireAdminRole(admin, 'support_read');
    return {
      statusCode: 200,
      body: await service.listAdminTrades({
        state: (url.searchParams.get('state') ?? undefined) as TradeState | undefined,
        manualReviewOnly: url.searchParams.get('manual_review_only') === 'true',
        search: url.searchParams.get('search') ?? undefined,
        severity: parseAlertSeverity(url.searchParams.get('severity')),
        failedSideEffectOnly: url.searchParams.get('failed_side_effect_only') === 'true',
        deadlineBreachedOnly: url.searchParams.get('deadline_breached_only') === 'true',
        blocker: url.searchParams.get('blocker') ?? undefined,
        minUpdatedAgeMs: parseOptionalInteger(url.searchParams.get('min_updated_age_ms')),
        alertDeliveryStatus: parseSideEffectStatus(url.searchParams.get('alert_delivery_status')),
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: parseOptionalInteger(url.searchParams.get('limit')),
      }),
    };
  }

  if (method === 'GET' && parts.length === 4 && parts[2] === 'trades') {
    requireAdminRole(admin, 'support_read');
    return {
      statusCode: 200,
      body: await service.getAdminTradeDebug(parts[3], { redaction: getAdminRedaction(admin) }),
    };
  }

  if (method === 'POST' && parts.length === 5 && parts[2] === 'trades' && parts[4] === 'alerts') {
    requireAdminRole(admin, 'support_write');
    return {
      statusCode: 201,
      body: await service.recordSupportAlert(
        parts[3],
        { ...(await readJsonBody(request)), actor: admin.actor, source: 'operator' },
        { skipRateLimit: true },
      ),
    };
  }

  if (method === 'POST' && parts.length === 5 && parts[2] === 'trades' && parts[4] === 'manual-review') {
    requireAdminRole(admin, 'operator');
    return {
      statusCode: 200,
      body: await service.markManualReview(parts[3], await readJsonBody(request), { actor: admin.actor }),
    };
  }

  if (
    method === 'POST' &&
    parts.length === 7 &&
    parts[2] === 'trades' &&
    parts[4] === 'alerts' &&
    parts[6] === 'replay'
  ) {
    requireAdminRole(admin, 'operator');
    return {
      statusCode: 201,
      body: await service.replaySupportAlertDelivery(parts[3], parts[5], await readJsonBody(request), { actor: admin.actor }),
    };
  }

  if (method === 'GET' && parts.length === 4 && parts[2] === 'notifications' && parts[3] === 'deliveries') {
    requireAdminRole(admin, 'operator');
    return {
      statusCode: 200,
      body: await service.listNotificationDeliveries({
        status: parseNotificationDeliveryStatus(url.searchParams.get('status')),
        limit: parseOptionalInteger(url.searchParams.get('limit')),
      }),
    };
  }

  if (method === 'POST' && parts.length === 5 && parts[2] === 'notifications' && parts[3] === 'deliveries') {
    requireAdminRole(admin, 'operator');
    return {
      statusCode: 200,
      body: await service.updateNotificationDelivery(parts[4], await readJsonBody(request)),
    };
  }

  return {
    statusCode: 404,
    body: {
      error: 'not_found',
      message: `route not found: ${method} /${parts.join('/')}`,
    },
  };
}

function authorizeAdminRequest(request: IncomingMessage, options: OtcHttpOptions): AdminActorContext | JsonResponse {
  const credentials = getAdminCredentials(options);
  if (credentials.length === 0) {
    return {
      statusCode: 503,
      body: {
        error: 'admin_auth_unavailable',
        message: 'admin API token is not configured',
      },
    };
  }
  const token = getBearerToken(request.headers.authorization);
  const credential = token ? credentials.find((candidate) => candidate.token === token) : undefined;
  if (!credential) {
    return {
      statusCode: 401,
      body: {
        error: 'unauthorized',
        message: 'admin authorization is required',
      },
    };
  }
  return { actor: credential.actor, roles: normalizeAdminRoles(credential.roles) };
}

function getAdminCredentials(options: OtcHttpOptions): AdminCredential[] {
  const credentials = [...(options.adminCredentials ?? [])];
  if (!options.adminToken) {
    return credentials;
  }
  return [...credentials, { token: options.adminToken, actor: 'admin', roles: ['admin'] }];
}

export function parseAdminApiTokens(raw: string | undefined): AdminCredential[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [token, actor, roles] = entry.split(':');
      if (!token || !actor || !roles) {
        throw new Error('OTC_ADMIN_API_TOKENS entries must use token:actor:role1,role2 format');
      }
      return { token, actor, roles: roles.split(',').map((role) => role.trim()).filter(Boolean) };
    });
}

function getBearerToken(authorization: string | undefined): string | undefined {
  const prefix = 'Bearer ';
  return authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : undefined;
}

function normalizeAdminRoles(roles: string[]): string[] {
  const expanded = new Set(roles);
  if (expanded.has('admin')) {
    expanded.add('operator');
    expanded.add('support_write');
    expanded.add('support_read');
  }
  if (expanded.has('operator')) {
    expanded.add('support_write');
    expanded.add('support_read');
  }
  if (expanded.has('support_write')) {
    expanded.add('support_read');
  }
  return Array.from(expanded);
}

function requireAdminRole(admin: AdminActorContext, role: string): void {
  if (!admin.roles.includes(role)) {
    throw new HttpError(403, 'forbidden', `admin role required: ${role}`);
  }
}

function getAdminRedaction(admin: AdminActorContext): 'support' | 'operator' | 'admin' {
  if (admin.roles.includes('admin')) return 'admin';
  if (admin.roles.includes('operator')) return 'operator';
  return 'support';
}

function parseOptionalInteger(value: string | null): number | undefined {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseAlertSeverity(value: string | null): 'info' | 'warning' | 'critical' | undefined {
  if (value === 'info' || value === 'warning' || value === 'critical') {
    return value;
  }
  return undefined;
}

function parseSideEffectStatus(value: string | null): OtcSideEffectStatus | undefined {
  if (value === 'prepared' || value === 'submitted' || value === 'confirmed' || value === 'failed') {
    return value;
  }
  return undefined;
}

function parseNotificationDeliveryStatus(value: string | null): OtcNotificationDeliveryStatus | undefined {
  if (value === 'pending' || value === 'sent' || value === 'failed' || value === 'cancelled' || value === 'unsubscribed') {
    return value;
  }
  return undefined;
}

function parseOrderSide(value: string | null): OtcQuoteSide | undefined {
  return value === 'buy_prl' || value === 'sell_prl' ? value : undefined;
}

function parseOrderStatus(value: string | null): OtcOrderStatus | undefined {
  return value === 'open' ||
    value === 'partially_filled' ||
    value === 'filled' ||
    value === 'cancelled' ||
    value === 'expired'
    ? value
    : undefined;
}

function parseOrderSort(value: string | null): OrderBookQuery['sort'] | undefined {
  return value === 'best_price' || value === 'newest' || value === 'largest' ? value : undefined;
}

function getClientRateLimitKey(request: IncomingMessage): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', `request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, 'payload_too_large', `request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
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
  if (message.includes('is required') || message.includes('is invalid')) {
    return { statusCode: 400, body: { error: 'bad_request', message } };
  }
  if (
    message.includes('challenge') ||
    message.includes('signature') ||
    message.includes('blocked until') ||
    message.includes('verified email') ||
    message.includes('verified user wallet') ||
    message.includes('verified Base EVM wallet user')
  ) {
    return { statusCode: 400, body: { error: 'bad_request', message } };
  }
  if (message.includes('deadline passed') || message.includes('terminal')) {
    return { statusCode: 400, body: { error: 'bad_request', message } };
  }
  if (message.includes('rate limit exceeded')) {
    return { statusCode: 429, body: { error: 'rate_limited', message } };
  }
  if (message.includes('unavailable')) {
    return { statusCode: 503, body: { error: 'unavailable', message } };
  }

  return { statusCode: 500, body: { error: 'internal_error', message } };
}
