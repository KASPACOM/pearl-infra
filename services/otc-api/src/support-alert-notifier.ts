import type { OtcTrade } from '@kaspacom/pearl-sdk';

import type { AdminTradeDebugDetail, OtcSideEffect } from './types.js';

export interface SupportAlertNotification {
  trade: OtcTrade;
  alert: OtcSideEffect;
  supportSummary: AdminTradeDebugDetail['supportSummary'];
}

export interface SupportAlertNotifier {
  notifySupportAlert(notification: SupportAlertNotification): Promise<void>;
}

export class WebhookSupportAlertNotifier implements SupportAlertNotifier {
  private readonly webhookUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(webhookUrl: string, fetchImpl: typeof fetch = fetch) {
    this.webhookUrl = webhookUrl;
    this.fetchImpl = fetchImpl;
  }

  async notifySupportAlert(notification: SupportAlertNotification): Promise<void> {
    const response = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'pearl_otc_support_alert',
        tradeId: notification.trade.tradeId,
        quoteId: notification.trade.quoteId,
        state: notification.trade.state,
        side: notification.trade.side,
        severity: notification.alert.metadata.severity,
        message: notification.alert.metadata.message,
        source: notification.alert.metadata.source,
        contact: notification.alert.metadata.contact,
        actor: notification.alert.actor,
        supportSummary: notification.supportSummary,
        sideEffectIdempotencyKey: notification.alert.idempotencyKey,
        createdAt: notification.alert.createdAt,
      }),
    });
    if (!response.ok) {
      throw new Error(`support alert webhook failed with HTTP ${response.status}`);
    }
  }
}
