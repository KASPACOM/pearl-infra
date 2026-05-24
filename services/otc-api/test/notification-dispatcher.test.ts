import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotificationDeliveryProcessor,
  renderNotificationDelivery,
  WebhookEmailNotificationProvider,
  type EmailNotificationProvider,
} from '../src/notification-dispatcher.ts';
import { InMemoryOtcRepository } from '../src/repository.ts';
import type { OtcNotificationDelivery, OtcUser } from '../src/types.ts';

const createdAt = '2026-05-24T12:00:00.000Z';

test('renders email verification and trade-status notification templates', () => {
  const verification = renderNotificationDelivery(delivery({
    notificationType: 'email_verification',
    payload: {
      verification_token: 'verify-token',
      expires_at: '2026-05-25T12:00:00.000Z',
    },
  }));
  assert.match(verification.subject, /Verify/);
  assert.match(verification.text, /verify-token/);

  const tradeStatus = renderNotificationDelivery(delivery({
    notificationType: 'trade_status',
    payload: {
      trade_id: 'trade_1',
      state: 'released',
      amount_prl: '100.00000000',
      amount_usdc: '17.000000',
      unsubscribe_token: 'unsubscribe-token',
    },
  }));
  assert.match(tradeStatus.subject, /released/);
  assert.match(tradeStatus.text, /trade_1/);
  assert.match(tradeStatus.text, /unsubscribe-token/);
});

test('processes pending email deliveries and records sent status', async () => {
  const repo = new InMemoryOtcRepository();
  await saveVerifiedNotificationUser(repo);
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const provider: EmailNotificationProvider = {
    async sendEmail(input) {
      sent.push(input);
    },
  };
  await repo.saveNotificationDelivery(delivery({ recipient: 'user@example.test' }));

  const result = await new NotificationDeliveryProcessor(repo, {
    emailProvider: provider,
    now: () => new Date(createdAt),
  }).processPending();

  assert.equal(result.sentDeliveries, 1);
  assert.equal(sent[0]?.to, 'user@example.test');
  const deliveries = await repo.listNotificationDeliveries();
  assert.equal(deliveries[0]?.status, 'sent');
  assert.equal(deliveries[0]?.sentAt, createdAt);
});

test('records failed delivery attempts and retry time', async () => {
  const repo = new InMemoryOtcRepository();
  await saveVerifiedNotificationUser(repo);
  await repo.saveNotificationDelivery(delivery({ deliveryId: 'delivery_failed' }));

  const result = await new NotificationDeliveryProcessor(repo, {
    emailProvider: {
      async sendEmail() {
        throw new Error('provider down');
      },
    },
    now: () => new Date(createdAt),
    retryBaseMs: 1_000,
  }).processPending();

  assert.equal(result.failedDeliveries, 1);
  const deliveries = await repo.listNotificationDeliveries({ status: 'failed' });
  assert.equal(deliveries[0]?.attempts, 1);
  assert.match(deliveries[0]?.lastError ?? '', /provider down/);
  assert.equal(deliveries[0]?.nextAttemptAt, '2026-05-24T12:00:01.000Z');
});

test('cancels queued delivery when preference or recipient is no longer valid', async () => {
  const repo = new InMemoryOtcRepository();
  await saveVerifiedNotificationUser(repo);
  await repo.saveNotificationDelivery(delivery({ deliveryId: 'delivery_optout' }));
  await repo.saveNotificationPreferences('user_1', [
    { notificationType: 'trade_status', channel: 'email', enabled: false },
  ], createdAt);

  const result = await new NotificationDeliveryProcessor(repo, {
    emailProvider: {
      async sendEmail() {
        throw new Error('should not send');
      },
    },
    now: () => new Date(createdAt),
  }).processPending();

  assert.equal(result.skippedDeliveries, 1);
  const deliveries = await repo.listNotificationDeliveries({ status: 'cancelled' });
  assert.equal(deliveries[0]?.deliveryId, 'delivery_optout');
  assert.match(deliveries[0]?.lastError ?? '', /preference is disabled/);
});

