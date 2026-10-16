import { DomainError } from "./errors";

export const CRITICAL_REGIONS = ["clock", "players", "money", "actions"] as const;
export type CriticalRegion = (typeof CRITICAL_REGIONS)[number];

export function assertLayout(regions: string[]): void {
  const missing = CRITICAL_REGIONS.filter((region) => !regions.includes(region));
  if (missing.length > 0) {
    throw new DomainError("No se puede ocultar el reloj, los jugadores, el dinero ni las acciones");
  }
  if (new Set(regions).size !== regions.length) {
    throw new DomainError("Hay regiones repetidas");
  }
}
