import { Money } from "@pkr/ui";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";

export function Shell({
  title,
  back,
  wide = false,
  children,
}: {
  title: string;
  back?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto min-h-screen w-full pb-24 ${wide ? "max-w-6xl" : "max-w-md"}`}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-[var(--ink)]/90 px-4 py-3 backdrop-blur">
        {back ? (
          <Link
            to={back}
            className="grid h-11 w-11 place-items-center rounded-full text-[var(--gold)]"
            aria-label="Volver"
          >
            ←
          </Link>
        ) : null}
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>
      <main className="px-4 py-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0c1117]/95 backdrop-blur">
        <div className="mx-auto flex max-w-md">
          <Link className="flex-1 py-3 text-center text-sm font-semibold" to="/torneos">
            Torneos
          </Link>
          <Link className="flex-1 py-3 text-center text-sm font-semibold" to="/menu">
            Menú
          </Link>
        </div>
      </nav>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // El control llega como children; Biome no lo ve de forma estática.
    // biome-ignore lint/a11y/noLabelWithoutControl: el input es el children
    <label className="block space-y-1 text-sm">
      <span className="text-white/70">{label}</span>
      {children}
    </label>
  );
}

export const controlClass =
  "min-h-12 w-full rounded-xl border border-white/10 bg-black/30 px-3 outline-none";

export function Primary({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="blood-btn min-h-12 w-full rounded-xl px-4 disabled:opacity-50" {...props}>
      {children}
    </button>
  );
}

export function Gold({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="gold-btn min-h-12 w-full rounded-xl px-4 disabled:opacity-50" {...props}>
      {children}
    </button>
  );
}

export function Ghost({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="min-h-12 w-full rounded-xl border border-white/20 px-4 disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}

export function Amount({ value, currency }: { value: number; currency: string }) {
  return <Money value={value} currency={currency} />;
}

export function Skull() {
  return (
    <svg
      aria-label="BUSTED"
      className="inline-block h-5 w-5 text-white"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <title>BUSTED</title>
      <path d="M12 2a8 8 0 0 0-8 8c0 2.4 1.1 4.2 2.2 5.4.4.5.8 1.3.8 2.1V19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1.5c0-.8.4-1.6.8-2.1A8 8 0 0 0 12 2Zm-3 8.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Zm6 0a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2ZM10 16.5h4v1.2h-1.2V19h-1.6v-1.3H10v-1.2Z" />
    </svg>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--felt)] text-sm font-bold"
      aria-hidden
    >
      {initials}
    </span>
  );
}

const labels: Record<string, string> = {
  draft: "Borrador",
  ready: "Listo",
  live: "En vivo",
  finalizing: "En cierre",
  closed: "Cerrado",
  archived: "Archivado",
  registered: "Inscrito",
  active: "Activo",
  withdrawn: "Retirado",
  eliminated: "BUSTED",
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  reported: "Reportado",
  confirmed: "Confirmado",
  voided: "Anulado",
  cash: "Efectivo",
  transfer: "Transferencia",
  other: "Otro",
  stopped: "Detenido",
  running: "En marcha",
  paused: "En pausa",
  finished: "Terminado",
  play: "Juego",
  break: "Descanso",
};

export function label(value: string): string {
  return labels[value] ?? value;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-300">{error instanceof Error ? error.message : "Error"}</p>;
}
