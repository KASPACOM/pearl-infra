-- Enforce the cross-chain replay guarantees required by the bridge service.
-- The application upsert path also checks these, but the database must remain
-- the final guard against duplicate Igra exit IDs and reused Pearl release txids.

CREATE UNIQUE INDEX IF NOT EXISTS bridge_exit_requests_exit_id_unique_idx
  ON bridge_exit_requests (exit_id);

CREATE UNIQUE INDEX IF NOT EXISTS bridge_exit_requests_release_unique_idx
  ON bridge_exit_requests (pearl_release_txid)
  WHERE pearl_release_txid IS NOT NULL;
