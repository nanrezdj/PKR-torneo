import { z } from "zod";

export const blindLevelSchema = z
  .object({
    levelNo: z.number().int().positive(),
    kind: z.enum(["play", "break"]),
    smallBlind: z.number().int().nonnegative(),
    bigBlind: z.number().int().nonnegative(),
    ante: z.number().int().nonnegative(),
    durationSeconds: z.number().int().positive(),
  })
  .superRefine((level, context) => {
    if (level.kind === "play" && level.bigBlind < level.smallBlind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La ciega grande debe ser al menos la pequeña",
      });
    }
  });

export const prizeRuleSchema = z.object({
  place: z.number().int().positive(),
  basisPoints: z.number().int().positive().max(10000),
});

export const createTournamentSchema = z.object({
  title: z.string().trim().min(3).max(80),
  hostUserId: z.string().uuid(),
  memberIds: z.array(z.string().uuid()).default([]),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("CRC"),
  entryPriceMinor: z.number().int().positive(),
  rebuyPriceMinor: z.number().int().positive(),
  maxRebuys: z.number().int().min(0).max(20).default(4),
  hostExtraRebuys: z.number().int().min(0).max(5).default(1),
  prizeRules: z.array(prizeRuleSchema).min(1),
  blindLevels: z.array(blindLevelSchema).min(1),
  entryMethod: z.enum(["cash", "transfer"]).default("cash"),
  adminUserId: z.string().uuid().optional(),
  cashierUserId: z.string().uuid().optional(),
  levelAdvance: z.enum(["auto", "manual"]).optional(),
  ladderMode: z.enum(["template", "custom"]).optional(),
  blindSmallStep: z.number().int().positive().optional(),
});

export const invitationSchema = z.object({
  email: z.string().trim().email().max(160),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(200),
  displayName: z.string().trim().min(2).max(80),
});

export const magicLinkSchema = z.object({
  email: z.string().trim().email().max(160),
});

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(32).max(200),
});

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  method: z.enum(["cash", "transfer"]),
});

export const assignCashierSchema = z.object({
  userId: z.string().uuid(),
});

export const moneyMethodSchema = z.object({
  method: z.enum(["cash", "transfer"]),
});

export const rebuyRequestSchema = z.object({
  method: z.enum(["cash", "transfer", "other"]).optional(),
  note: z.string().trim().max(200).optional(),
});

export const recordRebuySchema = z.object({
  userId: z.string().uuid(),
  method: z.enum(["cash", "transfer"]),
  note: z.string().trim().max(200).optional(),
});

export const rejectRebuySchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const paymentSchema = z.object({
  userId: z.string().uuid(),
  method: z.enum(["cash", "transfer", "other"]),
  amountMinor: z.number().int().positive(),
  reference: z.string().trim().max(80).optional(),
});

export const clockActionSchema = z.object({
  action: z.enum(["start", "pause", "resume", "next", "reset"]),
  expectedVersion: z.number().int().nonnegative(),
});

export const finalizeSchema = z.object({
  winners: z
    .array(z.object({ place: z.number().int().positive(), userId: z.string().uuid() }))
    .min(1),
});

export const prizePayoutSchema = z.object({
  place: z.number().int().positive(),
  amountMinor: z.number().int().positive(),
  method: z.enum(["cash", "transfer", "other"]),
});

export const withdrawSchema = z.object({
  userId: z.string().uuid(),
});

export const themeSchema = z.object({
  name: z.string().trim().min(2).max(40).default("Casino"),
  tokens: z.object({
    felt: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    gold: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    blood: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    radius: z.number().int().min(0).max(32),
    layout: z.array(z.string().min(1).max(40)).min(4),
  }),
});

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type ThemeInput = z.infer<typeof themeSchema>;

export type SessionProfile = {
  id: string;
  email: string;
  displayName: string;
  role: "player" | "super_admin";
};

export type MoneySummary = {
  currency: string;
  committedMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  projectedPoolMinor: number;
  projectedPrizes: { place: number; basisPoints: number; amountMinor: number }[];
  definitivePrizes:
    | { place: number; userId: string; displayName: string; amountMinor: number }[]
    | null;
  prizesPaidMinor: number;
  initialCount: number;
  rebuyCount: number;
  entryCount: number;
  playerCount: number;
};
