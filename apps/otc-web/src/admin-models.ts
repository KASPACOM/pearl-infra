import type { TradeState } from '@kaspacom/pearl-sdk';

import type {
  AdminTradeDebugDetail,
  AdminTradeSummary,
  OtcSideEffect,
  OtcSideEffectStatus,
  SupportAlertSeverity,
} from './otc-api-client.js';

export type AdminStateFilter = 'all' | TradeState;
export type AdminSeverityFilter = 'all' | SupportAlertSeverity;
export type AdminDeliveryStatusFilter = 'all' | OtcSideEffectStatus;

export const DEFAULT_ADMIN_LIST_LIMIT = 25;

export const ADMIN_STATE_FILTERS: Array<{ value: AdminStateFilter; label: string }> = [
  { value: 'all', label: 'All states' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'pearl_escrow_pending', label: 'Awaiting PRL' },
  { value: 'pearl_escrow_confirmed', label: 'PRL confirmed' },
  { value: 'usdc_escrow_pending', label: 'Awaiting USDC' },
  { value: 'usdc_escrow_confirmed', label: 'Both legs confirmed' },
  { value: 'release_pending', label: 'Release pending' },
  { value: 'released', label: 'Released' },
  { value: 'refund_available', label: 'Refund available' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed_manual_review', label: 'Manual review' },
  { value: 'late_prl_funding', label: 'Late PRL funding' },
  { value: 'usdc_refunded', label: 'USDC refunded' },
  { value: 'prl_release_failed', label: 'PRL release failed' },
  { value: 'amount_mismatch', label: 'Amount mismatch' },
  { value: 'reorged', label: 'Reorged' },
  { value: 'stale_indexer', label: 'Stale indexer' },
  { value: 'unknown_spend', label: 'Unknown spend' },
];

export const ADMIN_SEVERITY_FILTERS: Array<{ value: AdminSeverityFilter; label: string }> = [
  { value: 'all', label: 'All alert severities' },
  { value: 'info', label: 'Info alerts' },
  { value: 'warning', label: 'Warning alerts' },
  { value: 'critical', label: 'Critical alerts' },
];

export const ADMIN_DELIVERY_STATUS_FILTERS: Array<{ value: AdminDeliveryStatusFilter; label: string }> = [
  { value: 'all', label: 'Any delivery status' },
  { value: 'prepared', label: 'Prepared' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'failed', label: 'Failed' },
];

export interface AdminTradeRowModel {
  tradeId: string;
  state: TradeState;
  amountPrl: string;
  amountUsdc: string;
  updatedLabel: string;
  indicators: AdminIndicatorModel[];
  blockerSummary: string;
}

export interface AdminIndicatorModel {
  key: string;
  label: string;
  tone: 'ok' | 'warning' | 'danger';
}

export interface AlertDeliveryModel {
  key: string;
  status: OtcSideEffect['status'];
  label: string;
  updatedAt: string;
  error?: string;
  supportAlertId?: string;
  canReplay: boolean;
}

export function buildAdminTradeRow(summary: AdminTradeSummary): AdminTradeRowModel {
  return {
    tradeId: summary.tradeId,
    state: summary.state,
    amountPrl: summary.amountPrl,
    amountUsdc: summary.amountUsdc,
    updatedLabel: formatAge(summary.updatedAgeMs),
    indicators: buildIndicators(summary),
    blockerSummary: summary.currentBlockers.length > 0 ? summary.currentBlockers.slice(0, 2).join(', ') : 'none',
  };
}

export function buildAlertDeliveries(detail?: AdminTradeDebugDetail): AlertDeliveryModel[] {
  if (!detail) {
    return [];
  }
  return detail.sideEffects
    .filter((effect) => effect.effectType === 'support_alert_delivery')
    .map((effect) => ({
      key: effect.idempotencyKey,
      status: effect.status,
      label: effect.status === 'failed' ? 'Delivery failed' : effect.status === 'confirmed' ? 'Delivered' : 'Delivery pending',
      updatedAt: effect.updatedAt,
      error: readStringMetadata(effect.metadata, 'error'),
      supportAlertId: readStringMetadata(effect.metadata, 'supportAlertIdempotencyKey'),
      canReplay: effect.status === 'failed' && Boolean(readStringMetadata(effect.metadata, 'supportAlertIdempotencyKey')),
    }));
}

function buildIndicators(summary: AdminTradeSummary): AdminIndicatorModel[] {
  const indicators: AdminIndicatorModel[] = [];
  if (summary.manualReview) {
    indicators.push({ key: 'manual-review', label: 'Manual review', tone: 'danger' });
  }
  if (summary.alertCount > 0) {
    const severity = summary.latestAlertSeverity ? `${summary.latestAlertSeverity} ` : '';
    indicators.push({ key: 'alerts', label: `${summary.alertCount} ${severity}alert${summary.alertCount === 1 ? '' : 's'}`, tone: alertTone(summary.latestAlertSeverity) });
  }
  if (summary.alertDeliveryStatus) {
    indicators.push({
      key: 'delivery-status',
      label: `Delivery ${summary.alertDeliveryStatus}`,
      tone: summary.alertDeliveryStatus === 'failed' ? 'danger' : summary.alertDeliveryStatus === 'confirmed' ? 'ok' : 'warning',
    });
  }
  if (summary.failedSideEffectCount > 0) {
    indicators.push({ key: 'failed-effects', label: `${summary.failedSideEffectCount} failed effect${summary.failedSideEffectCount === 1 ? '' : 's'}`, tone: 'danger' });
  }
  if (summary.deadlineBreaches.length > 0) {
    indicators.push({ key: 'deadline', label: 'Deadline breach', tone: 'danger' });
  }
  if (summary.currentBlockers.length > 0) {
    indicators.push({ key: 'blockers', label: `${summary.currentBlockers.length} blocker${summary.currentBlockers.length === 1 ? '' : 's'}`, tone: 'warning' });
  }
  if (indicators.length === 0) {
    indicators.push({ key: 'clear', label: 'No blockers', tone: 'ok' });
  }
  return indicators;
}

function alertTone(severity?: SupportAlertSeverity): AdminIndicatorModel['tone'] {
  if (severity === 'critical') {
    return 'danger';
  }
  if (severity === 'warning') {
    return 'warning';
  }
  return 'warning';
}

function formatAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function readStringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}
