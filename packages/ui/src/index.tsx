import { formatAmount } from "@pkr/domain";

export function Money({ value, currency = "CRC" }: { value: number; currency?: string }) {
  return <span className="tabular-nums">{formatAmount(value, currency)}</span>;
}

export const defaultTokens = {
  felt: "#075C46",
  ink: "#090D12",
  gold: "#D4AF37",
  blood: "#D62839",
  radius: 16,
  layout: ["clock", "players", "money", "actions"],
};

export function applyTokens(tokens: typeof defaultTokens): void {
  const root = document.documentElement;
  root.style.setProperty("--felt", tokens.felt);
  root.style.setProperty("--ink", tokens.ink);
  root.style.setProperty("--gold", tokens.gold);
  root.style.setProperty("--blood", tokens.blood);
  root.style.setProperty("--radius", `${tokens.radius}px`);
}
