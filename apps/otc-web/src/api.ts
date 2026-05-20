import { OtcApiClient } from './otc-api-client.js';

export function createOtcClient(): OtcApiClient {
  return new OtcApiClient({
    baseUrl: getApiBaseUrl(),
  });
}

export function getApiBaseUrl(): string {
  return getViteEnv().VITE_OTC_API_BASE_URL || '/api';
}

export function createClientRequestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const ADMIN_TOKEN_STORAGE_KEY = 'oysters_market_admin_token';

export function getInitialAdminToken(): string {
  return getStoredAdminToken();
}

export function persistAdminToken(token: string): void {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) {
    return;
  }
  const trimmed = token.trim();
  if (trimmed) {
    window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
  } else {
    window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

function getStoredAdminToken(): string {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) {
    return '';
  }
  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
}

function getViteEnv(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
}
