import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "./api";
import {
  Amount,
  Avatar,
  ErrorText,
  Field,
  Ghost,
  Primary,
  Shell,
  Skull,
  controlClass,
  label,
} from "./components";
import type { Clock, DirectoryUser, Profile, ThemeTokens, TournamentDetail } from "./types";

function useMoneyAccess(
  players: { userId: string; memberRole: string }[] | undefined,
  cashierUserId: string | null | undefined,
) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Profile>("/me") });
  const canAdmin =
    me.data?.role === "super_admin" ||
    (players ?? []).some(
      (player) => player.userId === me.data?.id && player.memberRole === "admin",
    );
  const canHandleMoney = canAdmin || (!!me.data && me.data.id === cashierUserId);
  return { me, canAdmin, canHandleMoney };
}

function useDetail(id: string) {
  return useQuery({
    queryKey: ["tournament", id],
    queryFn: () => api<TournamentDetail>(`/tournaments/${id}`),
    refetchInterval: 4000,
  });
}

function useLiveClock(id: string) {
  const client = useQueryClient();
  const clock = useQuery({
    queryKey: ["clock", id],
    queryFn: () => api<Clock>(`/tournaments/${id}/clock`),
    refetchInterval: (query) => (query.state.data?.remainingSeconds === 0 ? 1000 : 5000),
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/api/v1/tournaments/${id}/events`);
    socket.onmessage = () => {
      void client.invalidateQueries({ queryKey: ["clock", id] });
      void client.invalidateQueries({ queryKey: ["tournament", id] });
    };
    return () => socket.close();
  }, [client, id]);
  const data = clock.data;
  let remaining = data?.remainingSeconds ?? 0;
  if (data?.state === "running") {
    remaining = Math.max(
      0,
      data.remainingSeconds - Math.floor((now - Date.parse(data.serverTime)) / 1000),
    );
  }
  return { clock, remaining };
}

function beep() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.04;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

function formatClock(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function DashboardPage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const { clock, remaining } = useLiveClock(id);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Profile>("/me") });
  const theme = useQuery({
    queryKey: ["theme"],
    queryFn: () => api<{ tokens: ThemeTokens } | null>("/themes/active"),
  });
  const client = useQueryClient();
  const armed = useRef(false);
  const played = useRef(false);
  useEffect(() => {
    const arm = () => {
      armed.current = true;
    };
    window.addEventListener("pointerdown", arm, { once: true });
    return () => window.removeEventListener("pointerdown", arm);
  }, []);
  useEffect(() => {
    const warning = clock.data?.warningSeconds ?? 15;
    if (!armed.current || clock.data?.state !== "running") return;
    if (remaining <= warning && remaining > 0 && !played.current) {
      played.current = true;
      beep();
    }
    if (remaining > warning) played.current = false;
  }, [clock.data?.state, clock.data?.warningSeconds, remaining]);
  const action = useMutation({
    mutationFn: (name: string) =>
      api(`/tournaments/${id}/clock/actions`, {
        method: "POST",
        body: JSON.stringify({ action: name, expectedVersion: clock.data?.version ?? 0 }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["clock", id] });
    },
  });
  const start = useMutation({
    mutationFn: () => api(`/tournaments/${id}/start`, { method: "POST", body: "{}" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const [cashierId, setCashierId] = useState("");
  const [enrollId, setEnrollId] = useState("");
  const [enrollMethod, setEnrollMethod] = useState<"cash" | "transfer">("cash");
  const directory = useQuery({
    queryKey: ["users"],
    queryFn: () => api<DirectoryUser[]>("/users"),
  });
  useEffect(() => {
    if (detail.data?.cashierUserId) setCashierId(detail.data.cashierUserId);
  }, [detail.data?.cashierUserId]);
  const assignCashier = useMutation({
    mutationFn: () =>
      api(`/tournaments/${id}/cashier`, {
        method: "POST",
        body: JSON.stringify({ userId: cashierId }),
      }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const payInitial = useMutation({
    mutationFn: (body: { userId: string; method: "cash" | "transfer" }) =>
      api(`/tournaments/${id}/initial-payment`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const bust = useMutation({
    mutationFn: (userId: string) =>
      api(`/tournaments/${id}/bust`, { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const enroll = useMutation({
    mutationFn: () =>
      api(`/tournaments/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: enrollId, method: enrollMethod }),
      }),
    onSuccess: async () => {
      setEnrollId("");
      await client.invalidateQueries({ queryKey: ["tournament", id] });
    },
  });
  const tournament = detail.data;
  const canAdmin =
    me.data?.role === "super_admin" ||
    tournament?.players.some(
      (player) => player.userId === me.data?.id && player.memberRole === "admin",
    );
  const canHandleMoney = canAdmin || (!!me.data && me.data.id === tournament?.cashierUserId);
  const readyPlayers = (tournament?.players ?? []).filter(
    (player) => player.playerStatus === "registered" || player.playerStatus === "active",
  ).length;
  const layout = theme.data?.tokens.layout ?? ["clock", "players", "money", "actions"];
  return (
    <Shell title={tournament?.title ?? "Torneo"} back="/torneos" wide>
      <ErrorText
        error={
          detail.error ??
          clock.error ??
          action.error ??
          start.error ??
          payInitial.error ??
          bust.error ??
          enroll.error
        }
      />
      {(tournament?.status === "draft" || tournament?.status === "ready") && canAdmin ? (
        <div className="space-y-2">
          <p className="text-sm text-white/70">
            Para iniciar hacen falta al menos 3 jugadores con la primera entrada pagada. Hay{" "}
            {readyPlayers}. Esa entrada ya está cobrada y se marca usada al arrancar.
          </p>
          <Primary
            type="button"
            disabled={start.isPending || readyPlayers < 3}
            onClick={() => start.mutate()}
          >
            Iniciar torneo
          </Primary>
        </div>
      ) : null}
      {tournament ? (
        <section className="card mt-4 p-4">
          <p className="text-xs text-white/60">Cajero</p>
          <p className="text-lg">{tournament.cashierName ?? "Sin asignar"}</p>
          <p className="mt-1 text-sm text-white/60">
            El cajero o un administrador aprueban las recompras y confirman si el pago es efectivo o
            transferencia.
          </p>
          {canAdmin ? (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                assignCashier.mutate();
              }}
            >
              <select
                className={controlClass}
                value={cashierId}
                onChange={(event) => setCashierId(event.target.value)}
                required
              >
                <option value="">Elegir jugador</option>
                {tournament.players
                  .filter(
                    (player) =>
                      player.playerStatus === "registered" || player.playerStatus === "active",
                  )
                  .map((player) => (
                    <option key={player.userId} value={player.userId}>
                      {player.displayName}
                      {player.userId === me.data?.id ? " (tú)" : ""}
                    </option>
                  ))}
              </select>
              <button
                className="gold-btn min-h-12 shrink-0 rounded-xl px-4 disabled:opacity-50"
                type="submit"
                disabled={assignCashier.isPending || !cashierId}
              >
                Asignar cajero
              </button>
            </form>
          ) : null}
          <ErrorText error={assignCashier.error} />
          {canHandleMoney && tournament.status !== "closed" && tournament.status !== "archived" ? (
            <form
              className="mt-4 space-y-2 border-t border-white/10 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                enroll.mutate();
              }}
            >
              <p className="text-sm text-white/70">
                Inscribir cobra la primera entrada (
                <Amount value={tournament.entryPriceMinor} currency={tournament.currency} />) en el
                momento.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  className={controlClass}
                  value={enrollId}
                  onChange={(event) => setEnrollId(event.target.value)}
                  required
                >
                  <option value="">Elegir jugador</option>
                  {(directory.data ?? [])
                    .filter(
                      (user) => !tournament.players.some((player) => player.userId === user.id),
                    )
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}
                      </option>
                    ))}
                </select>
                <select
                  className={controlClass}
                  value={enrollMethod}
                  onChange={(event) => setEnrollMethod(event.target.value as "cash" | "transfer")}
                >
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                </select>
                <button
                  className="gold-btn min-h-12 shrink-0 rounded-xl px-4 disabled:opacity-50"
                  type="submit"
                  disabled={enroll.isPending || !enrollId}
                >
                  Inscribir y cobrar
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        {layout.map((region) => {
          if (region === "clock") {
            return (
              <section key={region} className="card p-4">
                <div className="flex items-center justify-between">
                  <p>Nivel {clock.data?.levelNo ?? "—"}</p>
                  {tournament?.status === "live" ? (
                    <span className="rounded-full bg-emerald-700 px-2 py-1 text-xs">En vivo</span>
                  ) : (
                    <span className="text-xs">{label(tournament?.status ?? "")}</span>
                  )}
                </div>
                <p className="font-display text-6xl text-[var(--gold)]">{formatClock(remaining)}</p>
                <p className="text-sm text-white/70">{label(clock.data?.state ?? "stopped")}</p>
                <p className="mt-3 text-2xl">
                  {clock.data?.kind === "break"
                    ? "Descanso"
                    : `${clock.data?.smallBlind ?? "—"} / ${clock.data?.bigBlind ?? "—"}`}
                </p>
                <p className="text-sm text-white/60">
                  Siguiente:{" "}
                  {clock.data?.next
                    ? `${clock.data.next.smallBlind} / ${clock.data.next.bigBlind}`
                    : "fin"}
                </p>
                {canAdmin ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Ghost
                      type="button"
                      onClick={() =>
                        action.mutate(
                          clock.data?.state === "running"
                            ? "pause"
                            : clock.data?.state === "paused"
                              ? "resume"
                              : "start",
                        )
                      }
                    >
                      {clock.data?.state === "running" ? "Pausa" : "Play"}
                    </Ghost>
                    <Ghost type="button" onClick={() => action.mutate("next")}>
                      Siguiente nivel
                    </Ghost>
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-white/50">
                  {tournament?.ladderMode === "template"
                    ? `Escalera desde ₡${tournament.blindSmallStep}/₡${tournament.blindSmallStep * 2}. Hasta el nivel 11 dura 10 minutos y desde el 12 dura 12. Después de la tabla el small sigue subiendo ₡${tournament.blindSmallStep * 10} hasta que el torneo termine.`
                    : "La escalera es la que armaste a mano."}{" "}
                  {clock.data?.levelAdvance === "manual"
                    ? "Al llegar a cero el reloj espera y el administrador pasa el nivel."
                    : "Al llegar a cero el reloj pasa solo al siguiente nivel."}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  El sonido usa Web Audio después de tocar la pantalla. En iOS, una alarma puede no
                  sonar si la app está en segundo plano. El reloj oficial sigue en el servidor.
                </p>
                <Link className="mt-2 block text-sm text-[var(--gold)]" to={`/torneos/${id}/tv`}>
                  Modo TV
                </Link>
              </section>
            );
          }
          if (region === "players" && tournament) {
            return (
              <section key={region} className="card overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="text-white/50">
                    <tr>
                      <th className="p-3">Jugador</th>
                      <th>Entradas</th>
                      <th>Pagado</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tournament.players.map((player) => {
                      const busted = player.playerStatus === "eliminated";
                      const lastBuy =
                        !busted &&
                        player.playerStatus === "active" &&
                        player.entryCount >= player.maxEntries;
                      return (
                        <tr
                          key={player.userId}
                          className={`border-t border-white/10 ${
                            busted ? "bg-zinc-800 text-white/40" : lastBuy ? "bg-amber-950/70" : ""
                          }`}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {busted ? <Skull /> : <Avatar name={player.displayName} />}
                              <div>
                                <p>
                                  {player.displayName}
                                  {player.isHost ? " · Anfitrión" : ""}
                                  {player.memberRole === "admin" ? " · Administrador" : ""}
                                  {player.isCashier ? " · Cajero" : ""}
                                  {busted ? " · BUSTED" : ""}
                                </p>
                                <p className="text-xs text-white/50">
                                  Recompras {player.rebuyCount}/{player.rebuyCap}
                                  {lastBuy ? " · última entrada usada" : ""}
                                </p>
                                {canHandleMoney && player.initialState === "missing" ? (
                                  <div className="mt-1 flex gap-2">
                                    <button
                                      className="text-xs text-[var(--gold)]"
                                      type="button"
                                      onClick={() =>
                                        payInitial.mutate({ userId: player.userId, method: "cash" })
                                      }
                                    >
                                      Cobrar efectivo
                                    </button>
                                    <button
                                      className="text-xs text-[var(--gold)]"
                                      type="button"
                                      onClick={() =>
                                        payInitial.mutate({
                                          userId: player.userId,
                                          method: "transfer",
                                        })
                                      }
                                    >
                                      Cobrar transferencia
                                    </button>
                                  </div>
                                ) : null}
                                {canHandleMoney && lastBuy ? (
                                  <button
                                    className="mt-1 text-xs text-red-300"
                                    type="button"
                                    onClick={() => bust.mutate(player.userId)}
                                  >
                                    Marcar BUSTED
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            {player.entryCount}/{player.maxEntries}
                          </td>
                          <td>
                            <Amount value={player.collectedMinor} currency={tournament.currency} />
                          </td>
                          <td>{label(player.playerStatus)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          }
          if (region === "money" && tournament) {
            return (
              <section key={region} className="grid grid-cols-3 gap-2">
                <article className="card p-3">
                  <p className="text-xs text-white/60">Fondo proyectado</p>
                  <p className="text-lg">
                    <Amount
                      value={tournament.summary.projectedPoolMinor}
                      currency={tournament.currency}
                    />
                  </p>
                </article>
                <article className="card p-3">
                  <p className="text-xs text-white/60">Entradas</p>
                  <p className="text-lg">{tournament.summary.entryCount}</p>
                </article>
                <article className="card p-3">
                  <p className="text-xs text-white/60">Jugadores</p>
                  <p className="text-lg">{tournament.summary.playerCount}</p>
                </article>
              </section>
            );
          }
          if (region === "actions") {
            return (
              <section key={region} className="grid grid-cols-2 gap-2">
                <Link
                  className="gold-btn rounded-xl px-3 py-3 text-center"
                  to={`/torneos/${id}/recompra`}
                >
                  Solicitar recompra
                </Link>
                <Link
                  className="blood-btn rounded-xl px-3 py-3 text-center"
                  to={`/torneos/${id}/pagos`}
                >
                  Registrar pago
                </Link>
                <Link className="card px-3 py-3 text-center" to={`/torneos/${id}/aprobaciones`}>
                  Aprobaciones
                </Link>
                <Link className="card px-3 py-3 text-center" to={`/torneos/${id}/finanzas`}>
                  Finanzas
                </Link>
                <Link
                  className="card col-span-2 px-3 py-3 text-center"
                  to={`/torneos/${id}/resultados`}
                >
                  Resultados
                </Link>
              </section>
            );
          }
          return null;
        })}
      </div>
    </Shell>
  );
}

export function RebuyPage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Profile>("/me") });
  const client = useQueryClient();
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [note, setNote] = useState("");
  const mine = detail.data?.players.find((player) => player.userId === me.data?.id);
  const send = useMutation({
    mutationFn: () =>
      api(`/tournaments/${id}/rebuy-requests`, {
        method: "POST",
        body: JSON.stringify({ method, note }),
      }),
    onSuccess: async () => {
      setNote("");
      await client.invalidateQueries({ queryKey: ["tournament", id] });
    },
  });
  return (
    <Shell title="Solicitar recompra" back={`/torneos/${id}`}>
      {mine && detail.data ? (
        <p className="mb-3 text-sm text-white/70">
          {mine.displayName} · recompras {mine.rebuyCount}/{mine.rebuyCap} · precio{" "}
          <Amount value={detail.data.rebuyPriceMinor} currency={detail.data.currency} />
        </p>
      ) : null}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <fieldset className="flex gap-4">
          <label>
            <input type="radio" checked={method === "cash"} onChange={() => setMethod("cash")} />{" "}
            Efectivo
          </label>
          <label>
            <input
              type="radio"
              checked={method === "transfer"}
              onChange={() => setMethod("transfer")}
            />{" "}
            Transferencia
          </label>
        </fieldset>
        <Field label="Observaciones (opcional)">
          <input
            className={controlClass}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Sin datos bancarios"
          />
        </Field>
        <Primary type="submit" disabled={send.isPending}>
          Enviar solicitud
        </Primary>
        <ErrorText error={send.error} />
      </form>
      <h2 className="mt-6 mb-2 font-semibold">Pendientes</h2>
      <ul className="space-y-2">
        {detail.data?.rebuyRequests
          .filter((request) => request.status === "pending")
          .map((request) => (
            <li key={request.id} className="card flex justify-between p-3 text-sm">
              <span>{request.displayName}</span>
              <span>{label(request.status)}</span>
            </li>
          ))}
      </ul>
    </Shell>
  );
}

export function ApprovalsPage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const { canHandleMoney } = useMoneyAccess(detail.data?.players, detail.data?.cashierUserId);
  const client = useQueryClient();
  const [methods, setMethods] = useState<Record<string, "cash" | "transfer">>({});
  const decide = useMutation({
    mutationFn: ({
      requestId,
      kind,
      method,
    }: {
      requestId: string;
      kind: "approve" | "reject";
      method?: "cash" | "transfer";
    }) =>
      api(`/tournaments/${id}/rebuy-requests/${requestId}/${kind}`, {
        method: "POST",
        body:
          kind === "reject" ? JSON.stringify({ reason: "Rechazada" }) : JSON.stringify({ method }),
      }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const pending =
    detail.data?.rebuyRequests.filter((request) => request.status === "pending") ?? [];
  return (
    <Shell title="Solicitudes de recompra" back={`/torneos/${id}`}>
      <p className="mb-3 text-sm text-white/70">
        Solo el cajero o un administrador pueden aprobar, y eligen efectivo o transferencia.
      </p>
      <ul className="space-y-3">
        {pending.map((request) => (
          <li key={request.id} className="card p-3">
            <div className="flex items-center gap-3">
              <Avatar name={request.displayName} />
              <div>
                <p className="font-semibold">{request.displayName}</p>
                <p className="text-sm">
                  <Amount
                    value={detail.data?.rebuyPriceMinor ?? 0}
                    currency={detail.data?.currency ?? "CRC"}
                  />{" "}
                  · {label(request.method ?? "cash")}
                </p>
              </div>
            </div>
            {canHandleMoney ? (
              <div className="mt-3 space-y-2">
                <fieldset className="flex gap-4 text-sm">
                  <label>
                    <input
                      type="radio"
                      name={`metodo-${request.id}`}
                      checked={(methods[request.id] ?? "cash") === "cash"}
                      onChange={() =>
                        setMethods((current) => ({ ...current, [request.id]: "cash" }))
                      }
                    />{" "}
                    Efectivo
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`metodo-${request.id}`}
                      checked={methods[request.id] === "transfer"}
                      onChange={() =>
                        setMethods((current) => ({ ...current, [request.id]: "transfer" }))
                      }
                    />{" "}
                    Transferencia
                  </label>
                </fieldset>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="min-h-11 rounded-xl bg-emerald-700"
                    type="button"
                    onClick={() =>
                      decide.mutate({
                        requestId: request.id,
                        kind: "approve",
                        method: methods[request.id] ?? "cash",
                      })
                    }
                  >
                    Aprobar
                  </button>
                  <button
                    className="blood-btn min-h-11 rounded-xl"
                    type="button"
                    onClick={() => decide.mutate({ requestId: request.id, kind: "reject" })}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/60">Pendiente de aprobación</p>
            )}
          </li>
        ))}
        {pending.length === 0 ? <p>No hay solicitudes pendientes.</p> : null}
      </ul>
      <ErrorText error={decide.error} />
    </Shell>
  );
}

function ReportedActions({
  suggested,
  onConfirm,
  onVoid,
}: {
  suggested: "cash" | "transfer";
  onConfirm: (method: "cash" | "transfer") => void;
  onVoid: () => void;
}) {
  const [method, setMethod] = useState<"cash" | "transfer">(suggested);
  return (
    <div className="mt-2 space-y-2">
      <fieldset className="flex gap-4">
        <label>
          <input type="radio" checked={method === "cash"} onChange={() => setMethod("cash")} />{" "}
          Efectivo
        </label>
        <label>
          <input
            type="radio"
            checked={method === "transfer"}
            onChange={() => setMethod("transfer")}
          />{" "}
          Transferencia
        </label>
      </fieldset>
      <div className="flex gap-2">
        <button
          className="rounded-lg bg-emerald-700 px-3 py-2"
          type="button"
          onClick={() => onConfirm(method)}
        >
          Confirmar
        </button>
        <button className="rounded-lg bg-white/10 px-3 py-2" type="button" onClick={onVoid}>
          Anular
        </button>
      </div>
    </div>
  );
}

export function PaymentsPage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const { me, canAdmin, canHandleMoney } = useMoneyAccess(
    detail.data?.players,
    detail.data?.cashierUserId,
  );
  const client = useQueryClient();
  const [userId, setUserId] = useState("");
  useEffect(() => {
    if (!canAdmin && me.data) setUserId(me.data.id);
  }, [canAdmin, me.data]);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [reference, setReference] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/tournaments/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          userId,
          method,
          amountMinor: Number(amount),
          reference: reference || undefined,
        }),
      }),
    onSuccess: async () => {
      setAmount("");
      setReference("");
      await client.invalidateQueries({ queryKey: ["tournament", id] });
    },
  });
  const confirm = useMutation({
    mutationFn: ({ paymentId, method }: { paymentId: string; method: "cash" | "transfer" }) =>
      api(`/tournaments/${id}/payments/${paymentId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ method }),
      }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const voidPayment = useMutation({
    mutationFn: (paymentId: string) =>
      api(`/tournaments/${id}/payments/${paymentId}/void`, { method: "POST", body: "{}" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  return (
    <Shell title="Pagos" back={`/torneos/${id}`}>
      <p className="mb-3 text-sm text-white/70">
        Un pago reportado no cuenta como cobrado hasta que se confirma. No escribas números de
        cuenta.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        {canAdmin ? (
          <Field label="Jugador">
            <select
              className={controlClass}
              required
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">Elegir</option>
              {detail.data?.players.map((player) => (
                <option key={player.userId} value={player.userId}>
                  {player.displayName}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-sm text-white/70">
            El pago queda a tu nombre hasta que el cajero o un administrador confirme si fue
            efectivo o transferencia.
          </p>
        )}
        <Field label="Importe en colones">
          <input
            className={controlClass}
            inputMode="numeric"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <fieldset className="flex gap-4">
          <label>
            <input type="radio" checked={method === "cash"} onChange={() => setMethod("cash")} />{" "}
            Efectivo
          </label>
          <label>
            <input
              type="radio"
              checked={method === "transfer"}
              onChange={() => setMethod("transfer")}
            />{" "}
            Transferencia
          </label>
        </fieldset>
        <Field label="Referencia corta">
          <input
            className={controlClass}
            maxLength={80}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
        <Primary type="submit" disabled={create.isPending || !userId}>
          Registrar como reportado
        </Primary>
      </form>
      <ul className="mt-4 space-y-2">
        {detail.data?.payments.map((payment) => (
          <li key={payment.id} className="card p-3 text-sm">
            <p>
              {payment.displayName} ·{" "}
              <Amount value={payment.amountMinor} currency={detail.data?.currency ?? "CRC"} /> ·{" "}
              {label(payment.method)} · {label(payment.status)}
            </p>
            {canHandleMoney && payment.status === "reported" ? (
              <ReportedActions
                suggested={payment.method === "transfer" ? "transfer" : "cash"}
                onConfirm={(method) => confirm.mutate({ paymentId: payment.id, method })}
                onVoid={() => voidPayment.mutate(payment.id)}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <ErrorText error={create.error ?? confirm.error ?? voidPayment.error} />
    </Shell>
  );
}

export function FinancePage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const summary = detail.data?.summary;
  const currency = detail.data?.currency ?? "CRC";
  return (
    <Shell title="Resumen financiero" back={`/torneos/${id}`}>
      {summary ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <article className="card p-3">
              <p className="text-xs">Comprometido</p>
              <p className="text-xl text-emerald-300">
                <Amount value={summary.committedMinor} currency={currency} />
              </p>
            </article>
            <article className="card p-3">
              <p className="text-xs">Pendiente de cobro</p>
              <p className="text-xl text-amber-300">
                <Amount value={summary.outstandingMinor} currency={currency} />
              </p>
            </article>
          </div>
          <article className="card p-3 text-sm space-y-1">
            <p>
              Cobrado confirmado: <Amount value={summary.collectedMinor} currency={currency} />
            </p>
            <p>
              Fondo proyectado: <Amount value={summary.projectedPoolMinor} currency={currency} />
            </p>
            <p>Entradas iniciales ({summary.initialCount})</p>
            <p>Recompras ({summary.rebuyCount})</p>
            <p>
              Premios pagados: <Amount value={summary.prizesPaidMinor} currency={currency} />
            </p>
          </article>
          <article className="card p-3">
            <h2 className="mb-2 font-semibold">Premios proyectados</h2>
            {summary.projectedPrizes.map((prize) => (
              <p key={prize.place} className="flex justify-between text-sm">
                <span>
                  {prize.place}º · {prize.basisPoints / 100}%
                </span>
                <Amount value={prize.amountMinor} currency={currency} />
              </p>
            ))}
          </article>
          {summary.definitivePrizes ? (
            <article className="card p-3">
              <h2 className="mb-2 font-semibold">Premios definitivos</h2>
              {summary.definitivePrizes.map((prize) => (
                <p key={prize.place} className="flex justify-between text-sm">
                  <span>
                    {prize.place}º {prize.displayName}
                  </span>
                  <Amount value={prize.amountMinor} currency={currency} />
                </p>
              ))}
            </article>
          ) : null}
        </div>
      ) : null}
      <ErrorText error={detail.error} />
    </Shell>
  );
}

export function ResultsPage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const client = useQueryClient();
  const [winners, setWinners] = useState<string[]>([]);
  const finalize = useMutation({
    mutationFn: () =>
      api(`/tournaments/${id}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          winners: (detail.data?.prizeRules ?? []).map((rule, index) => ({
            place: rule.place,
            userId: winners[index],
          })),
        }),
      }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const payout = useMutation({
    mutationFn: (place: number) => {
      const prize = detail.data?.summary.definitivePrizes?.find((item) => item.place === place);
      return api(`/tournaments/${id}/prize-payouts`, {
        method: "POST",
        body: JSON.stringify({ place, amountMinor: prize?.amountMinor ?? 0, method: "cash" }),
      });
    },
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const close = useMutation({
    mutationFn: () => api(`/tournaments/${id}/close`, { method: "POST", body: "{}" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["tournament", id] }),
  });
  const prizes =
    detail.data?.summary.definitivePrizes ?? detail.data?.summary.projectedPrizes ?? [];
  return (
    <Shell title="Resultados" back={`/torneos/${id}`}>
      <div className="space-y-3">
        {prizes.map((prize, index) => (
          <article key={prize.place} className="card p-3">
            <p className="font-display text-xl text-[var(--gold)]">{prize.place}º</p>
            {"displayName" in prize ? (
              <p>{prize.displayName}</p>
            ) : (
              <select
                className={controlClass}
                value={winners[index] ?? ""}
                onChange={(event) =>
                  setWinners((rows) => {
                    const next = [...rows];
                    next[index] = event.target.value;
                    return next;
                  })
                }
              >
                <option value="">Ganador</option>
                {detail.data?.players.map((player) => (
                  <option key={player.userId} value={player.userId}>
                    {player.displayName}
                  </option>
                ))}
              </select>
            )}
            <p>
              <Amount value={prize.amountMinor} currency={detail.data?.currency ?? "CRC"} />
            </p>
            {"displayName" in prize ? (
              <button
                className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm"
                type="button"
                onClick={() => payout.mutate(prize.place)}
              >
                Marcar premio pagado
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {detail.data?.status === "live" ? (
        <div className="mt-4">
          <Primary
            type="button"
            disabled={
              finalize.isPending ||
              prizes.length === 0 ||
              prizes.some((_, index) => !winners[index]) ||
              new Set(winners.filter(Boolean)).size !== prizes.length
            }
            onClick={() => finalize.mutate()}
          >
            Finalizar
          </Primary>
          <p className="mt-2 text-sm text-white/60">Elige un jugador distinto en cada puesto.</p>
        </div>
      ) : null}
      {detail.data?.status === "finalizing" ? (
        <div className="mt-4">
          <Ghost type="button" onClick={() => close.mutate()}>
            Cerrar torneo
          </Ghost>
        </div>
      ) : null}
      <ErrorText error={finalize.error ?? payout.error ?? close.error} />
    </Shell>
  );
}

export function TvPage() {
  const { id = "" } = useParams();
  const detail = useDetail(id);
  const { clock, remaining } = useLiveClock(id);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm tracking-[0.3em] text-[var(--gold)]">
        {detail.data?.title ?? "Torneo"}
      </p>
      <p className="text-2xl">Nivel {clock.data?.levelNo}</p>
      <p className="font-display text-8xl text-[var(--gold)]">{formatClock(remaining)}</p>
      <p className="text-4xl">
        {clock.data?.kind === "break"
          ? "Descanso"
          : `${clock.data?.smallBlind} / ${clock.data?.bigBlind}`}
      </p>
      <p className="text-white/70">
        Siguiente{" "}
        {clock.data?.next ? `${clock.data.next.smallBlind} / ${clock.data.next.bigBlind}` : "—"}
      </p>
      <p className="text-3xl">
        Fondo{" "}
        <Amount
          value={detail.data?.summary.projectedPoolMinor ?? 0}
          currency={detail.data?.currency ?? "CRC"}
        />
      </p>
      <Link className="text-sm text-white/60" to={`/torneos/${id}`}>
        Salir del modo TV
      </Link>
    </div>
  );
}
