import { DomainError } from "./errors";

export function toMinor(value: number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) {
    throw new DomainError("El importe debe ser un entero en la unidad mínima");
  }
  return BigInt(value);
}

export function assertPositiveMinor(value: bigint, label: string): void {
  if (value <= 0n) throw new DomainError(`${label} debe ser mayor que cero`);
}

export function minorToNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new DomainError("El importe excede el rango seguro de enteros");
  }
  return Number(value);
}

/** Agrupa miles con punto: ₡10.000. No participa en ningún cálculo. */
export function formatAmount(minor: bigint | number, currency = "CRC"): string {
  const value = typeof minor === "bigint" ? minorToNumber(minor) : minor;
  if (!Number.isSafeInteger(value)) {
    throw new DomainError("El importe debe ser un entero en la unidad mínima");
  }
  const body = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value);
  return currency === "CRC" ? `₡${body}` : `${body} ${currency}`;
}

export function percentToBasisPoints(input: string): number {
  const trimmed = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new DomainError("El porcentaje debe tener como máximo 2 decimales");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new DomainError("El porcentaje está fuera de rango");
  }
  return basisPoints;
}

export function formatPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return `${whole}%`;
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}%`;
  return `${whole}.${String(fraction).padStart(2, "0")}%`;
}
