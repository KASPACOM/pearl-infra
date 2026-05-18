import type { OtcQuote, OtcTrade, PublicTradeProof } from '@kaspacom/pearl-sdk';

export interface CreateQuoteRequest {
  side: 'buy_prl' | 'sell_prl';
  amountPrl: string;
  settlementAsset: 'USDC';
  settlementNetwork: 'base';
  buyerPearlAddress: string;
  usdcRefundAddress: string;
  clientRequestId: string;
}

export interface AcceptQuoteRequest {
  buyerPearlAddress: string;
  buyerUsdcAddress: string;
  sellerPearlRefundAddress: string;
  sellerUsdcReceiveAddress: string;
  clientRequestId: string;
}

export type { PublicTradeProof };

export type OtcSideEffectType =
  | 'usdc_create_trade'
  | 'usdc_deposit_observed'
  | 'usdc_release'
  | 'usdc_refund'
  | 'pearl_release'
  | 'pearl_refund';

export type OtcSideEffectStatus = 'prepared' | 'submitted' | 'confirmed' | 'failed';

export interface OtcSideEffect {
  idempotencyKey: string;
  requestHash?: string;
  tradeId: string;
  effectType: OtcSideEffectType;
  status: OtcSideEffectStatus;
  actor: string;
  sourceEventId?: string;
  txHash?: string;
  outpoint?: string;
  blockNumber?: number;
  blockHash?: string;
  chainId?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PrepareUsdcCreateTradeRequest {
  idempotencyKey: string;
  actor: string;
}

export interface UsdcCreateTradeIntent {
  tradeId: string;
  contract: string;
  chainId: number;
  tradeKey: string;
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  sideEffect: OtcSideEffect;
}

export interface UsdcEscrowVerification {
  tradeId: string;
  verified: boolean;
  depositAllowed: boolean;
  mismatches: string[];
}

export interface RecordSideEffectRequest {
  idempotencyKey: string;
  effectType: OtcSideEffectType;
  status: OtcSideEffectStatus;
  actor: string;
  sourceEventId?: string;
  txHash?: string;
  outpoint?: string;
  blockNumber?: number;
  blockHash?: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
}

export interface OtcApiClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
}

export class OtcApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OtcApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? fetch;
  }

  createQuote(request: CreateQuoteRequest): Promise<OtcQuote> {
    return this.post('/otc/quotes', request);
  }

  acceptQuote(quoteId: string, request: AcceptQuoteRequest): Promise<OtcTrade> {
    return this.post(`/otc/quotes/${encodeURIComponent(quoteId)}/accept`, request);
  }

  getTrade(tradeId: string): Promise<OtcTrade> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}`);
  }

  getProof(tradeId: string): Promise<PublicTradeProof> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/proof`);
  }

  prepareUsdcCreateTrade(tradeId: string, request: PrepareUsdcCreateTradeRequest): Promise<UsdcCreateTradeIntent> {
    return this.post(`/otc/trades/${encodeURIComponent(tradeId)}/usdc-escrow/create-intent`, request);
  }

  verifyUsdcEscrowTerms(tradeId: string): Promise<UsdcEscrowVerification> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/usdc-escrow/verification`);
  }

  listSideEffects(tradeId: string): Promise<OtcSideEffect[]> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/side-effects`);
  }

  recordSideEffect(tradeId: string, request: RecordSideEffectRequest): Promise<OtcSideEffect> {
    return this.post(`/otc/trades/${encodeURIComponent(tradeId)}/side-effects`, request);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, init);
    const payload = await readJson(response);
    if (!response.ok) {
      const message = getErrorMessage(payload) ?? `OTC API request failed with ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text) as unknown;
}

function getErrorMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return undefined;
}
