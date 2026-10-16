CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
  tokens_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE theme_versions (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id),
  tokens_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_themes_status ON themes(status, created_at);
