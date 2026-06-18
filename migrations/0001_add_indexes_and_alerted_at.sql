-- Migration for databases created before the indexes / alerted_at column /
-- UNIQUE(box_id, tip_number) constraint were added.
--
-- New databases get everything from schema.sql and do NOT need this file.
--
-- Apply with:
--   wrangler d1 execute afm-tips-db --remote --file=migrations/0001_add_indexes_and_alerted_at.sql
--
-- SQLite cannot add a UNIQUE table constraint via ALTER TABLE, so it is added
-- here as a unique index, which is equivalent for conflict detection.

ALTER TABLE boxes ADD COLUMN alerted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_box ON usage_log(box_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);

-- Enforces one tip number per box (multiple NULLs remain allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_box_tipnum ON usage_log(box_id, tip_number);
