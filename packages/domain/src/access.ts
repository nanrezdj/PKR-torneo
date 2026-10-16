import { DomainError } from "./errors";

export type GlobalRole = "player" | "super_admin";
export type MemberRole = "player" | "admin";

export const minimumPlayersToStart = 3;

export function assertMinimumPlayers(count: number): void {
  if (count < minimumPlayersToStart) {
    throw new DomainError("Hacen falta al menos 3 jugadores para iniciar");
  }
}

export function canReadTournament(globalRole: GlobalRole, isMember: boolean): boolean {
  return globalRole === "super_admin" || isMember;
}

export function canAdminister(globalRole: GlobalRole, memberRole: MemberRole | null): boolean {
  return globalRole === "super_admin" || memberRole === "admin";
}

export function canHandleMoney(
  globalRole: GlobalRole,
  memberRole: MemberRole | null,
  actorId: string,
  cashierUserId: string | null,
): boolean {
  return (
    canAdminister(globalRole, memberRole) || (cashierUserId !== null && actorId === cashierUserId)
  );
}
