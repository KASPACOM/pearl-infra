CREATE TABLE IF NOT EXISTS otc_email_verification_tokens (
  token_id       TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL REFERENCES otc_users(user_id) ON DELETE CASCADE,
  email          TEXT        NOT NULL,
  token_hash     TEXT        NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_email_verification_tokens_user_idx
  ON otc_email_verification_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otc_notification_preferences (
  user_id             TEXT        NOT NULL REFERENCES otc_users(user_id) ON DELETE CASCADE,
  notification_type   TEXT        NOT NULL,
  channel             TEXT        NOT NULL,
  enabled             BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type, channel),
  CHECK (notification_type IN (
    'trade_status',
    'deadline_warning',
    'order_matched',
    'price_alert',
    'new_good_order',
    'referral_event',
    'email_verification'
  )),
  CHECK (channel IN ('email', 'telegram'))
);

CREATE INDEX IF NOT EXISTS otc_notification_preferences_enabled_idx
  ON otc_notification_preferences (notification_type, channel, enabled);

CREATE TABLE IF NOT EXISTS otc_notification_deliveries (
  delivery_id             TEXT        PRIMARY KEY,
  user_id                 TEXT        REFERENCES otc_users(user_id) ON DELETE SET NULL,
  notification_type       TEXT        NOT NULL,
  channel                 TEXT        NOT NULL,
  recipient               TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending',
  idempotency_key         TEXT        NOT NULL UNIQUE,
  payload                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  unsubscribe_token_hash  TEXT,
  attempts                INTEGER     NOT NULL DEFAULT 0,
  last_error              TEXT,
  next_attempt_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (notification_type IN (
    'trade_status',
    'deadline_warning',
    'order_matched',
    'price_alert',
    'new_good_order',
    'referral_event',
    'email_verification'
  )),
  CHECK (channel IN ('email', 'telegram')),
  CHECK (status IN ('pending', 'sent', 'failed', 'cancelled', 'unsubscribed'))
);

CREATE INDEX IF NOT EXISTS otc_notification_deliveries_status_idx
  ON otc_notification_deliveries (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS otc_notification_deliveries_user_idx
  ON otc_notification_deliveries (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS otc_notification_deliveries_unsubscribe_idx
  ON otc_notification_deliveries (unsubscribe_token_hash)
  WHERE unsubscribe_token_hash IS NOT NULL;
