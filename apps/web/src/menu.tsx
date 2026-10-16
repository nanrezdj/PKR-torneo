import { assertLayout } from "@pkr/domain";
import { applyTokens, defaultTokens } from "@pkr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "./api";
import { ErrorText, Field, Ghost, Primary, Shell, controlClass } from "./components";
import type { DirectoryUser, Profile, ThemeTokens } from "./types";

export function MenuPage() {
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => navigate("/"),
  });
  const items = [
    ["/torneos", "Mis torneos"],
    ["/torneos/nuevo", "Crear torneo"],
    ["/jugadores", "Jugadores"],
    ["/configuracion", "Configuración"],
  ] as const;
  return (
    <Shell title="Menú principal">
      <div className="space-y-2">
        {items.map(([to, name]) => (
          <Link key={to} to={to} className="card flex min-h-14 items-center justify-between px-4">
            {name} <span aria-hidden>›</span>
          </Link>
        ))}
        <button
          className="card min-h-14 w-full px-4 text-left"
          type="button"
          onClick={() => logout.mutate()}
        >
          Cerrar sesión
        </button>
      </div>
    </Shell>
  );
}

export function PlayersPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Profile>("/me") });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<DirectoryUser[]>("/users") });
  const [email, setEmail] = useState("");
  const invite = useMutation({
    mutationFn: () => api("/auth/invitations", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess: () => setEmail(""),
  });
  return (
    <Shell title="Jugadores" back="/menu">
      <p className="mb-3 text-sm text-white/65">
        {me.data?.role === "super_admin"
          ? "Como super admin ves el directorio completo. Un jugador solo ve a quienes comparten torneo con él."
          : "Ves a quienes comparten un torneo contigo. Un externo no aparece."}
      </p>
      <ul className="space-y-2">
        {users.data?.map((user) => (
          <li key={user.id} className="card p-3">
            <p className="font-semibold">{user.displayName}</p>
            <p className="text-sm text-white/60">{user.email}</p>
          </li>
        ))}
      </ul>
      {me.data?.role === "super_admin" ? (
        <form
          className="mt-4 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          <Field label="Invitar por email">
            <input
              className={controlClass}
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Primary type="submit">Enviar invitación</Primary>
          {invite.isSuccess ? (
            <p className="text-sm">Revisa el buzón local para el enlace.</p>
          ) : null}
          <ErrorText error={invite.error} />
        </form>
      ) : null}
    </Shell>
  );
}

export function SettingsPage() {
  const client = useQueryClient();
  const active = useQuery({
    queryKey: ["theme"],
    queryFn: () => api<{ tokens: ThemeTokens } | null>("/themes/active"),
  });
  const [tokens, setTokens] = useState<ThemeTokens>(defaultTokens);
  useEffect(() => {
    if (active.data?.tokens) setTokens(active.data.tokens);
  }, [active.data]);
  const [message, setMessage] = useState<string | null>(null);
  function update(partial: Partial<ThemeTokens>) {
    const next = { ...tokens, ...partial };
    setTokens(next);
    applyTokens(next);
  }
  function move(index: number, direction: -1 | 1) {
    const layout = [...tokens.layout];
    const target = index + direction;
    if (target < 0 || target >= layout.length) return;
    const current = layout[index];
    const swap = layout[target];
    if (!current || !swap) return;
    layout[index] = swap;
    layout[target] = current;
    update({ layout });
  }
  const publish = useMutation({
    mutationFn: () => {
      assertLayout(tokens.layout);
      return api("/themes/publish", {
        method: "POST",
        body: JSON.stringify({ name: "Casino", tokens }),
      });
    },
    onSuccess: async () => {
      setMessage("Tema publicado");
      await client.invalidateQueries({ queryKey: ["theme"] });
    },
  });
  const restore = useMutation({
    mutationFn: () => api("/themes/restore", { method: "POST" }),
    onSuccess: async () => {
      setTokens(defaultTokens);
      applyTokens(defaultTokens);
      setMessage("Tema restaurado");
      await client.invalidateQueries({ queryKey: ["theme"] });
    },
  });
  return (
    <Shell title="Configuración" back="/menu">
      <p className="mb-3 text-sm text-white/70">
        Design Studio. El orden no puede esconder el reloj, los jugadores, el dinero ni las
        acciones.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(["felt", "ink", "gold", "blood"] as const).map((key) => (
          <Field key={key} label={key}>
            <input
              className="h-12 w-full bg-transparent"
              type="color"
              value={tokens[key]}
              onChange={(event) => update({ [key]: event.target.value })}
            />
          </Field>
        ))}
      </div>
      <Field label="Radio de las tarjetas">
        <input
          className={controlClass}
          type="number"
          min={0}
          max={32}
          value={tokens.radius}
          onChange={(event) => update({ radius: Number(event.target.value) })}
        />
      </Field>
      <ul className="my-4 space-y-2">
        {tokens.layout.map((region, index) => (
          <li key={region} className="card flex items-center justify-between px-3 py-2">
            <span>{region}</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => move(index, -1)} aria-label={`Subir ${region}`}>
                ↑
              </button>
              <button type="button" onClick={() => move(index, 1)} aria-label={`Bajar ${region}`}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="card mb-4 p-4">
        <p className="font-display text-2xl text-[var(--gold)]">Vista previa</p>
        <p className="mt-2 text-sm">Fieltro, oro y rojo se aplican al instante en esta sesión.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Primary type="button" onClick={() => publish.mutate()}>
          Publicar
        </Primary>
        <Ghost type="button" onClick={() => restore.mutate()}>
          Restaurar
        </Ghost>
      </div>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <ErrorText error={publish.error ?? restore.error} />
      <p className="mt-6 text-sm text-white/60">
        La moneda de ejemplo es el colón. La entrada y la recompra tienen precios distintos. El 100%
        de las entradas válidas va al fondo, sin comisión.
      </p>
    </Shell>
  );
}
