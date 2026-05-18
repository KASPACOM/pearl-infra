import type { OtcTrade } from '@kaspacom/pearl-sdk';

import type { AdminTradeDebugDetail, OtcApiConfig, OtcSideEffect } from './types.js';

export interface SupportAlertNotification {
  trade: OtcTrade;
  alert: OtcSideEffect;
  supportSummary: AdminTradeDebugDetail['supportSummary'];
}

export interface SupportAlertNotifier {
  notifySupportAlert(notification: SupportAlertNotification): Promise<void>;
}

export function createConfiguredSupportAlertNotifier(config: OtcApiConfig): SupportAlertNotifier | undefined {
  const notifiers: SupportAlertNotifier[] = [];
  if (config.supportAlertWebhookUrl) {
    notifiers.push(new WebhookSupportAlertNotifier(config.supportAlertWebhookUrl));
  }
  if (config.supportAlertTelegramBotToken && config.supportAlertTelegramChatId) {
    notifiers.push(
      new TelegramSupportAlertNotifier({
        botToken: config.supportAlertTelegramBotToken,
        chatId: config.supportAlertTelegramChatId,
        messageThreadId: config.supportAlertTelegramMessageThreadId,
      }),
    );
  }
  if (notifiers.length === 0) {
    return undefined;
  }
  if (notifiers.length === 1) {
    return notifiers[0];
  }
  return new CompositeSupportAlertNotifier(notifiers);
}

export class CompositeSupportAlertNotifier implements SupportAlertNotifier {
  private readonly notifiers: SupportAlertNotifier[];

  constructor(notifiers: SupportAlertNotifier[]) {
    this.notifiers = notifiers;
  }

  async notifySupportAlert(notification: SupportAlertNotification): Promise<void> {
    const results = await Promise.allSettled(this.notifiers.map((notifier) => notifier.notifySupportAlert(notification)));
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed.length > 0) {
      throw new Error(`support alert delivery failed for ${failed.length} sink(s): ${failed.map(formatError).join('; ')}`);
    }
  }
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

export interface TelegramSupportAlertNotifierConfig {
  botToken: string;
  chatId: string;
  messageThreadId?: string;
}

export class TelegramSupportAlertNotifier implements SupportAlertNotifier {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly messageThreadId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TelegramSupportAlertNotifierConfig, fetchImpl: typeof fetch = fetch) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.messageThreadId = config.messageThreadId;
    this.fetchImpl = fetchImpl;
  }

  async notifySupportAlert(notification: SupportAlertNotification): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      text: formatTelegramSupportAlert(notification),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (this.messageThreadId) {
      body.message_thread_id = Number(this.messageThreadId);
    }
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`support alert Telegram send failed with HTTP ${response.status}`);
    }
  }
}

function formatTelegramSupportAlert(notification: SupportAlertNotification): string {
  const severity = String(notification.alert.metadata.severity ?? 'unknown').toUpperCase();
  const message = String(notification.alert.metadata.message ?? 'No message supplied');
  const contact = notification.alert.metadata.contact ? `\nContact: ${escapeHtml(String(notification.alert.metadata.contact))}` : '';
  const waitingOn = notification.supportSummary.waitingOn.join(', ');
  return [
    `<b>Pearl OTC ${escapeHtml(severity)} alert</b>`,
    `Trade: <code>${escapeHtml(notification.trade.tradeId)}</code>`,
    `State: <code>${escapeHtml(notification.trade.state)}</code>`,
    `Source: <code>${escapeHtml(String(notification.alert.metadata.source ?? 'unknown'))}</code>`,
    `Waiting on: <code>${escapeHtml(waitingOn)}</code>`,
    `Proof: <code>${escapeHtml(notification.supportSummary.publicProofPath)}</code>`,
    `Message: ${escapeHtml(message)}${contact}`,
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatError(error: PromiseRejectedResult): string {
  return error.reason instanceof Error ? error.reason.message : 'unknown error';
}
