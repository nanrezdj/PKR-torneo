import {
  assertPrizeRules,
  percentToBasisPoints,
  templateCurveLength,
  templateLevel,
} from "@pkr/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "./api";
import { Amount, ErrorText, Field, Ghost, Primary, Shell, controlClass, label } from "./components";
import type { DirectoryUser, TournamentListItem } from "./types";

type BlindRow = { id: string; small: number; big: number; ante: number };

function stakeLevels(small: number, count: number): BlindRow[] {
  const rows: BlindRow[] = [];
  for (let index = 1; index <= count; index += 1) {
    const level = templateLevel(small, index);
    if (!level) break;
    rows.push({ id: crypto.randomUUID(), small: level.smallBlind, big: level.bigBlind, ante: 0 });
  }
  return rows;
}

function ladderNote(levelNo: number, small: number, big: number): string | null {
  if (levelNo === 9) return `Dos niveles de ${small}/${big}`;
  if (levelNo === 12) return "Aquí se cambia el menudo";
  return null;
}

export function TournamentsPage() {
  const list = useQuery({
    queryKey: ["tournaments"],
    queryFn: () => api<TournamentListItem[]>("/tournaments"),
  });
  return (
    <Shell title="Mis torneos">
      <p className="mb-3 text-sm text-white/60">
        Entorno local. Los números salen de la base, no del diseño.
      </p>
      <Link className="blood-btn mb-4 block rounded-xl px-4 py-3 text-center" to="/torneos/nuevo">
        Crear torneo
      </Link>
      <div className="space-y-3">
        {list.data?.map((tournament) => (
          <Link key={tournament.id} to={`/torneos/${tournament.id}`} className="card block p-4">
            <div className="flex items-center justify-between gap-3">
              <strong>{tournament.title}</strong>
              <span className="rounded-full bg-[var(--felt)] px-2 py-1 text-xs">
                {label(tournament.status)}
              </span>
            </div>
            <p className="mt-2 text-sm text-white/70">
              Entrada <Amount value={tournament.entry_price_minor} currency={tournament.currency} />{" "}
              · Recompra{" "}
              <Amount value={tournament.rebuy_price_minor} currency={tournament.currency} />
            </p>
          </Link>
        ))}
        {list.data?.length === 0 ? <p>Todavía no hay torneos. Crea el primero.</p> : null}
      </div>
      <ErrorText error={list.error} />
    </Shell>
  );
}

