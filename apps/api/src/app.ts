import {
  acceptInvitationSchema,
  addMemberSchema,
  assignCashierSchema,
  clockActionSchema,
  createTournamentSchema,
  finalizeSchema,
  invitationSchema,
  magicLinkSchema,
  moneyMethodSchema,
  paymentSchema,
  prizePayoutSchema,
  rebuyRequestSchema,
  rejectRebuySchema,
  themeSchema,
  verifyMagicLinkSchema,
  withdrawSchema,
} from "@pkr/contracts";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { d1Adapter } from "./db/d1";
import { broadcast } from "./durable/broadcast";
import { createEmailProvider } from "./email";
import type { AppEnv } from "./env";
import { ApiError, asApiError, parseBody, requireUser, withIdempotency } from "./http";
import {
  acceptInvitation,
  inviteUser,
  logout,
  profileByToken,
  requestMagicLink,
  verifyMagicLink,
} from "./services/auth";
import { actOnClock, readClock } from "./services/clock";
import { confirmPayment, createPayment, voidPayment } from "./services/payments";
import { getSummary, getTournament } from "./services/read";
import { approveRebuy, listRebuyRequests, rejectRebuy, requestRebuy } from "./services/rebuy";
import { closeTournament, finalizeTournament, payPrize } from "./services/results";
import { assertCanRead } from "./services/support";
import { activeTheme, restoreTheme, saveTheme } from "./services/themes";
import {
  addMember,
  assignCashier,
  bustPlayer,
  collectInitialPayment,
  createTournament,
  listTournaments,
  listUsers,
  startTournament,
  withdrawPlayer,
} from "./services/tournaments";

