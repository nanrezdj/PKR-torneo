ALTER TABLE tournaments ADD COLUMN cashier_user_id TEXT REFERENCES users(id);

CREATE TRIGGER cashier_must_be_player
BEFORE UPDATE OF cashier_user_id ON tournaments
WHEN NEW.cashier_user_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM tournament_members
  WHERE tournament_id = NEW.id
    AND user_id = NEW.cashier_user_id
    AND player_status != 'withdrawn'
)
BEGIN
  SELECT RAISE(ABORT, 'cashier must be a player');
END;
