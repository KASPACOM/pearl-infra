import type { AcceptQuoteRequest } from './otc-api-client.js';
import type { OtcUser } from './otc-api-client.js';
import { getBrowserSearch } from './routing.js';

const USER_STORAGE_KEY = 'oysters.otc.user';
const REFERRAL_STORAGE_KEY = 'oysters.otc.referral';
const ORDER_QUOTE_DRAFT_PREFIX = 'oysters.otc.orderQuote.';

export interface StoredReferralAttribution {
  referralCode: string;
  sourceUrl: string;
  capturedAt: string;
}

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
  return readStoredReferralAttribution()?.referralCode;
}

export function readStoredReferralAttribution(): StoredReferralAttribution | undefined {
  if (typeof window === 'undefined' || !('localStorage' in window)) return undefined;
  const captured = captureReferralFromUrl();
  if (captured) return captured;
  const raw = window.localStorage.getItem(REFERRAL_STORAGE_KEY)?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredReferralAttribution>;
    if (typeof parsed.referralCode === 'string' && parsed.referralCode.trim()) {
      return {
        referralCode: parsed.referralCode.trim(),
        sourceUrl: typeof parsed.sourceUrl === 'string' && parsed.sourceUrl.trim() ? parsed.sourceUrl : currentSourceUrl(),
        capturedAt: typeof parsed.capturedAt === 'string' && parsed.capturedAt.trim() ? parsed.capturedAt : new Date().toISOString(),
      };
    }
  } catch {
    return {
      referralCode: raw,
      sourceUrl: currentSourceUrl(),
      capturedAt: new Date().toISOString(),
    };
  }
  return undefined;
}

export function captureReferralFromUrl(): StoredReferralAttribution | undefined {
  if (typeof window === 'undefined' || !('localStorage' in window)) return undefined;
  const fromUrl = new URLSearchParams(getBrowserSearch()).get('ref')?.trim();
  if (fromUrl) {
    const attribution = {
      referralCode: fromUrl,
      sourceUrl: currentSourceUrl(),
      capturedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(attribution));
    return attribution;
  }
  return undefined;
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

export function getLinkedWallets(user: OtcUser): OtcUser['wallets'] {
  return user.wallets?.length ? user.wallets : [user.wallet];
}

export function isEvmWalletLinked(user: OtcUser, address: string): boolean {
  const normalizedAddress = address.trim().toLowerCase();
  return getLinkedWallets(user).some(
    (wallet) => wallet.walletType === 'evm' && wallet.address.toLowerCase() === normalizedAddress,
  );
}

export function getFirstLinkedEvmAddress(user: OtcUser | undefined): string | undefined {
  return user ? getLinkedWallets(user).find((wallet) => wallet.walletType === 'evm')?.address : undefined;
}

function currentSourceUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.location.href || `${window.location.pathname}${window.location.search}`;
}
