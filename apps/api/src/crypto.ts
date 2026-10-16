export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomId(): string {
  return crypto.randomUUID();
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function plusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
