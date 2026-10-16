import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AppDB, RunResult, SqlValue, Stmt } from "../src/db/app-db";

class SqliteStmt implements Stmt {
  private values: SqlValue[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): Stmt {
    const next = new SqliteStmt(this.db, this.sql);
    next.values = values;
    return next;
  }

  async run(): Promise<RunResult> {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { changes: Number(result.changes) };
  }

  async all<T extends Record<string, unknown>>(): Promise<T[]> {
    return this.db.prepare(this.sql).all(...this.values) as T[];
  }

  async first<T extends Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values) as T | undefined;
    return row ?? null;
  }
}

export function openTestDb(): AppDB {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of [
    "0001_initial.sql",
    "0002_ledger_auth_payouts.sql",
    "0003_themes.sql",
    "0004_cashier.sql",
    "0005_entry_used.sql",
    "0006_level_advance.sql",
    "0007_ladder_template.sql",
  ]) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  return {
    prepare(sql: string): Stmt {
      return new SqliteStmt(db, sql);
    },
    async batch(statements: Stmt[]): Promise<RunResult[]> {
      db.exec("BEGIN");
      try {
        const results: RunResult[] = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