export function CreatePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<DirectoryUser[]>("/users") });
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Torneo de amigos");
  const [hostUserId, setHostUserId] = useState("");
  const [entry, setEntry] = useState("10000");
  const [rebuy, setRebuy] = useState("5000");
  const [entryMethod, setEntryMethod] = useState<"cash" | "transfer">("cash");
  const [maxRebuys, setMaxRebuys] = useState(4);
  const [places, setPlaces] = useState(3);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [levelAdvance, setLevelAdvance] = useState<"auto" | "manual">("auto");
  const [ladderMode, setLadderMode] = useState<"template" | "custom">("template");
  const [startSmall, setStartSmall] = useState("100");
  const [startBig, setStartBig] = useState("200");
  const [levelCount, setLevelCount] = useState<number>(templateCurveLength);
  const [adminUserId, setAdminUserId] = useState("");
  const [cashierUserId, setCashierUserId] = useState("");
  const [levels, setLevels] = useState(() => stakeLevels(100, templateCurveLength));
  const [percents, setPercents] = useState([
    { place: 1, value: "50" },
    { place: 2, value: "30" },
    { place: 3, value: "20" },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users.data ?? []).filter((user) =>
      `${user.displayName} ${user.email}`.toLowerCase().includes(needle),
    );
  }, [query, users.data]);

  const roster = useMemo(
    () => (users.data ?? []).filter((user) => user.id === hostUserId || selected.includes(user.id)),
    [hostUserId, selected, users.data],
  );

  const preview = useMemo(() => {
    const small = Number(startSmall);
    if (!Number.isInteger(small) || small <= 0) return [];
    const rows = [];
    for (let levelNo = 1; levelNo <= templateCurveLength; levelNo += 1) {
      const level = templateLevel(small, levelNo);
      if (!level) break;
      rows.push(level);
    }
    return rows;
  }, [startSmall]);

  useEffect(() => {
    if (ladderMode !== "custom") return;
    const small = Number(startSmall);
    if (!Number.isInteger(small) || small <= 0) return;
    setLevels(stakeLevels(small, Math.max(1, levelCount)));
  }, [ladderMode, startSmall, levelCount]);

  const inviteUser = useMutation({
    mutationFn: () =>
      api("/auth/invitations", { method: "POST", body: JSON.stringify({ email: invite }) }),
    onSuccess: async () => {
      setInvite("");
      await client.invalidateQueries({ queryKey: ["users"] });
    },
  });

  function syncPlaces(count: number) {
    setPlaces(count);
    const presets: Record<number, string[]> = {
      1: ["100"],
      2: ["60", "40"],
      3: ["50", "30", "20"],
      4: ["40", "30", "20", "10"],
    };
    const values = presets[count] ?? Array.from({ length: count }, () => "0");
    setPercents(values.map((value, index) => ({ place: index + 1, value })));
  }

  const create = useMutation({
    mutationFn: async () => {
      const prizeRules = percents.map((row) => ({
        place: row.place,
        basisPoints: percentToBasisPoints(row.value),
      }));
      assertPrizeRules(prizeRules);
      const small = Number(startSmall);
      if (!Number.isInteger(small) || small <= 0) {
        throw new Error("El small tiene que ser un monto entero en colones");
      }
      const rows =
        ladderMode === "template" ? [{ id: "nivel-1", small, big: small * 2, ante: 0 }] : levels;
      const memberIds = selected.filter((id) => id !== hostUserId);
      return api<{ id: string }>("/tournaments", {
        method: "POST",
        body: JSON.stringify({
          title,
          hostUserId,
          memberIds,
          currency: "CRC",
          entryPriceMinor: Number(entry),
          rebuyPriceMinor: Number(rebuy),
          maxRebuys,
          hostExtraRebuys: 1,
          entryMethod,
          adminUserId: adminUserId || hostUserId,
          cashierUserId: cashierUserId || adminUserId || hostUserId,
          levelAdvance,
          ladderMode,
          blindSmallStep: small,
          prizeRules,
          blindLevels: rows.map((level, index) => ({
            levelNo: index + 1,
            kind: "play",
            smallBlind: level.small,
            bigBlind: level.big,
            ante: level.ante,
            durationSeconds: minutes * 60,
          })),
        }),
      });
    },
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["tournaments"] });
      navigate(`/torneos/${created.id}`);
    },
  });

  return (
    <Shell title="Crear torneo" back="/torneos">
      <ol className="mb-4 flex gap-2 text-xs text-white/60">
        {["Reglas", "Jugadores", "Cómo se juega"].map((name, index) => (
          <li key={name} className={index === step ? "text-[var(--gold)]" : ""}>
            {index + 1}. {name}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!hostUserId) {
              setFormError("Elige al anfitrión");
              return;
            }
            setAdminUserId((current) => current || hostUserId);
            setCashierUserId((current) => current || hostUserId);
            setFormError(null);
            setStep(1);
          }}
        >
          <Field label="Nombre del torneo">
            <input
              className={controlClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={3}
            />
          </Field>
          <Field label="Anfitrión">
            <select
              className={controlClass}
              value={hostUserId}
              onChange={(event) => setHostUserId(event.target.value)}
              required
            >
              <option value="">Elegir</option>
              {users.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entrada inicial (CRC)">
              <input
                className={controlClass}
                inputMode="numeric"
                value={entry}
                onChange={(event) => setEntry(event.target.value)}
                required
              />
            </Field>
            <Field label="Recompra (CRC)">
              <input
                className={controlClass}
                inputMode="numeric"
                value={rebuy}
                onChange={(event) => setRebuy(event.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Máx. recompras por jugador">
            <select
              className={controlClass}
              value={maxRebuys}
              onChange={(event) => setMaxRebuys(Number(event.target.value))}
            >
              {[0, 1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>
                  {count} (total {count + 1} entradas)
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-white/60">
            El anfitrión puede tener 1 recompra adicional, al mismo precio. No es gratis.
          </p>
          <fieldset className="space-y-2 text-sm">
            <legend className="text-white/70">
              La primera entrada se cobra al inscribir. Con 6 jugadores a ₡10.000 el fondo ya suma
              ₡60.000.
            </legend>
            <label className="mr-4">
              <input
                type="radio"
                checked={entryMethod === "cash"}
                onChange={() => setEntryMethod("cash")}
              />{" "}
              Efectivo
            </label>
            <label>
              <input
                type="radio"
                checked={entryMethod === "transfer"}
                onChange={() => setEntryMethod("transfer")}
              />{" "}
              Transferencia
            </label>
          </fieldset>
          <Field label="Número de ganadores">
            <select
              className={controlClass}
              value={places}
              onChange={(event) => syncPlaces(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </Field>
          <ErrorText error={formError} />
          <Primary type="submit">Siguiente</Primary>
        </form>
      ) : null}
      {step === 1 ? (
        <div className="space-y-3">
          <input
            className={controlClass}
            placeholder="Buscar por nombre o email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="space-y-2">
            {filtered.map((user) => {
              const checked = user.id === hostUserId || selected.includes(user.id);
              return (
                <li key={user.id} className="card flex items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={user.id === hostUserId}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(user.id)
                          ? current.filter((id) => id !== user.id)
                          : [...current, user.id],
                      )
                    }
                  />
                  <div>
                    <p className="font-semibold">{user.displayName}</p>
                    <p className="text-sm text-white/60">{user.email}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              inviteUser.mutate();
            }}
          >
            <input
              className={controlClass}
              type="email"
              placeholder="Invitar por email"
              value={invite}
              onChange={(event) => setInvite(event.target.value)}
              required
            />
            <button className="gold-btn shrink-0 rounded-xl px-3" type="submit">
              Invitar
            </button>
          </form>
          <ErrorText error={inviteUser.error} />
          {inviteUser.isSuccess ? <p className="text-sm">Invitación en el buzón local.</p> : null}
          <Field label="Administrador de la mesa">
            <select
              className={controlClass}
              value={adminUserId}
              onChange={(event) => setAdminUserId(event.target.value)}
            >
              {roster.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cajero">
            <select
              className={controlClass}
              value={cashierUserId}
              onChange={(event) => setCashierUserId(event.target.value)}
            >
              {roster.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                  {user.id === adminUserId ? " · también administrador" : ""}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-white/60">
            El administrador puede ser también el cajero. Los dos tienen que estar inscritos en la
            mesa.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Ghost type="button" onClick={() => setStep(0)}>
              Atrás
            </Ghost>
            <Primary
              type="button"
              onClick={() => {
                const ids = roster.map((user) => user.id);
                const admin = ids.includes(adminUserId) ? adminUserId : hostUserId;
                const cashier = ids.includes(cashierUserId) ? cashierUserId : admin;
                setAdminUserId(admin);
                setCashierUserId(cashier);
                setStep(2);
              }}
            >
              Siguiente
            </Primary>
          </div>
        </div>
      ) : null}
      {step === 2 ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            create.mutate();
          }}
        >
          <p className="text-sm text-white/70">
            Con ₡100 / ₡200 la escalera sale de la tabla: 100/200, 200/400… 1000/2000, 2000/4000 y
            hasta 20000/40000. Si cambias el small, toda la tabla se recalcula. Después del nivel 27
            sigue subiendo hasta que el torneo termine.
          </p>
          <fieldset className="space-y-2 text-sm">
            <legend className="text-white/70">Cuando el tiempo llega a cero</legend>
            <label className="mr-4">
              <input
                type="radio"
                checked={levelAdvance === "auto"}
                onChange={() => setLevelAdvance("auto")}
              />{" "}
              Pasar solo al siguiente nivel
            </label>
            <label>
              <input
                type="radio"
                checked={levelAdvance === "manual"}
                onChange={() => setLevelAdvance("manual")}
              />{" "}
              Esperar y pasarlo a mano
            </label>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Small inicial (₡)">
              <input
                className={controlClass}
                inputMode="numeric"
                value={startSmall}
                onChange={(event) => {
                  const value = event.target.value;
                  setStartSmall(value);
                  const small = Number(value);
                  if (Number.isInteger(small) && small > 0) setStartBig(String(small * 2));
                }}
              />
            </Field>
            <Field label="Big inicial (₡)">
              <input className={controlClass} inputMode="numeric" value={startBig} readOnly />
            </Field>
          </div>
          {ladderMode === "template" ? (
            <div className="rounded-xl bg-white/5 p-3 text-sm">
              <p className="text-white/70">
                Hasta el nivel 11 cada nivel dura 10 minutos. Desde el 12, 12 minutos. Después del
                27 el small sube ₡{Number(startSmall) > 0 ? Number(startSmall) * 10 : "…"} por
                nivel.
              </p>
              <div className="mt-2 max-h-80 overflow-auto">
                <table className="w-full text-left">
                  <thead className="text-white/50">
                    <tr>
                      <th>Nivel</th>
                      <th>Small</th>
                      <th>Big</th>
                      <th>Min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((level) => {
                      const note = ladderNote(level.levelNo, level.smallBlind, level.bigBlind);
                      return (
                        <tr key={level.levelNo}>
                          <td className="py-1">{level.levelNo}</td>
                          <td>{level.smallBlind}</td>
                          <td>{level.bigBlind}</td>
                          <td>
                            {level.durationSeconds / 60}
                            {note ? <span className="ml-2 text-white/50">{note}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={ladderMode === "custom"}
              onChange={(event) => {
                setFormError(null);
                setLadderMode(event.target.checked ? "custom" : "template");
              }}
            />{" "}
            Quiero armar la escalera a mano
          </label>
          {ladderMode === "custom" ? (
            <>
              <Field label="Minutos de cada nivel">
                <input
                  className={controlClass}
                  type="number"
                  min={1}
                  value={minutes}
                  onChange={(event) => setMinutes(Number(event.target.value))}
                />
              </Field>
              <Field label="Cuántos niveles armar">
                <input
                  className={controlClass}
                  type="number"
                  min={1}
                  value={levelCount}
                  onChange={(event) => setLevelCount(Number(event.target.value))}
                />
              </Field>
              <p className="text-sm text-white/60">
                Si cambias el small o la cantidad, la tabla se vuelve a armar. Puedes corregir una
                fila mientras esos datos no cambien.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-white/50">
                    <tr>
                      <th>Nivel</th>
                      <th>Small (₡)</th>
                      <th>Big (₡)</th>
                      <th>Ante (₡)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levels.map((level, index) => (
                      <tr key={level.id}>
                        <td className="py-1">{index + 1}</td>
                        <td>
                          <input
                            className="w-28 bg-transparent"
                            inputMode="numeric"
                            value={level.small}
                            onChange={(event) => {
                              const small = Number(event.target.value);
                              setLevels((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        small,
                                        big: Number.isSafeInteger(small * 2) ? small * 2 : row.big,
                                      }
                                    : row,
                                ),
                              );
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="w-28 bg-transparent"
                            inputMode="numeric"
                            value={level.big}
                            onChange={(event) =>
                              setLevels((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, big: Number(event.target.value) }
                                    : row,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="w-16 bg-transparent"
                            inputMode="numeric"
                            value={level.ante}
                            onChange={(event) =>
                              setLevels((rows) =>
                                rows.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, ante: Number(event.target.value) }
                                    : row,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="text-sm text-[var(--gold)]"
                type="button"
                onClick={() => {
                  const step = Number(startSmall);
                  const level = templateLevel(
                    Number.isInteger(step) && step > 0 ? step : 100,
                    levels.length + 1,
                  );
                  if (!level) {
                    setFormError(
                      "Ese monto ya no cabe en colones enteros. Escribe el siguiente a mano.",
                    );
                    return;
                  }
                  setFormError(null);
                  setLevels((rows) => [
                    ...rows,
                    {
                      id: crypto.randomUUID(),
                      small: level.smallBlind,
                      big: level.bigBlind,
                      ante: 0,
                    },
                  ]);
                  setLevelCount((count) => count + 1);
                }}
              >
                + Agregar nivel
              </button>
            </>
          ) : null}
          <div className="space-y-2">
            {percents.map((row) => (
              <Field key={row.place} label={`${row.place}º puesto %`}>
                <input
                  className={controlClass}
                  value={row.value}
                  onChange={(event) =>
                    setPercents((rows) =>
                      rows.map((item) =>
                        item.place === row.place ? { ...item, value: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
            ))}
          </div>
          <ErrorText error={formError ?? create.error} />
          <div className="grid grid-cols-2 gap-2">
            <Ghost type="button" onClick={() => setStep(1)}>
              Atrás
            </Ghost>
            <Primary type="submit" disabled={create.isPending}>
              Crear torneo
            </Primary>
          </div>
        </form>
      ) : null}
    </Shell>
  );
}
