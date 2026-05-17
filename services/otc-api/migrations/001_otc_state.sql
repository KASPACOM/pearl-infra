CREATE TABLE IF NOT EXISTS otc_quotes (
  quote_id           TEXT        PRIMARY KEY,
  client_request_id  TEXT        NOT NULL UNIQUE,
  quote              JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otc_trades (
  trade_id           TEXT        PRIMARY KEY,
  quote_id           TEXT        NOT NULL UNIQUE REFERENCES otc_quotes(quote_id),
  client_request_id  TEXT        NOT NULL UNIQUE,
  state              TEXT        NOT NULL,
  trade              JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_trades_state_idx ON otc_trades (state);

CREATE TABLE IF NOT EXISTS otc_trade_events (
  event_id         BIGSERIAL   PRIMARY KEY,
  trade_id         TEXT        NOT NULL REFERENCES otc_trades(trade_id) ON DELETE CASCADE,
  source_event_id  TEXT        NOT NULL,
  event            JSONB       NOT NULL,
  observed_at      TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trade_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS otc_trade_events_trade_idx ON otc_trade_events (trade_id, observed_at);

CREATE TABLE IF NOT EXISTS otc_side_effects (
  idempotency_key  TEXT        PRIMARY KEY,
  trade_id         TEXT        NOT NULL REFERENCES otc_trades(trade_id) ON DELETE CASCADE,
  effect_type      TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  actor            TEXT        NOT NULL,
  source_event_id  TEXT,
  tx_hash          TEXT,
  outpoint         TEXT,
  block_number     BIGINT,
  block_hash       TEXT,
  chain_id         BIGINT,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_side_effects_trade_idx ON otc_side_effects (trade_id, effect_type, created_at);
CREATE INDEX IF NOT EXISTS otc_side_effects_tx_idx ON otc_side_effects (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS otc_side_effects_outpoint_idx ON otc_side_effects (outpoint) WHERE outpoint IS NOT NULL;
