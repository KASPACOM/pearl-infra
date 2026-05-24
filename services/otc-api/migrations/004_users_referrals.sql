CREATE TABLE IF NOT EXISTS otc_users (
  user_id     TEXT        PRIMARY KEY,
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otc_user_wallets (
  user_id         TEXT        NOT NULL REFERENCES otc_users(user_id) ON DELETE CASCADE,
  wallet_type     TEXT        NOT NULL,
  network         TEXT        NOT NULL,
  address         TEXT        NOT NULL,
  public_key_hex  TEXT,
  verified_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, wallet_type, network, address),
  UNIQUE (wallet_type, network, address)
);

CREATE INDEX IF NOT EXISTS otc_user_wallets_user_idx ON otc_user_wallets (user_id);

CREATE TABLE IF NOT EXISTS otc_user_profiles (
  user_id                       TEXT        PRIMARY KEY REFERENCES otc_users(user_id) ON DELETE CASCADE,
  email                         TEXT,
  email_verified_at             TIMESTAMPTZ,
  notification_email_enabled    BOOLEAN     NOT NULL DEFAULT false,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otc_referral_codes (
  referral_code  TEXT        PRIMARY KEY,
  owner_user_id  TEXT        NOT NULL UNIQUE REFERENCES otc_users(user_id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_referral_codes_owner_idx ON otc_referral_codes (owner_user_id);

CREATE TABLE IF NOT EXISTS otc_referral_attributions (
  referred_user_id  TEXT        PRIMARY KEY REFERENCES otc_users(user_id) ON DELETE CASCADE,
  referrer_user_id  TEXT        NOT NULL REFERENCES otc_users(user_id) ON DELETE RESTRICT,
  referral_code     TEXT        NOT NULL REFERENCES otc_referral_codes(referral_code) ON DELETE RESTRICT,
  source_url        TEXT,
  attributed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referred_user_id <> referrer_user_id)
);

CREATE INDEX IF NOT EXISTS otc_referral_attributions_referrer_idx
  ON otc_referral_attributions (referrer_user_id, attributed_at);

CREATE TABLE IF NOT EXISTS otc_user_wallet_challenges (
  challenge_id  TEXT        PRIMARY KEY,
  wallet_type   TEXT        NOT NULL,
  network       TEXT        NOT NULL,
  address       TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  nonce         TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_user_wallet_challenges_wallet_idx
  ON otc_user_wallet_challenges (wallet_type, network, address, created_at DESC);
