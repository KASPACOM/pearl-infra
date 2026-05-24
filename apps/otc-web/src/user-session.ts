import type { AcceptQuoteRequest } from './otc-api-client.js';
import type { OtcUser } from './otc-api-client.js';
import { getBrowserSearch } from './routing.js';

const USER_STORAGE_KEY = 'oysters.otc.user';
const REFERRAL_STORAGE_KEY = 'oysters.otc.referral';
const ORDER_QUOTE_DRAFT_PREFIX = 'oysters.otc.orderQuote.';

export interface OrderQuoteDraft {
  quoteId: string;
  orderId: string;
  makerRole: 'buyer' | 'seller';
  acceptPrefill: Partial<AcceptQuoteRequest>;
}

export function readStoredUser(): OtcUser | undefined {
  if (typeof window === 'undefined' || !('localStorage' in window)) return undefined;
  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as OtcUser;
  } catch {
    return undefined;
  }
}

export function storeUser(user: OtcUser): void {
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  }
}

export function readStoredReferralCode(): string | undefined {
  if (typeof window === 'undefined' || !('localStorage' in window)) return undefined;
  const fromUrl = new URLSearchParams(getBrowserSearch()).get('ref')?.trim();
  if (fromUrl) {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  return window.localStorage.getItem(REFERRAL_STORAGE_KEY)?.trim() || undefined;
}

export function storeOrderQuoteDraft(draft: OrderQuoteDraft): void {
  if (typeof window !== 'undefined' && 'sessionStorage' in window) {
    window.sessionStorage.setItem(`${ORDER_QUOTE_DRAFT_PREFIX}${draft.quoteId}`, JSON.stringify(draft));
  }
}

export function readOrderQuoteDraft(quoteId: string | undefined): OrderQuoteDraft | undefined {
  if (!quoteId || typeof window === 'undefined' || !('sessionStorage' in window)) return undefined;
  const raw = window.sessionStorage.getItem(`${ORDER_QUOTE_DRAFT_PREFIX}${quoteId}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as OrderQuoteDraft;
  } catch {
    return undefined;
  }
}
