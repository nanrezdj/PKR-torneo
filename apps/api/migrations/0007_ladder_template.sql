ALTER TABLE tournaments ADD COLUMN ladder_mode TEXT NOT NULL DEFAULT 'custom'
  CHECK (ladder_mode IN ('template', 'custom'));
ALTER TABLE tournaments ADD COLUMN blind_small_step INTEGER NOT NULL DEFAULT 0;
