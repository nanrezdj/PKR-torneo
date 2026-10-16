import type { AppDB, RunResult, SqlValue, Stmt } from "./app-db";

class D1Stmt implements Stmt {
  constructor(private readonly raw: D1PreparedStatement) {}

  bind(...values: SqlValue[]): Stmt {
    return new D1Stmt(this.raw.bind(...values));
  }

  async run(): Promise<RunResult> {
    const result = await this.raw.run();
    return { changes: result.meta.changes ?? 0 };
  }

  async all<T extends Record<string, unknown>>(): Promise<T[]> {
    const result = await this.raw.all<T>();
    return result.results ?? [];
  }

  async first<T extends Record<string, unknown>>(): Promise<T | null> {
    const row = await this.raw.first<T>();
    return row ?? null;
  }

  unwrap(): D1PreparedStatement {
    return this.raw;
  }
}

export function d1Adapter(database: D1Database): AppDB {
  return {
    prepare(sql: string): Stmt {
      return new D1Stmt(database.prepare(sql));
    },
    async batch(statements: Stmt[]): Promise<RunResult[]> {
      const prepared = statements.map((statement) => (statement as D1Stmt).unwrap());
      const results = await database.batch(prepared);
      return results.map((result) => ({ changes: result.meta.changes ?? 0 }));
    },
  };
}
