import { DomainError } from "./errors";

export type PrizeRule = { place: number; basisPoints: number };
export type PrizeShare = { place: number; basisPoints: number; amountMinor: bigint };

export function assertPrizeRules(rules: PrizeRule[]): void {
  if (rules.length === 0) throw new DomainError("Define al menos un puesto de premio");
  const places = [...rules.map((rule) => rule.place)].sort((a, b) => a - b);
  for (let index = 0; index < places.length; index += 1) {
    if (places[index] !== index + 1) {
      throw new DomainError("Los puestos deben ser consecutivos y empezar en 1");
    }
  }
  if (new Set(places).size !== places.length) {
    throw new DomainError("Hay puestos repetidos");
  }
  let sum = 0;
  for (const rule of rules) {
    if (!Number.isInteger(rule.basisPoints) || rule.basisPoints <= 0 || rule.basisPoints > 10000) {
      throw new DomainError("Cada porcentaje debe ser mayor que 0 y como máximo 100");
    }
    sum += rule.basisPoints;
  }
  if (sum !== 10000) throw new DomainError("Los porcentajes deben sumar exactamente 100%");
}

/**
 * Método de Hamilton sobre enteros.
 * El residuo de 1 unidad mínima se entrega primero al mayor resto;
 * si empatan, gana el puesto más alto (place menor).
 */
export function allocatePrizes(poolMinor: bigint, rules: PrizeRule[]): PrizeShare[] {
  assertPrizeRules(rules);
  if (poolMinor < 0n) throw new DomainError("El fondo no puede ser negativo");
  const rows = rules.map((rule) => {
    const raw = poolMinor * BigInt(rule.basisPoints);
    return {
      place: rule.place,
      basisPoints: rule.basisPoints,
      base: raw / 10000n,
      remainder: raw % 10000n,
    };
  });
  let leftover = poolMinor - rows.reduce((sum, row) => sum + row.base, 0n);
  const order = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.place - b.place;
  });
  const extras = new Map<number, bigint>();
  for (const row of order) {
    if (leftover <= 0n) break;
    extras.set(row.place, 1n);
    leftover -= 1n;
  }
  if (leftover !== 0n) throw new DomainError("El reparto dejó unidades sin asignar");
  return [...rows]
    .sort((a, b) => a.place - b.place)
    .map((row) => ({
      place: row.place,
      basisPoints: row.basisPoints,
      amountMinor: row.base + (extras.get(row.place) ?? 0n),
    }));
}
