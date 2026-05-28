-- Store canonical request hashes so idempotency keys cannot be reused with
-- different payloads after the first successful write.

ALTER TABLE otc_quotes
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

ALTER TABLE otc_trades
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

ALTER TABLE otc_side_effects
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

CREATE INDEX IF NOT EXISTS otc_quotes_request_hash_idx ON otc_quotes (request_hash);
CREATE INDEX IF NOT EXISTS otc_trades_request_hash_idx ON otc_trades (request_hash);
CREATE INDEX IF NOT EXISTS otc_side_effects_request_hash_idx ON otc_side_effects (request_hash);
