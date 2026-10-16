import type { SessionProfile } from "@pkr/contracts";
import { DomainError, VersionConflictError } from "@pkr/domain";
import type { Context } from "hono";
import type { ZodType } from "zod";
import { sha256Hex } from "./crypto";
import type { AppDB } from "./db/app-db";
import type { AppEnv } from "./env";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof VersionConflictError) return new ApiError(409, "CONFLICT", error.message);
  if (error instanceof DomainError)
    return new ApiError(422, "BUSINESS_RULE_VIOLATION", error.message);
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("cashier must be a player")) {
    return new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "El cajero tiene que ser un jugador de la mesa",
    );
  }
  if (message.includes("rebuy cap")) {
    return new ApiError(
      422,
      "BUSINESS_RULE_VIOLATION",
      "Ese jugador ya alcanzó el máximo de recompras",
    );
  }
  if (message.includes("payment exceeds") || message.includes("allocation exceeds")) {
    return new ApiError(422, "BUSINESS_RULE_VIOLATION", "El pago supera el pendiente de cobro");
  }
  if (message.includes("payout exceeds")) {
    return new ApiError(422, "BUSINESS_RULE_VIOLATION", "El premio pagado supera lo asignado");
  }
  if (/unique/i.test(message)) {
    return new ApiError(409, "CONFLICT", "Esa operación ya existe");
  }
  console.error(error);
  return new ApiError(500, "INTERNAL", "Error interno");
}

export function requireUser(user: SessionProfile | null): SessionProfile {
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Inicia sesión");
  return user;
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiError(400, "VALIDATION_ERROR", "Falta el encabezado Idempotency-Key");
  }
  return key;
}

export async function parseBody<S extends ZodType>(raw: string, schema: S): Promise<S["_output"]> {
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "El cuerpo no es JSON válido");
    }
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Datos inválidos", parsed.error.flatten());
  }
  return parsed.data;
}

export type Idem = { scope: string; key: string; hash: string };
export type StoredResponse = { status: number; body: unknown };

export async function readIdempotency(
  db: AppDB,
  scope: string,
  key: string,
  hash: string,
): Promise<StoredResponse | null> {
  const row = await db
    .prepare("SELECT request_hash, response_json FROM idempotency_keys WHERE scope = ? AND key = ?")
    .bind(scope, key)
    .first<{ request_hash: string; response_json: string }>();
  if (!row) return null;
  if (row.request_hash !== hash) {
    throw new ApiError(409, "CONFLICT", "Esa clave de idempotencia ya se usó con otros datos");
  }
  return JSON.parse(row.response_json) as StoredResponse;
}

export async function withIdempotency(
  c: Context<AppEnv>,
  db: AppDB,
  run: (idem: Idem, raw: string) => Promise<StoredResponse>,
): Promise<Response> {
  const user = requireUser(c.get("user"));
  const key = requireIdempotencyKey(c.req.raw);
  const raw = await c.req.text();
  const hash = await sha256Hex(raw);
  const scope = `${user.id}:${c.req.method}:${new URL(c.req.url).pathname}`;
  const existing = await readIdempotency(db, scope, key, hash);
  if (existing) return c.json(existing.body, existing.status as 200);
  try {
    const stored = await run({ scope, key, hash }, raw);
    return c.json(stored.body, stored.status as 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique/i.test(message) && message.toLowerCase().includes("idempotency")) {
      const again = await readIdempotency(db, scope, key, hash);
      if (again) return c.json(again.body, again.status as 200);
    }
    throw error;
  }
}
