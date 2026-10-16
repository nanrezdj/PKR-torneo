CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  user_id TEXT REFERENCES users(id),
  entry_id TEXT REFERENCES entries(id),
  payment_id TEXT REFERENCES payments(id),
  kind TEXT NOT NULL CHECK(kind IN (
    'obligation_created','obligation_voided','payment_reported','payment_confirmed','payment_voided',
    'prize_allocated','prize_paid','prize_payout_voided'
  )),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
  direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ledger_tournament ON ledger_entries(tournament_id, created_at);

CREATE TABLE prize_payouts (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  place INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('reported','confirmed','voided')),
  method TEXT NOT NULL CHECK(method IN ('cash','transfer','other')),
  confirmed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT,
  FOREIGN KEY(tournament_id, user_id) REFERENCES tournament_members(tournament_id, user_id)
);
CREATE INDEX idx_prize_payouts ON prize_payouts(tournament_id, place, status);

CREATE TABLE login_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_login_challenges_email ON login_challenges(email, created_at);

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clock_snapshots (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  level_no INTEGER NOT NULL,
  state TEXT NOT NULL,
  remaining_seconds INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE rebuy_requests ADD COLUMN method TEXT CHECK(method IN ('cash','transfer','other'));
ALTER TABLE rebuy_requests ADD COLUMN note TEXT;
ALTER TABLE tournaments ADD COLUMN warning_seconds INTEGER NOT NULL DEFAULT 15;

CREATE TRIGGER rebuy_cap_before_insert
BEFORE INSERT ON entries
WHEN NEW.kind = 'rebuy' AND NEW.status = 'valid'
AND (
  SELECT COUNT(*) FROM entries
  WHERE tournament_id = NEW.tournament_id AND user_id = NEW.user_id AND kind = 'rebuy' AND status = 'valid'
) >= (
  SELECT max_rebuys + CASE WHEN host_user_id = NEW.user_id THEN host_extra_rebuys ELSE 0 END
  FROM tournaments WHERE id = NEW.tournament_id
)
BEGIN
  SELECT RAISE(ABORT, 'rebuy cap exceeded');
END;

CREATE TRIGGER payment_confirm_within_outstanding
BEFORE UPDATE OF status ON payments
WHEN NEW.status = 'confirmed' AND OLD.status = 'reported'
AND NEW.amount_minor > (
  SELECT COALESCE(SUM(e.amount_minor), 0) - COALESCE((
    SELECT SUM(pa.amount_minor)
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id AND p.status = 'confirmed'
    JOIN entries e2 ON e2.id = pa.entry_id AND e2.status = 'valid'
    WHERE p.tournament_id = NEW.tournament_id AND p.user_id = NEW.user_id
  ), 0)
  FROM entries e
  WHERE e.tournament_id = NEW.tournament_id AND e.user_id = NEW.user_id AND e.status = 'valid'
)
BEGIN
  SELECT RAISE(ABORT, 'payment exceeds outstanding');
END;

CREATE TRIGGER allocation_within_entry
BEFORE INSERT ON payment_allocations
WHEN (
  SELECT COALESCE(SUM(pa.amount_minor), 0)
  FROM payment_allocations pa
  JOIN payments p ON p.id = pa.payment_id AND p.status = 'confirmed'
  WHERE pa.entry_id = NEW.entry_id
) + NEW.amount_minor > (
  SELECT amount_minor FROM entries WHERE id = NEW.entry_id AND status = 'valid'
)
BEGIN
  SELECT RAISE(ABORT, 'allocation exceeds entry');
END;

CREATE TRIGGER allocation_within_payment
BEFORE INSERT ON payment_allocations
WHEN (
  SELECT COALESCE(SUM(amount_minor), 0) FROM payment_allocations WHERE payment_id = NEW.payment_id
) + NEW.amount_minor > (
  SELECT amount_minor FROM payments WHERE id = NEW.payment_id
)
BEGIN
  SELECT RAISE(ABORT, 'allocation exceeds payment');
END;

CREATE TRIGGER prize_payout_within_allocation
BEFORE INSERT ON prize_payouts
WHEN NEW.status = 'confirmed'
AND (
  (SELECT amount_minor FROM prize_allocations WHERE tournament_id = NEW.tournament_id AND place = NEW.place) IS NULL
  OR (
    SELECT COALESCE(SUM(amount_minor), 0) FROM prize_payouts
    WHERE tournament_id = NEW.tournament_id AND place = NEW.place AND status = 'confirmed'
  ) + NEW.amount_minor > (
    SELECT amount_minor FROM prize_allocations WHERE tournament_id = NEW.tournament_id AND place = NEW.place
  )
)
BEGIN
  SELECT RAISE(ABORT, 'payout exceeds prize');
END;
