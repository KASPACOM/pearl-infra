CREATE TABLE IF NOT EXISTS pearl_escrow_allocations (
  trade_id                   TEXT        PRIMARY KEY,
  allocator_key              TEXT        NOT NULL,
  derivation_prefix          TEXT        NOT NULL,
  derivation_index           INTEGER     NOT NULL CHECK (derivation_index >= 0),
  derivation_path            TEXT        NOT NULL,
  escrow_address             TEXT        NOT NULL,
  internal_pubkey_hex        TEXT        NOT NULL,
  taproot_output_script_hex  TEXT        NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pearl_escrow_allocations_derivation_unique
    UNIQUE (allocator_key, derivation_prefix, derivation_index)
);
