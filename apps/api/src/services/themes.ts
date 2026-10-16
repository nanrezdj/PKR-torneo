import type { ThemeInput } from "@pkr/contracts";
import { assertLayout } from "@pkr/domain";
import { nowIso, randomId } from "../crypto";
import type { AppDB } from "../db/app-db";

export async function activeTheme(db: AppDB) {
  const row = await db
    .prepare(
      "SELECT id, name, tokens_json FROM themes WHERE status = 'published' ORDER BY created_at DESC LIMIT 1",
    )
    .first<{ id: string; name: string; tokens_json: string }>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tokens: JSON.parse(row.tokens_json) as ThemeInput["tokens"],
  };
}

export async function saveTheme(db: AppDB, actorId: string, input: ThemeInput, publish: boolean) {
  assertLayout(input.tokens.layout);
  const id = randomId();
  const now = nowIso();
  const tokens = JSON.stringify(input.tokens);
  const status = publish ? "published" : "draft";
  const statements = [];
  if (publish)
    statements.push(db.prepare("UPDATE themes SET status = 'archived' WHERE status = 'published'"));
  statements.push(
    db
      .prepare(
        "INSERT INTO themes (id, name, status, tokens_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, input.name, status, tokens, actorId, now),
    db
      .prepare(
        "INSERT INTO theme_versions (id, theme_id, tokens_json, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(randomId(), id, tokens, actorId, now),
  );
  await db.batch(statements);
  return { id, status };
}

export async function restoreTheme(db: AppDB, actorId: string) {
  await db.batch([
    db.prepare("UPDATE themes SET status = 'archived' WHERE status = 'published'"),
    db
      .prepare(
        "INSERT INTO audit_logs (id, tournament_id, actor_user_id, action, entity_type, entity_id, details_json, created_at) VALUES (?, NULL, ?, 'theme.restore', 'theme', 'default', '{}', ?)",
      )
      .bind(randomId(), actorId, nowIso()),
  ]);
}
