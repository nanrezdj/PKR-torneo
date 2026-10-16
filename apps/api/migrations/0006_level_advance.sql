ALTER TABLE tournaments ADD COLUMN level_advance TEXT NOT NULL DEFAULT 'auto'
  CHECK (level_advance IN ('auto', 'manual'));
