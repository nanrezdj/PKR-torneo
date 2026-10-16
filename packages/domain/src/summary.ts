import { DomainError } from "./errors";
import { type PrizeRule, type PrizeShare, allocatePrizes } from "./prizes";

export type EntryKind = "initial" | "rebuy";

export type FinancialSummary = {
  committedMinor: bigint;
  collectedMinor: bigint;
  outstandingMinor: bigint;
  projectedPoolMinor: bigint;
  projectedPrizes: PrizeShare[];
  definitivePrizes: { place: number; userId: string; amountMinor: bigint }[] | null;
  prizesPaidMinor: bigint;
  initialCount: number;
  rebuyCount: number;
};

export function summarize(input: {
  validEntries: { kind: EntryKind; amountMinor: bigint }[];
  confirmedAllocatedMinor: bigint;
  prizeRules: PrizeRule[];
  definitivePrizes: { place: number; userId: string; amountMinor: bigint }[] | null;
  prizesPaidMinor: bigint;
}): FinancialSummary {
  const committedMinor = input.validEntries.reduce((sum, entry) => sum + entry.amountMinor, 0n);
  const collectedMinor = input.confirmedAllocatedMinor;
  const outstandingMinor = committedMinor - collectedMinor;
  if (outstandingMinor < 0n) {
    throw new DomainError("El cobrado confirmado supera lo comprometido");
  }
  if (input.prizesPaidMinor < 0n)
    throw new DomainError("Los premios pagados no pueden ser negativos");
  const projectedPrizes = allocatePrizes(committedMinor, input.prizeRules);
  if (input.definitivePrizes) {
    const definitiveSum = input.definitivePrizes.reduce(
      (sum, prize) => sum + prize.amountMinor,
      0n,
    );
    if (definitiveSum !== committedMinor) {
      throw new DomainError("Los premios definitivos no coinciden con el fondo válido");
    }
  }
  return {
    committedMinor,
    collectedMinor,
    outstandingMinor,
    projectedPoolMinor: committedMinor,
    projectedPrizes,
    definitivePrizes: input.definitivePrizes,
    prizesPaidMinor: input.prizesPaidMinor,
    initialCount: input.validEntries.filter((entry) => entry.kind === "initial").length,
    rebuyCount: input.validEntries.filter((entry) => entry.kind === "rebuy").length,
  };
}
