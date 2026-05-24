ALTER TABLE otc_order_quote_links
  ADD COLUMN IF NOT EXISTS taker_pearl_address TEXT,
  ADD COLUMN IF NOT EXISTS taker_usdc_address TEXT;
