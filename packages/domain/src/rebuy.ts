export function rebuyCap(isHost: boolean, maxRebuys: number, hostExtraRebuys: number): number {
  return isHost ? maxRebuys + hostExtraRebuys : maxRebuys;
}

export function maxEntries(isHost: boolean, maxRebuys: number, hostExtraRebuys: number): number {
  return 1 + rebuyCap(isHost, maxRebuys, hostExtraRebuys);
}

/** Las solicitudes pendientes no entran en validRebuyCount. */
export function canApproveRebuy(validRebuyCount: number, cap: number): boolean {
  return validRebuyCount < cap;
}

/** La recompra extra del anfitrión cuesta lo mismo que cualquier recompra. */
export function rebuyUnitPrice(rebuyPriceMinor: bigint): bigint {
  return rebuyPriceMinor;
}
