ALTER TABLE otc_orders
  ADD COLUMN IF NOT EXISTS maker_pearl_address TEXT,
  ADD COLUMN IF NOT EXISTS maker_usdc_address TEXT,
  ADD COLUMN IF NOT EXISTS maker_pearl_pubkey TEXT,
  ADD COLUMN IF NOT EXISTS maker_pearl_pubkey_proof TEXT,
  ADD COLUMN IF NOT EXISTS pearl_release_signing_mode TEXT NOT NULL DEFAULT 'manual_after_base_deposit';

CREATE TABLE IF NOT EXISTS otc_order_quote_links (
  quote_id    TEXT        PRIMARY KEY REFERENCES otc_quotes(quote_id) ON DELETE CASCADE,
  order_id    TEXT        NOT NULL REFERENCES otc_orders(order_id) ON DELETE CASCADE,
  amount_prl  NUMERIC     NOT NULL CHECK (amount_prl > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_order_quote_links_order_idx
  ON otc_order_quote_links (order_id, created_at DESC);
