import { DomainError } from "./errors";
import { assertPositiveMinor } from "./money";

export type OpenObligation = { id: string; outstandingMinor: bigint };
export type Allocation = { entryId: string; amountMinor: bigint };

export function allocatePayment(amountMinor: bigint, entries: OpenObligation[]): Allocation[] {
  assertPositiveMinor(amountMinor, "El pago");
  const outstanding = entries.reduce((sum, entry) => sum + entry.outstandingMinor, 0n);
  if (amountMinor > outstanding) {
    throw new DomainError("El pago supera el pendiente de cobro");
  }
  let left = amountMinor;
  const allocations: Allocation[] = [];
  for (const entry of entries) {
    if (left === 0n) break;
    if (entry.outstandingMinor <= 0n) continue;
    const take = left < entry.outstandingMinor ? left : entry.outstandingMinor;
    allocations.push({ entryId: entry.id, amountMinor: take });
    left -= take;
  }
  if (left !== 0n) throw new DomainError("No se pudo asignar el pago completo");
  const assigned = allocations.reduce((sum, row) => sum + row.amountMinor, 0n);
  if (assigned !== amountMinor) throw new DomainError("La asignación no coincide con el pago");
  return allocations;
}

export function confirmedCollected(payments: { status: string; allocatedMinor: bigint }[]): bigint {
  return payments
    .filter((payment) => payment.status === "confirmed")
    .reduce((sum, payment) => sum + payment.allocatedMinor, 0n);
}
