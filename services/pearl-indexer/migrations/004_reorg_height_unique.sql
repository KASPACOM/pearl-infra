-- Reorg replay needs to keep historical detached blocks while inserting the
-- replacement canonical block at the same height. The original global UNIQUE
-- constraint on height prevents that after a fork.

ALTER TABLE pearl_blocks
  DROP CONSTRAINT IF EXISTS pearl_blocks_height_key;

CREATE UNIQUE INDEX IF NOT EXISTS pearl_blocks_canonical_height_key
  ON pearl_blocks (height)
  WHERE detached = false;
