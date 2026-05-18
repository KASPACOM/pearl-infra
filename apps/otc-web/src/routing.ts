import type { QuoteRole } from './page-models.js';

export function getBrowserPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

export function getBrowserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

export function getQuoteIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/quote\/([^/]+)\/accept/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function getTradeIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/trades\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function getQuoteRoleFromSearch(search: string): QuoteRole {
  return new URLSearchParams(search).get('role') === 'seller' ? 'seller' : 'buyer';
}
