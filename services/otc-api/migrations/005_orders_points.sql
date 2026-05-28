CREATE TABLE IF NOT EXISTS otc_orders (
  order_id             TEXT        PRIMARY KEY,
  maker_user_id        TEXT        NOT NULL REFERENCES otc_users(user_id) ON DELETE CASCADE,
  side                 TEXT        NOT NULL,
  funding_asset        TEXT        NOT NULL,
  amount_prl           NUMERIC     NOT NULL,
  remaining_prl        NUMERIC     NOT NULL,
  price_usdc_per_prl   NUMERIC     NOT NULL,
  min_fill_prl         NUMERIC,
  status               TEXT        NOT NULL DEFAULT 'open',
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (side IN ('buy_prl', 'sell_prl')),
  CHECK (funding_asset IN ('PRL', 'USDC')),
  CHECK (amount_prl > 0),
  CHECK (remaining_prl >= 0),
  CHECK (price_usdc_per_prl > 0)
);

CREATE INDEX IF NOT EXISTS otc_orders_status_side_price_idx
  ON otc_orders (status, side, price_usdc_per_prl, created_at);

CREATE INDEX IF NOT EXISTS otc_orders_maker_idx
  ON otc_orders (maker_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS otc_points_ledger (
  point_event_id  TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES otc_users(user_id) ON DELETE CASCADE,
  source          TEXT        NOT NULL,
  points          INTEGER     NOT NULL CHECK (points > 0),
  related_user_id TEXT        REFERENCES otc_users(user_id) ON DELETE SET NULL,
  trade_id        TEXT        REFERENCES otc_trades(trade_id) ON DELETE SET NULL,
  order_id        TEXT        REFERENCES otc_orders(order_id) ON DELETE SET NULL,
  referral_code   TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_points_ledger_user_idx
  ON otc_points_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS otc_points_ledger_trade_idx
  ON otc_points_ledger (trade_id)
  WHERE trade_id IS NOT NULL;
