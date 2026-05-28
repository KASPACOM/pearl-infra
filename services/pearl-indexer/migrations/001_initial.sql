CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pearl_blocks (
  hash TEXT PRIMARY KEY,
  height BIGINT NOT NULL,
  previous_hash TEXT,
  timestamp TIMESTAMPTZ NOT NULL,
  txids TEXT[] NOT NULL DEFAULT '{}',
  detached BOOLEAN NOT NULL DEFAULT false,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pearl_blocks_height_idx ON pearl_blocks (height);
CREATE UNIQUE INDEX IF NOT EXISTS pearl_blocks_canonical_height_key
  ON pearl_blocks (height)
  WHERE detached = false;
CREATE INDEX IF NOT EXISTS pearl_blocks_previous_hash_idx ON pearl_blocks (previous_hash);

CREATE TABLE IF NOT EXISTS escrow_watches (
  trade_id TEXT PRIMARY KEY,
  network TEXT NOT NULL,
  address TEXT NOT NULL,
  expected_amount_grains NUMERIC(40, 0) NOT NULL,
  required_confirmations INTEGER NOT NULL,
  status TEXT NOT NULL,
  funding_outpoint TEXT,
  release_txid TEXT,
  refund_txid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrow_watches_address_idx ON escrow_watches (address);
CREATE INDEX IF NOT EXISTS escrow_watches_status_idx ON escrow_watches (status);
