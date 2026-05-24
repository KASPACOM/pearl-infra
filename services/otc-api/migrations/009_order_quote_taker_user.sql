ALTER TABLE otc_order_quote_links
  ADD COLUMN IF NOT EXISTS taker_user_id TEXT REFERENCES otc_users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS otc_order_quote_links_taker_user_idx
  ON otc_order_quote_links (taker_user_id, created_at DESC)
  WHERE taker_user_id IS NOT NULL;
