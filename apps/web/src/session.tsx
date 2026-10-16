import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ClientError, api } from "./api";
import { ErrorText, Field, Ghost, Gold, controlClass } from "./components";

function Brand() {
  return (
    <div className="mb-8 text-center">
      <div
        className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full border border-[var(--gold)] text-3xl text-[var(--gold)]"
        aria-hidden
      >
        ♠
      </div>
      <p className="font-display text-3xl font-semibold tracking-wide text-[var(--gold)]">POKER</p>
      <p className="text-xs tracking-[0.28em] text-[var(--gold)]">TOURNAMENT MANAGER</p>
      <p className="mt-3 text-white/70">Organiza. Juega. Comparte.</p>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@pkr.local");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => api("/auth/magic-link", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess: () => setSent(true),
  });
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Brand />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <Field label="Correo">
          <input
            className={controlClass}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Gold type="submit" disabled={send.isPending}>
          {send.isPending ? "Enviando…" : "Iniciar sesión"}
        </Gold>
        <ErrorText error={send.error} />
        {sent ? (
          <p className="text-sm text-white/75">
            Si el correo está registrado, el enlace quedó en el buzón local.
          </p>
        ) : null}
      </form>
      <Link className="mt-3 block" to="/aceptar">
        <Ghost type="button">Aceptar invitación</Ghost>
      </Link>
      {import.meta.env.DEV ? (
        <Link className="mt-4 text-center text-sm text-[var(--gold)]" to="/buzon">
          Buzón de desarrollo
        </Link>
      ) : null}
      <button
        className="mt-6 text-sm text-white/50"
        type="button"
        onClick={() => navigate("/torneos")}
      >
        Ya tengo sesión
      </button>
    </div>
  );
}

export function EnterPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const verify = useMutation({
    mutationFn: () =>
      api("/auth/magic-link/verify", { method: "POST", body: JSON.stringify({ token }) }),
    onSuccess: () => navigate("/torneos"),
  });
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Brand />
      <Gold type="button" disabled={!token || verify.isPending} onClick={() => verify.mutate()}>
        Entrar
      </Gold>
      <ErrorText error={verify.error} />
      {!token ? <p className="mt-3 text-sm">Falta el enlace de acceso.</p> : null}
    </div>
  );
}

export function AcceptPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const token = params.get("token") ?? "";
  const accept = useMutation({
    mutationFn: () =>
      api("/auth/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token, displayName: name }),
      }),
    onSuccess: () => navigate("/torneos"),
  });
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-4 font-display text-3xl text-[var(--gold)]">Tu cuenta</h1>
      <p className="mb-4 text-sm text-white/70">
        La invitación es de un solo uso. No hay registro público.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          accept.mutate();
        }}
      >
        <Field label="Cómo te ven en la mesa">
          <input
            className={controlClass}
            required
            minLength={2}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Gold type="submit" disabled={!token || accept.isPending}>
          Aceptar invitación
        </Gold>
        <ErrorText error={accept.error instanceof ClientError ? accept.error : accept.error} />
      </form>
    </div>
  );
}

export function MailboxPage() {
  const box = useQuery({
    queryKey: ["mailbox"],
    queryFn: () =>
      api<{ messages: { id: string; toEmail: string; subject: string; bodyText: string }[] }>(
        "/dev/mailbox",
      ),
    refetchInterval: 3000,
  });
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-6">
      <h1 className="mb-2 font-display text-3xl text-[var(--gold)]">Buzón local</h1>
      <p className="mb-4 text-sm text-white/70">
        Solo existe en desarrollo. Los enlaces no salen de esta máquina.
      </p>
      <div className="space-y-3">
        {box.data?.messages.map((message) => {
          const link = message.bodyText.match(/https?:\/\/\S+/)?.[0];
          return (
            <article key={message.id} className="card p-3 text-sm">
              <p className="font-semibold">{message.subject}</p>
              <p className="text-white/60">{message.toEmail}</p>
              {link ? (
                <a
                  className="mt-2 block text-[var(--gold)]"
                  href={link.replace(/^https?:\/\/[^/]+/, "")}
                >
                  Abrir enlace
                </a>
              ) : null}
            </article>
          );
        })}
        {box.data?.messages.length === 0 ? <p>Todavía no hay correos.</p> : null}
      </div>
      <ErrorText error={box.error} />
    </div>
  );
}
