import { applyTokens, defaultTokens } from "@pkr/ui";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { api } from "./api";
import { CreatePage, TournamentsPage } from "./create";
import {
  ApprovalsPage,
  DashboardPage,
  FinancePage,
  PaymentsPage,
  RebuyPage,
  ResultsPage,
  TvPage,
} from "./live";
import { MenuPage, PlayersPage, SettingsPage } from "./menu";
import { AcceptPage, EnterPage, LoginPage, MailboxPage } from "./session";
import type { Profile, ThemeTokens } from "./types";

function ThemeGate({ children }: { children: ReactNode }) {
  const theme = useQuery({
    queryKey: ["theme"],
    queryFn: () => api<{ tokens: ThemeTokens } | null>("/themes/active"),
  });
  useEffect(() => {
    applyTokens(theme.data?.tokens ?? defaultTokens);
  }, [theme.data]);
  return children;
}

function Private({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Profile>("/me"), retry: false });
  if (me.isLoading) return <p className="p-8 text-center text-white/70">Cargando…</p>;
  if (!me.data) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <ThemeGate>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/entrar" element={<EnterPage />} />
        <Route path="/aceptar" element={<AcceptPage />} />
        <Route path="/buzon" element={<MailboxPage />} />
        <Route
          path="/torneos"
          element={
            <Private>
              <TournamentsPage />
            </Private>
          }
        />
        <Route
          path="/torneos/nuevo"
          element={
            <Private>
              <CreatePage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id"
          element={
            <Private>
              <DashboardPage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id/recompra"
          element={
            <Private>
              <RebuyPage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id/aprobaciones"
          element={
            <Private>
              <ApprovalsPage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id/pagos"
          element={
            <Private>
              <PaymentsPage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id/finanzas"
          element={
            <Private>
              <FinancePage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id/resultados"
          element={
            <Private>
              <ResultsPage />
            </Private>
          }
        />
        <Route
          path="/torneos/:id/tv"
          element={
            <Private>
              <TvPage />
            </Private>
          }
        />
        <Route
          path="/menu"
          element={
            <Private>
              <MenuPage />
            </Private>
          }
        />
        <Route
          path="/jugadores"
          element={
            <Private>
              <PlayersPage />
            </Private>
          }
        />
        <Route
          path="/configuracion"
          element={
            <Private>
              <SettingsPage />
            </Private>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeGate>
  );
}
