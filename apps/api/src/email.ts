import { nowIso, randomId } from "./crypto";
import type { AppDB } from "./db/app-db";
import type { Env } from "./env";
import { ApiError } from "./http";

export type EmailMessage = { to: string; subject: string; text: string };

export interface TransactionalEmail {
  send(message: EmailMessage): Promise<{ id: string }>;
}

async function store(db: AppDB, message: EmailMessage, provider: string): Promise<string> {
  const id = randomId();
  await db
    .prepare(
      "INSERT INTO email_outbox (id, to_email, subject, body_text, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, message.to, message.subject, message.text, provider, nowIso())
    .run();
  return id;
}

export function createEmailProvider(db: AppDB, env: Env): TransactionalEmail {
  return {
    async send(message: EmailMessage): Promise<{ id: string }> {
      if (env.ENVIRONMENT !== "development") {
        if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
          throw new ApiError(
            503,
            "EMAIL_NOT_CONFIGURED",
            "El correo transaccional no está configurado",
          );
        }
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.RESEND_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: env.RESEND_FROM,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
        });
        if (!response.ok) {
          throw new ApiError(502, "EMAIL_FAILED", "No se pudo enviar el correo");
        }
        return {
          id: await store(
            db,
            { ...message, text: "Enviado. El enlace no se guarda en el buzón." },
            "resend",
          ),
        };
      }
      return { id: await store(db, message, "local-outbox") };
    },
  };
}
