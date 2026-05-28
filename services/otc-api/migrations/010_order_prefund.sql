-- Prefunded orders (C0 design).
--
-- An order in 'auto_sweep' (Mode A) or 'manual_confirm' (Mode B) prefund mode
-- requires the maker to deposit PRL into a dedicated Taproot escrow before the
-- order becomes matchable. When a taker matches, the worker sweeps the matched
-- amount from the prefund escrow into a per-trade 2-of-3 multisig escrow.
--
-- All new columns are nullable so the migration is safe to apply on top of
-- existing rows (legacy non-prefund orders stay NULL on every prefund_* column
-- and follow the original "live coordination" flow).

ALTER TABLE otc_orders
  ADD COLUMN IF NOT EXISTS prefund_mode TEXT,
  ADD COLUMN IF NOT EXISTS prefund_state TEXT,
  ADD COLUMN IF NOT EXISTS prefund_escrow_address TEXT,
  ADD COLUMN IF NOT EXISTS prefund_funded_outpoint TEXT,
  ADD COLUMN IF NOT EXISTS prefund_funded_grains NUMERIC,
  ADD COLUMN IF NOT EXISTS prefund_remaining_grains NUMERIC,
  ADD COLUMN IF NOT EXISTS prefund_funded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prefund_refund_eligible_after_unixtime BIGINT,
  ADD COLUMN IF NOT EXISTS prefund_refund_txid TEXT,
  ADD CONSTRAINT otc_orders_prefund_mode_chk
    CHECK (prefund_mode IS NULL OR prefund_mode IN ('auto_sweep', 'manual_confirm')),
  ADD CONSTRAINT otc_orders_prefund_state_chk
    CHECK (prefund_state IS NULL OR prefund_state IN (
      'pending_allocation',
      'pending_funding',
      'funded',
      'partially_swept',
      'fully_swept',
      'refund_pending',
      'refunded',
      'expired'
    )),
  ADD CONSTRAINT otc_orders_prefund_funded_grains_chk
    CHECK (prefund_funded_grains IS NULL OR prefund_funded_grains >= 0),
  ADD CONSTRAINT otc_orders_prefund_remaining_grains_chk
    CHECK (prefund_remaining_grains IS NULL OR prefund_remaining_grains >= 0);

CREATE INDEX IF NOT EXISTS otc_orders_prefund_state_idx
  ON otc_orders (prefund_state, updated_at)
  WHERE prefund_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS otc_orders_prefund_outpoint_idx
  ON otc_orders (prefund_funded_outpoint)
  WHERE prefund_funded_outpoint IS NOT NULL;

-- Taproot derivation params for the prefund escrow. 1:1 with otc_orders.
-- Mirrors pearl_escrow_allocations but keyed by order_id, with the script-leaf
-- shape unique to prefund (maker-CLTV-refund + Mode-A/B sweep paths).
CREATE TABLE IF NOT EXISTS otc_order_prefund_allocations (
  order_id                   TEXT        PRIMARY KEY REFERENCES otc_orders(order_id) ON DELETE CASCADE,
  allocator_key              TEXT        NOT NULL,
  derivation_prefix          TEXT        NOT NULL,
  derivation_index           INTEGER     NOT NULL CHECK (derivation_index >= 0),
  derivation_path            TEXT        NOT NULL,
  escrow_address             TEXT        NOT NULL,
  internal_pubkey_hex        TEXT        NOT NULL,
  taproot_output_script_hex  TEXT        NOT NULL,
  script_leaves              JSONB       NOT NULL,
  signer_pubkeys             JSONB       NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT otc_order_prefund_allocations_derivation_unique
    UNIQUE (allocator_key, derivation_prefix, derivation_index)
);

-- Per-match sweep history. Each row is one sweep transaction moving PRL from
-- the order's prefund UTXO into a per-trade escrow UTXO. May also leave change
-- back to a new prefund UTXO if the order is partially filled.
CREATE TABLE IF NOT EXISTS otc_order_sweeps (
  sweep_id            TEXT        PRIMARY KEY,
  order_id            TEXT        NOT NULL REFERENCES otc_orders(order_id) ON DELETE CASCADE,
  trade_id            TEXT        NOT NULL REFERENCES otc_trades(trade_id) ON DELETE CASCADE,
  input_outpoint      TEXT        NOT NULL,
  swept_grains        NUMERIC     NOT NULL CHECK (swept_grains > 0),
  change_outpoint     TEXT,
  change_grains       NUMERIC     CHECK (change_grains IS NULL OR change_grains >= 0),
  sweep_psbt_base64   TEXT,
  sweep_txid          TEXT,
  status              TEXT        NOT NULL DEFAULT 'pending',
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT otc_order_sweeps_status_chk
    CHECK (status IN (
      'pending',
      'awaiting_maker_signature',
      'broadcast',
      'confirmed',
      'failed',
      'expired'
    )),
  CONSTRAINT otc_order_sweeps_trade_unique UNIQUE (trade_id)
);

CREATE INDEX IF NOT EXISTS otc_order_sweeps_order_idx
  ON otc_order_sweeps (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS otc_order_sweeps_status_idx
  ON otc_order_sweeps (status, updated_at)
  WHERE status IN ('pending', 'awaiting_maker_signature', 'broadcast');

CREATE INDEX IF NOT EXISTS otc_order_sweeps_input_outpoint_idx
  ON otc_order_sweeps (input_outpoint);
