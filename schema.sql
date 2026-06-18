CREATE TABLE IF NOT EXISTS boxes (
  box_id        TEXT PRIMARY KEY,
  tip_model     TEXT NOT NULL,
  lot           TEXT,
  quantity      INTEGER,
  purchase_date TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  registered_by TEXT,
  registered_at TEXT NOT NULL,
  location      TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT NOT NULL,
  box_id     TEXT NOT NULL,
  tip_model  TEXT NOT NULL,
  username   TEXT NOT NULL,
  tip_number INTEGER,
  note       TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
