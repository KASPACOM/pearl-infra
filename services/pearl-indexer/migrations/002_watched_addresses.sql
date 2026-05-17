-- Generalize escrow_watches into a shared "watched addresses" primitive so the
-- Pearl indexer can serve both OTC (section 9.3.5) and the Igra bridge
-- (section 10.8) without two parallel watcher implementations.
--
-- escrow_watches has zero rows on every environment at the time of this
-- migration. We drop it and create three new tables that model the same
-- concept (watch → funding observation → spend) as 1:N relations.

DROP TABLE IF EXISTS escrow_watches;

-- A passive declaration of interest in a Pearl address. The product layer owns
-- watch_id; the indexer never invents one. purpose discriminates how the
-- product layer interprets observations and spends.
CREATE TABLE IF NOT EXISTS watched_addresses (
  watch_id                TEXT          PRIMARY KEY,
  purpose                 TEXT          NOT NULL,
  network                 TEXT          NOT NULL,
  address                 TEXT          NOT NULL,
  required_confirmations  INTEGER       NOT NULL,
  status                  TEXT          NOT NULL,
  metadata                JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watched_addresses_address_idx ON watched_addresses (address);
CREATE INDEX IF NOT EXISTS watched_addresses_status_idx  ON watched_addresses (status);
CREATE INDEX IF NOT EXISTS watched_addresses_purpose_idx ON watched_addresses (purpose);

-- Every funding output the indexer matched against a watched address.
-- 1:N — a bridge reserve receives many deposits; an OTC escrow normally
-- receives one but is modeled the same way.
CREATE TABLE IF NOT EXISTS address_observations (
  outpoint        TEXT          PRIMARY KEY,
  watch_id        TEXT          NOT NULL REFERENCES watched_addresses(watch_id) ON DELETE CASCADE,
  block_hash      TEXT          NOT NULL REFERENCES pearl_blocks(hash),
  height          BIGINT        NOT NULL,
  amount_grains   NUMERIC(40,0) NOT NULL,
  confirmations   INTEGER       NOT NULL DEFAULT 0,
  match_status    TEXT          NOT NULL,
  observed_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS address_observations_watch_idx ON address_observations (watch_id);
CREATE INDEX IF NOT EXISTS address_observations_match_idx ON address_observations (match_status);

-- Every spend of a previously-observed output. Classification is recorded as a
-- free-form string the product layer agrees on, plus a JSONB for the matched
-- template parameters (recipient, refund-path branch, etc.). The indexer does
-- not enforce a closed set of classifications.
CREATE TABLE IF NOT EXISTS address_spends (
  spend_txid           TEXT          NOT NULL,
  spent_outpoint       TEXT          NOT NULL REFERENCES address_observations(outpoint) ON DELETE CASCADE,
  block_hash           TEXT          NOT NULL REFERENCES pearl_blocks(hash),
  height               BIGINT        NOT NULL,
  classification       TEXT          NOT NULL,
  classification_data  JSONB,
  observed_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (spend_txid, spent_outpoint)
);

CREATE INDEX IF NOT EXISTS address_spends_outpoint_idx ON address_spends (spent_outpoint);
