ALTER TABLE entries ADD COLUMN used_at TEXT;

UPDATE entries
SET used_at = created_at
WHERE kind = 'initial'
  AND status = 'valid'
  AND used_at IS NULL
  AND tournament_id IN (
    SELECT id FROM tournaments WHERE status NOT IN ('draft', 'ready')
  );
