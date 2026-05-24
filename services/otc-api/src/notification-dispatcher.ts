import type { OtcRepository } from './repository.js';
import type { NotificationDispatchResult, OtcApiConfig, OtcNotificationDelivery } from './types.js';

export interface RenderedNotification {
  subject: string;
  text: string;
}

export interface EmailNotificationProvider {
  sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    delivery: OtcNotificationDelivery;
  }): Promise<void>;
}

export class WebhookEmailNotificationProvider implements EmailNotificationProvider {
  private readonly url: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    url: string,
    token?: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.url = url;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    delivery: OtcNotificationDelivery;
  }): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        text: input.text,
        notificationType: input.delivery.notificationType,
        deliveryId: input.delivery.deliveryId,
        idempotencyKey: input.delivery.idempotencyKey,
        payload: input.delivery.payload,
      }),
    });
    if (!response.ok) {
      throw new Error(`notification email webhook failed with HTTP ${response.status}`);
    }
  }
}

export function createConfiguredEmailNotificationProvider(config: OtcApiConfig): EmailNotificationProvider | undefined {
  return config.notificationEmailWebhookUrl
    ? new WebhookEmailNotificationProvider(config.notificationEmailWebhookUrl, config.notificationEmailWebhookToken)
    : undefined;
}

export class NotificationDeliveryProcessor {
  private readonly repository: OtcRepository;
  private readonly options: {
    emailProvider?: EmailNotificationProvider;
    now?: () => Date;
    batchSize?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
  };

  constructor(
    repository: OtcRepository,
    options: {
      emailProvider?: EmailNotificationProvider;
      now?: () => Date;
      batchSize?: number;
      maxAttempts?: number;
      retryBaseMs?: number;
    } = {},
  ) {
    this.repository = repository;
    this.options = options;
  }

  async processPending(): Promise<NotificationDispatchResult> {
    const now = this.options.now?.() ?? new Date();
    const batchSize = this.options.batchSize ?? 50;
    const deliveries = [
      ...(await this.repository.listNotificationDeliveries({ status: 'pending', limit: batchSize })),
      ...(await this.repository.listNotificationDeliveries({ status: 'failed', limit: batchSize })),
    ].sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt)).slice(0, batchSize);
    const result: NotificationDispatchResult = {
      scannedDeadlines: 0,
      processedDeliveries: 0,
      sentDeliveries: 0,
      failedDeliveries: 0,
      skippedDeliveries: 0,
    };
    for (const delivery of deliveries) {
      if (new Date(delivery.nextAttemptAt).getTime() > now.getTime()) {
        result.skippedDeliveries += 1;
        continue;
      }
      result.processedDeliveries += 1;
      const provider = delivery.channel === 'email' ? this.options.emailProvider : undefined;
      if (!provider) {
        result.failedDeliveries += 1;
        await this.repository.updateNotificationDelivery(delivery.deliveryId, {
          status: 'failed',
          error: `notification provider unavailable for channel ${delivery.channel}`,
          nextAttemptAt: nextRetryAt(delivery, now, this.options.retryBaseMs ?? 60_000),
          updatedAt: now.toISOString(),
        });
        continue;
      }
      if (delivery.attempts >= (this.options.maxAttempts ?? 5)) {
        result.failedDeliveries += 1;
        await this.repository.updateNotificationDelivery(delivery.deliveryId, {
          status: 'cancelled',
          error: 'notification delivery max attempts exceeded',
          updatedAt: now.toISOString(),
        });
        continue;
      }
      try {
        const rendered = renderNotificationDelivery(delivery);
        await provider.sendEmail({
          to: delivery.recipient,
          ...rendered,
          delivery,
        });
        await this.repository.updateNotificationDelivery(delivery.deliveryId, {
          status: 'sent',
          updatedAt: now.toISOString(),
        });
        result.sentDeliveries += 1;
      } catch (error) {
        result.failedDeliveries += 1;
        await this.repository.updateNotificationDelivery(delivery.deliveryId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'unknown notification delivery error',
          nextAttemptAt: nextRetryAt(delivery, now, this.options.retryBaseMs ?? 60_000),
          updatedAt: now.toISOString(),
        });
      }
    }
    return result;
  }
}

export function renderNotificationDelivery(delivery: OtcNotificationDelivery): RenderedNotification {
  const payload = delivery.payload;
  switch (delivery.notificationType) {
    case 'email_verification':
      return {
        subject: 'Verify your Oysters Market email',
        text: [
          'Verify this email for Oysters Market notifications.',
          `Verification token: ${stringPayload(payload, 'verification_token')}`,
          `Expires at: ${stringPayload(payload, 'expires_at')}`,
        ].join('\n'),
      };
    case 'trade_status':
      return {
        subject: `Oysters Market trade ${stringPayload(payload, 'state')}`,
        text: [
          `Trade ${stringPayload(payload, 'trade_id')} is now ${stringPayload(payload, 'state')}.`,
          `PRL: ${stringPayload(payload, 'amount_prl')}`,
          `USDC: ${stringPayload(payload, 'amount_usdc')}`,
          unsubscribeLine(payload),
        ].filter(Boolean).join('\n'),
      };
    case 'deadline_warning':
      return {
        subject: 'Oysters Market deadline warning',
        text: [
          `Trade ${stringPayload(payload, 'trade_id')} has an upcoming ${stringPayload(payload, 'deadline_type')} deadline.`,
          `Deadline: ${stringPayload(payload, 'deadline_at')}`,
          unsubscribeLine(payload),
        ].filter(Boolean).join('\n'),
      };
    case 'order_matched':
      return {
        subject: 'Your Oysters Market offer was matched',
        text: [
          `Order ${stringPayload(payload, 'order_id')} was matched for ${stringPayload(payload, 'amount_prl')} PRL.`,
          `Trade: ${stringPayload(payload, 'trade_id')}`,
          unsubscribeLine(payload),
        ].filter(Boolean).join('\n'),
      };
    case 'new_good_order':
      return {
        subject: 'New Oysters Market offer',
        text: [
          `A new ${stringPayload(payload, 'side')} offer is open at ${stringPayload(payload, 'price_usdc_per_prl')} USDC/PRL.`,
          `Remaining PRL: ${stringPayload(payload, 'remaining_prl')}`,
          `Order: ${stringPayload(payload, 'order_id')}`,
          unsubscribeLine(payload),
        ].filter(Boolean).join('\n'),
      };
    case 'referral_event':
      return {
        subject: 'Oysters Market referral update',
        text: [
          `Referral event: ${stringPayload(payload, 'event')}`,
          `Points: ${stringPayload(payload, 'points')}`,
          unsubscribeLine(payload),
        ].filter(Boolean).join('\n'),
      };
    case 'price_alert':
      return {
        subject: 'Oysters Market price alert',
        text: [
          `Price alert: ${stringPayload(payload, 'price_usdc_per_prl')} USDC/PRL.`,
          unsubscribeLine(payload),
        ].filter(Boolean).join('\n'),
      };
  }
}

function nextRetryAt(delivery: OtcNotificationDelivery, now: Date, retryBaseMs: number): string {
  const delay = retryBaseMs * 2 ** Math.min(delivery.attempts, 6);
  return new Date(now.getTime() + delay).toISOString();
}

function stringPayload(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return value === undefined || value === null ? '' : String(value);
}

function unsubscribeLine(payload: Record<string, unknown>): string {
  const token = stringPayload(payload, 'unsubscribe_token');
  return token ? `Unsubscribe token: ${token}` : '';
}
