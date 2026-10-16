export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
}

export interface Stmt {
  bind(...values: SqlValue[]): Stmt;
  run(): Promise<RunResult>;
  all<T extends Record<string, unknown>>(): Promise<T[]>;
  first<T extends Record<string, unknown>>(): Promise<T | null>;
}

export interface AppDB {
  prepare(sql: string): Stmt;
  batch(statements: Stmt[]): Promise<RunResult[]>;
}
