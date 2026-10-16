import type { SessionProfile } from "@pkr/contracts";
import { nowIso, plusMs, randomId, randomToken, sha256Hex } from "../crypto";
import type { AppDB } from "../db/app-db";
import type { TransactionalEmail } from "../email";
import { ApiError } from "../http";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function profileByToken(db: AppDB, rawToken: string): Promise<SessionProfile | null> {
  const tokenHash = await sha256Hex(rawToken);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .bind(tokenHash, nowIso())
    .first<{ id: string; email: string; display_name: string; role: "player" | "super_admin" }>();
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
}

export async function logout(db: AppDB, rawToken: string): Promise<void> {
  const tokenHash = await sha256Hex(rawToken);
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(nowIso(), tokenHash)
    .run();
}

export async function inviteUser(
  db: AppDB,
  actorId: string,
  email: string,
  origin: string,
  mail: TransactionalEmail,
): Promise<{ invitationId: string }> {
  const token = randomToken();
  const id = randomId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO invitations (id, email, token_hash, invited_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email.toLowerCase(), await sha256Hex(token), actorId, plusMs(7 * DAY), now)
    .run();
  await mail.send({
    to: email.toLowerCase(),
    subject: "Invitación a Poker Tournament Manager",
    text: `Abre este enlace para crear tu cuenta. Caduca en 7 días y solo sirve una vez:\n${origin}/aceptar?token=${token}`,
  });
  return { invitationId: id };
}

export async function acceptInvitation(
  db: AppDB,
  token: string,
  displayName: string,
): Promise<{ token: string; profile: SessionProfile }> {
  const tokenHash = await sha256Hex(token);
  const invite = await db
    .prepare("SELECT id, email, expires_at, accepted_at FROM invitations WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ id: string; email: string; expires_at: string; accepted_at: string | null }>();
  if (!invite || invite.accepted_at || invite.expires_at <= nowIso()) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "La invitación no es válida, ya se usó o caducó",
    );
  }
  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(invite.email)
    .first();
  if (existing)
    throw new ApiError(
      409,
      "CONFLICT",
      "Ese correo ya tiene cuenta. Entra con un enlace de acceso.",
    );
  const userId = randomId();
  const now = nowIso();
  const sessionToken = randomToken();
  const sessionHash = await sha256Hex(sessionToken);
  const results = await db.batch([
    db
      .prepare(
        "UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND expires_at > ?",
      )
      .bind(now, invite.id, now),
    db
      .prepare(
        `INSERT INTO users (id, email, display_name, role, created_at)
         SELECT ?, email, ?, 'player', ?
         FROM invitations WHERE id = ? AND accepted_at = ?`,
      )
      .bind(userId, displayName, now, invite.id, now),
    db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         SELECT ?, id, ?, ?, ?
         FROM users WHERE id = ?`,
      )
      .bind(randomId(), sessionHash, plusMs(30 * DAY), now, userId),
  ]);
  if (results[0]?.changes !== 1 || results[1]?.changes !== 1) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "La invitación no es válida, ya se usó o caducó",
    );
  }
  return {
    token: sessionToken,
    profile: { id: userId, email: invite.email, displayName, role: "player" },
  };
}

export async function requestMagicLink(
  db: AppDB,
  email: string,
  origin: string,
  mail: TransactionalEmail,
): Promise<void> {
  const normalized = email.toLowerCase();
  const recent = await db
    .prepare("SELECT COUNT(*) AS total FROM login_challenges WHERE email = ? AND created_at > ?")
    .bind(normalized, new Date(Date.now() - HOUR).toISOString())
    .first<{ total: number }>();
  if ((recent?.total ?? 0) >= 5) {
    throw new ApiError(429, "RATE_LIMITED", "Espera un momento antes de pedir otro enlace");
  }
  const user = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(normalized)
    .first<{ id: string }>();
  if (!user) return;
  const token = randomToken();
  await db
    .prepare(
      "INSERT INTO login_challenges (id, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(randomId(), normalized, await sha256Hex(token), plusMs(30 * 60 * 1000), nowIso())
    .run();
  await mail.send({
    to: normalized,
    subject: "Tu enlace para entrar",
    text: `Entra a la mesa con este enlace. Caduca en 30 minutos y solo sirve una vez:\n${origin}/entrar?token=${token}`,
  });
}

export async function verifyMagicLink(
  db: AppDB,
  token: string,
): Promise<{ token: string; profile: SessionProfile }> {
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  const challenge = await db
    .prepare("SELECT id, email, expires_at, consumed_at FROM login_challenges WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ id: string; email: string; expires_at: string; consumed_at: string | null }>();
  if (!challenge || challenge.consumed_at || challenge.expires_at <= now) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "El enlace no es válido, ya se usó o caducó",
    );
  }
  const user = await db
    .prepare("SELECT id, email, display_name, role FROM users WHERE email = ?")
    .bind(challenge.email)
    .first<{ id: string; email: string; display_name: string; role: "player" | "super_admin" }>();
  if (!user) throw new ApiError(422, "BUSINESS_RULE_VIOLATION", "El enlace no es válido");
  const sessionToken = randomToken();
  const results = await db.batch([
    db
      .prepare("UPDATE login_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(now, challenge.id),
    db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM login_challenges WHERE id = ? AND consumed_at = ?)`,
      )
      .bind(
        randomId(),
        user.id,
        await sha256Hex(sessionToken),
        plusMs(30 * DAY),
        now,
        challenge.id,
        now,
      ),
  ]);
  if (results[0]?.changes !== 1 || results[1]?.changes !== 1) {
    throw new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "El enlace no es válido, ya se usó o caducó",
    );
  }
  return {
    token: sessionToken,
    profile: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
  };
}
