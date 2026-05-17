-- Step 6 / OpenSpec 9.3.6.a: per-observation funding classification.
--
-- The scanner stores a verdict alongside each address_observations row so the
-- settlement worker can read "was this funding on time, late, underpaid,
-- overpaid, duplicate, or unknown" without re-computing from the watch
-- metadata at decision time. classification is orthogonal to match_status:
-- match_status tracks the lifecycle (pending/confirmed/spent/detached),
-- classification is the funding-correctness verdict frozen at observation
-- time.
--
-- Free-form text rather than an enum so step 7 + the bridge track can
-- introduce additional categories (release_template, refund_template, etc.)
-- without a schema migration.

ALTER TABLE address_observations
  ADD COLUMN IF NOT EXISTS classification TEXT;

CREATE INDEX IF NOT EXISTS address_observations_classification_idx
  ON address_observations (classification);