function writeSession(c: Context<AppEnv>, token: string): void {
  setCookie(c, "pkr_session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api/v1");

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    const token = getCookie(c, "pkr_session");
    c.set("user", token ? await profileByToken(d1Adapter(c.env.DB), token) : null);
    await next();
  });

  app.onError((error, c) => {
    const apiError = asApiError(error);
    return c.json(
      {
        error: {
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
          requestId: c.get("requestId"),
        },
      },
      apiError.status as 400,
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: { code: "NOT_FOUND", message: "Ruta no encontrada", requestId: c.get("requestId") },
      },
      404,
    ),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/auth/invitations", async (c) => {
    const user = requireUser(c.get("user"));
    if (user.role !== "super_admin")
      throw new ApiError(403, "FORBIDDEN", "Solo un super admin invita");
    const input = await parseBody(await c.req.text(), invitationSchema);
    const db = d1Adapter(c.env.DB);
    const result = await inviteUser(
      db,
      user.id,
      input.email,
      c.env.APP_ORIGIN,
      createEmailProvider(db, c.env),
    );
    return c.json(result, 202);
  });

  app.post("/auth/invitations/accept", async (c) => {
    const input = await parseBody(await c.req.text(), acceptInvitationSchema);
    const result = await acceptInvitation(d1Adapter(c.env.DB), input.token, input.displayName);
    writeSession(c, result.token);
    return c.json(result.profile);
  });

  app.post("/auth/magic-link", async (c) => {
    const input = await parseBody(await c.req.text(), magicLinkSchema);
    const db = d1Adapter(c.env.DB);
    await requestMagicLink(db, input.email, c.env.APP_ORIGIN, createEmailProvider(db, c.env));
    return c.json({ ok: true }, 202);
  });

  app.post("/auth/magic-link/verify", async (c) => {
    const input = await parseBody(await c.req.text(), verifyMagicLinkSchema);
    const result = await verifyMagicLink(d1Adapter(c.env.DB), input.token);
    writeSession(c, result.token);
    return c.json(result.profile);
  });

  app.post("/auth/logout", async (c) => {
    const token = getCookie(c, "pkr_session");
    if (token) await logout(d1Adapter(c.env.DB), token);
    deleteCookie(c, "pkr_session", { path: "/" });
    return c.body(null, 204);
  });

  app.get("/me", (c) => c.json(requireUser(c.get("user"))));

  app.get("/dev/mailbox", async (c) => {
    if (c.env.ENVIRONMENT !== "development") throw new ApiError(404, "NOT_FOUND", "No disponible");
    const messages = await d1Adapter(c.env.DB)
      .prepare(
        "SELECT id, to_email AS toEmail, subject, body_text AS bodyText, provider, created_at AS createdAt FROM email_outbox ORDER BY created_at DESC LIMIT 30",
      )
      .all();
    return c.json({ messages });
  });

  app.get("/users", async (c) => {
    const user = requireUser(c.get("user"));
    return c.json(await listUsers(d1Adapter(c.env.DB), user, c.req.query("q") ?? ""));
  });

  app.get("/themes/active", async (c) => c.json(await activeTheme(d1Adapter(c.env.DB))));

  app.put("/themes/draft", async (c) => {
    const user = requireUser(c.get("user"));
    if (user.role !== "super_admin")
      throw new ApiError(403, "FORBIDDEN", "Solo un super admin edita el tema");
    const input = await parseBody(await c.req.text(), themeSchema);
    return c.json(await saveTheme(d1Adapter(c.env.DB), user.id, input, false));
  });

  app.post("/themes/publish", async (c) => {
    const user = requireUser(c.get("user"));
    if (user.role !== "super_admin")
      throw new ApiError(403, "FORBIDDEN", "Solo un super admin publica el tema");
    const input = await parseBody(await c.req.text(), themeSchema);
    return c.json(await saveTheme(d1Adapter(c.env.DB), user.id, input, true));
  });

  app.post("/themes/restore", async (c) => {
    const user = requireUser(c.get("user"));
    if (user.role !== "super_admin")
      throw new ApiError(403, "FORBIDDEN", "Solo un super admin restaura el tema");
    await restoreTheme(d1Adapter(c.env.DB), user.id);
    return c.body(null, 204);
  });

  app.get("/tournaments", async (c) => {
    const user = requireUser(c.get("user"));
    return c.json(await listTournaments(d1Adapter(c.env.DB), user));
  });

  app.post("/tournaments", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      if (user.role !== "super_admin")
        throw new ApiError(403, "FORBIDDEN", "Solo un super admin crea torneos");
      const input = await parseBody(raw, createTournamentSchema);
      const body = await createTournament(d1Adapter(c.env.DB), user.id, input, idem);
      return { status: 201, body };
    }),
  );

  app.get("/tournaments/:id", async (c) => {
    const user = requireUser(c.get("user"));
    return c.json(await getTournament(d1Adapter(c.env.DB), c.req.param("id"), user));
  });

  app.get("/tournaments/:id/summary", async (c) => {
    const user = requireUser(c.get("user"));
    return c.json(await getSummary(d1Adapter(c.env.DB), c.req.param("id"), user));
  });

  app.get("/tournaments/:id/ledger", async (c) => {
    const user = requireUser(c.get("user"));
    const db = d1Adapter(c.env.DB);
    await assertCanRead(db, c.req.param("id"), user);
    const entries = await db
      .prepare(
        `SELECT id, user_id AS userId, entry_id AS entryId, payment_id AS paymentId, kind, amount_minor AS amountMinor, direction, created_at AS createdAt
         FROM ledger_entries WHERE tournament_id = ? ORDER BY created_at, id`,
      )
      .bind(c.req.param("id"))
      .all();
    return c.json({ entries });
  });

  app.post("/tournaments/:id/members", async (c) => {
    const user = requireUser(c.get("user"));
    const input = await parseBody(await c.req.text(), addMemberSchema);
    await addMember(d1Adapter(c.env.DB), c.req.param("id"), input.userId, input.method, user);
    await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
    return c.json({ ok: true }, 201);
  });

  app.post("/tournaments/:id/initial-payment", async (c) => {
    const user = requireUser(c.get("user"));
    const input = await parseBody(await c.req.text(), addMemberSchema);
    await collectInitialPayment(
      d1Adapter(c.env.DB),
      c.req.param("id"),
      input.userId,
      input.method,
      user,
    );
    await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
    return c.json({ ok: true });
  });

  app.post("/tournaments/:id/bust", async (c) => {
    const user = requireUser(c.get("user"));
    const input = await parseBody(await c.req.text(), withdrawSchema);
    await bustPlayer(d1Adapter(c.env.DB), c.req.param("id"), input.userId, user);
    await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
    return c.json({ status: "eliminated" });
  });

  app.post("/tournaments/:id/cashier", async (c) => {
    const user = requireUser(c.get("user"));
    const input = await parseBody(await c.req.text(), assignCashierSchema);
    const body = await assignCashier(d1Adapter(c.env.DB), c.req.param("id"), input.userId, user);
    await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
    return c.json(body);
  });

  app.post("/tournaments/:id/withdraw", async (c) => {
    const user = requireUser(c.get("user"));
    const input = await parseBody(await c.req.text(), withdrawSchema);
    await withdrawPlayer(d1Adapter(c.env.DB), c.req.param("id"), input.userId, user);
    return c.body(null, 204);
  });

  app.post("/tournaments/:id/start", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      await parseBody(raw, z.object({}));
      const user = requireUser(c.get("user"));
      const body = await startTournament(d1Adapter(c.env.DB), c.req.param("id"), user, idem);
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 200, body };
    }),
  );

  app.post("/tournaments/:id/rebuy-requests", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, rebuyRequestSchema);
      const body = await requestRebuy(d1Adapter(c.env.DB), c.req.param("id"), user.id, input, idem);
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 201, body };
    }),
  );

  app.get("/tournaments/:id/rebuy-requests", async (c) => {
    const user = requireUser(c.get("user"));
    return c.json(await listRebuyRequests(d1Adapter(c.env.DB), c.req.param("id"), user));
  });

  app.post("/tournaments/:id/rebuy-requests/:requestId/approve", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, moneyMethodSchema);
      const body = await approveRebuy(
        d1Adapter(c.env.DB),
        c.req.param("id"),
        c.req.param("requestId"),
        user,
        input.method,
        idem,
      );
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 200, body };
    }),
  );

  app.post("/tournaments/:id/rebuy-requests/:requestId/reject", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, rejectRebuySchema);
      const body = await rejectRebuy(
        d1Adapter(c.env.DB),
        c.req.param("id"),
        c.req.param("requestId"),
        user,
        input.reason,
        idem,
      );
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 200, body };
    }),
  );

  app.post("/tournaments/:id/payments", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, paymentSchema);
      const body = await createPayment(d1Adapter(c.env.DB), c.req.param("id"), user, input, idem);
      return { status: 201, body };
    }),
  );

  app.post("/tournaments/:id/payments/:paymentId/confirm", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, moneyMethodSchema);
      const body = await confirmPayment(
        d1Adapter(c.env.DB),
        c.req.param("id"),
        c.req.param("paymentId"),
        user,
        input.method,
        idem,
      );
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 200, body };
    }),
  );

  app.post("/tournaments/:id/payments/:paymentId/void", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem) => {
      const user = requireUser(c.get("user"));
      const body = await voidPayment(
        d1Adapter(c.env.DB),
        c.req.param("id"),
        c.req.param("paymentId"),
        user,
        idem,
      );
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 200, body };
    }),
  );

  app.get("/tournaments/:id/clock", async (c) => {
    const user = requireUser(c.get("user"));
    return c.json(await readClock(d1Adapter(c.env.DB), c.req.param("id"), user, Date.now()));
  });

  app.post("/tournaments/:id/clock/actions", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, clockActionSchema);
      void idem;
      const body = await actOnClock(
        d1Adapter(c.env.DB),
        c.req.param("id"),
        user,
        input.action,
        input.expectedVersion,
        Date.now(),
      );
      await broadcast(c.env, c.req.param("id"), { type: "clock", clock: body });
      return { status: 200, body };
    }),
  );

  app.get("/tournaments/:id/events", async (c) => {
    const user = requireUser(c.get("user"));
    const tournamentId = c.req.param("id");
    await assertCanRead(d1Adapter(c.env.DB), tournamentId, user);
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw new ApiError(400, "VALIDATION_ERROR", "Esta ruta espera una conexión en tiempo real");
    }
    const url = new URL(c.req.url);
    url.searchParams.set("tournamentId", tournamentId);
    const stub = c.env.TOURNAMENT_ROOM.get(c.env.TOURNAMENT_ROOM.idFromName(tournamentId));
    return stub.fetch(new Request(url.toString(), c.req.raw));
  });

  app.post("/tournaments/:id/finalize", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, finalizeSchema);
      const body = await finalizeTournament(
        d1Adapter(c.env.DB),
        c.req.param("id"),
        user,
        input.winners,
        idem,
      );
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 200, body };
    }),
  );

  app.post("/tournaments/:id/close", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem) => {
      const user = requireUser(c.get("user"));
      const body = await closeTournament(d1Adapter(c.env.DB), c.req.param("id"), user, idem);
      return { status: 200, body };
    }),
  );

  app.post("/tournaments/:id/prize-payouts", (c) =>
    withIdempotency(c, d1Adapter(c.env.DB), async (idem, raw) => {
      const user = requireUser(c.get("user"));
      const input = await parseBody(raw, prizePayoutSchema);
      const body = await payPrize(d1Adapter(c.env.DB), c.req.param("id"), user, input, idem);
      await broadcast(c.env, c.req.param("id"), { type: "tournament-updated" });
      return { status: 201, body };
    }),
  );

  return app;
}
