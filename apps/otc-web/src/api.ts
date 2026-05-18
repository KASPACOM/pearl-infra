import { OtcApiClient } from './otc-api-client.js';

export function createOtcClient(): OtcApiClient {
  return new OtcApiClient({
    baseUrl: getApiBaseUrl(),
  });
}

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_OTC_API_BASE_URL || '/api';
}

export function createClientRequestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