test('processes due retry deliveries before future-scheduled older rows', async () => {
  const repo = new InMemoryOtcRepository();
  await saveVerifiedNotificationUser(repo);
  await repo.saveNotificationDelivery(delivery({
    deliveryId: 'delivery_future',
    status: 'failed',
    nextAttemptAt: '2026-05-24T13:00:00.000Z',
    createdAt: '2026-05-24T11:00:00.000Z',
  }));
  await repo.saveNotificationDelivery(delivery({
    deliveryId: 'delivery_due',
    status: 'failed',
    nextAttemptAt: createdAt,
    createdAt: '2026-05-24T11:30:00.000Z',
  }));
  const sent: string[] = [];

  const result = await new NotificationDeliveryProcessor(repo, {
    emailProvider: {
      async sendEmail(input) {
        sent.push(input.delivery.deliveryId);
      },
    },
    now: () => new Date(createdAt),
    batchSize: 1,
  }).processPending();

  assert.equal(result.sentDeliveries, 1);
  assert.deepEqual(sent, ['delivery_due']);
});

test('posts email deliveries to configured webhook provider', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown>; authorization?: string }> = [];
  const provider = new WebhookEmailNotificationProvider(
    'https://email.example.test/send',
    'email-token',
    (async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: (init?.headers as Record<string, string>).authorization,
      });
      return new Response('{}', { status: 202 });
    }) as typeof fetch,
  );

  await provider.sendEmail({
    to: 'user@example.test',
    subject: 'Subject',
    text: 'Text',
    delivery: delivery({ deliveryId: 'delivery_webhook' }),
  });

  assert.equal(requests[0]?.url, 'https://email.example.test/send');
  assert.equal(requests[0]?.authorization, 'Bearer email-token');
  assert.equal(requests[0]?.body.to, 'user@example.test');
  assert.equal(requests[0]?.body.deliveryId, 'delivery_webhook');
  assert.equal((requests[0]?.body.payload as Record<string, unknown>).verification_token, undefined);
  assert.equal((requests[0]?.body.payload as Record<string, unknown>).unsubscribe_token, undefined);
});

async function saveVerifiedNotificationUser(repo: InMemoryOtcRepository): Promise<OtcUser> {
  const user = await repo.saveUser({
    userId: 'user_1',
    referralCode: 'USER1',
    wallet: {
      userId: 'user_1',
      walletType: 'evm',
      network: 'base_sepolia',
      address: '0x3333333333333333333333333333333333333333',
      verifiedAt: createdAt,
    },
    profile: {
      userId: 'user_1',
      email: 'user@example.test',
      emailVerifiedAt: createdAt,
      notificationEmailEnabled: true,
    },
  });
  await repo.saveNotificationPreferences(user.userId, [
    { notificationType: 'trade_status', channel: 'email', enabled: true },
  ], createdAt);
  return user;
}

function delivery(input: Partial<OtcNotificationDelivery> = {}): OtcNotificationDelivery {
  return {
    deliveryId: input.deliveryId ?? 'delivery_1',
    userId: input.userId ?? 'user_1',
    notificationType: input.notificationType ?? 'trade_status',
    channel: input.channel ?? 'email',
    recipient: input.recipient ?? 'user@example.test',
    status: input.status ?? 'pending',
    idempotencyKey: input.idempotencyKey ?? `idem_${input.deliveryId ?? '1'}`,
    payload: input.payload ?? {
      trade_id: 'trade_1',
      state: 'released',
      amount_prl: '100.00000000',
      amount_usdc: '17.000000',
      verification_token: 'verify-token',
      unsubscribe_token: 'unsubscribe-token',
    },
    attempts: input.attempts ?? 0,
    nextAttemptAt: input.nextAttemptAt ?? createdAt,
    createdAt: input.createdAt ?? createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}
