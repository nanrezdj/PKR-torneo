import type { SessionProfile } from "@pkr/contracts";

export type Env = {
  DB: D1Database;
  TOURNAMENT_ROOM: DurableObjectNamespace;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  APP_ORIGIN: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionProfile | null; requestId: string };
};
