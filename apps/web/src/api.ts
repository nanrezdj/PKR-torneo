export class ClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

type Options = RequestInit & { idempotencyKey?: string };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? "GET").toUpperCase();
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD")
    headers.set("Idempotency-Key", options.idempotencyKey ?? crypto.randomUUID());
  const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    throw new ClientError(
      response.status,
      payload?.error?.code ?? "ERROR",
      payload?.error?.message ?? "No se pudo completar",
    );
  }
  return payload as T;
}
