export type Profile = {
  id: string;
  email: string;
  displayName: string;
  role: "player" | "super_admin";
};

export type TournamentListItem = {
  id: string;
  title: string;
  currency: string;
  status: string;
  host_user_id: string;
  entry_price_minor: number;
  rebuy_price_minor: number;
};

export type Player = {
  userId: string;
  displayName: string;
  email: string;
  memberRole: "player" | "admin";
  playerStatus: string;
  isHost: boolean;
  isCashier: boolean;
  initialState: "missing" | "paid" | "used";
  rebuyCount: number;
  rebuyCap: number;
  entryCount: number;
  maxEntries: number;
  committedMinor: number;
  collectedMinor: number;
};

export type Summary = {
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

export type RebuyRequest = {
  id: string;
  userId: string;
  displayName: string;
  status: string;
  method: string | null;
  note: string | null;
  requestedAt: string;
  amountMinor?: number;
};

export type PaymentRow = {
  id: string;
  userId: string;
  displayName: string;
  method: string;
  amountMinor: number;
  status: string;
  reference: string | null;
};

export type TournamentDetail = {
  id: string;
  title: string;
  currency: string;
  status: string;
  hostUserId: string;
  cashierUserId: string | null;
  cashierName: string | null;
  entryPriceMinor: number;
  rebuyPriceMinor: number;
  maxRebuys: number;
  hostExtraRebuys: number;
  players: Player[];
  prizeRules: { place: number; basisPoints: number }[];
  blindLevels: {
    levelNo: number;
    kind: "play" | "break";
    smallBlind: number;
    bigBlind: number;
    ante: number;
    durationSeconds: number;
  }[];
  rebuyRequests: RebuyRequest[];
  payments: PaymentRow[];
  summary: Summary;
  ladderMode: "template" | "custom";
  blindSmallStep: number;
};

export type Clock = {
  state: "stopped" | "running" | "paused" | "finished";
  levelNo: number;
  remainingSeconds: number;
  serverTime: string;
  version: number;
  kind: "play" | "break";
  smallBlind: number;
  bigBlind: number;
  ante: number;
  warningSeconds: number;
  levelAdvance: "auto" | "manual";
  next: {
    levelNo: number;
    kind: "play" | "break";
    smallBlind: number;
    bigBlind: number;
    ante: number;
  } | null;
};

export type DirectoryUser = { id: string; email: string; displayName: string; role: string };

export type ThemeTokens = {
  felt: string;
  ink: string;
  gold: string;
  blood: string;
  radius: number;
  layout: string[];
};
