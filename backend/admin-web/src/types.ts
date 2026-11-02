export type TrapDefinition = {
  id: string;
  name: string;
  iconKey: string;
  enabled: boolean;
  radiusMeters: number;
  placementHoldSeconds: number;
  revealHoldSeconds: number;
  disarmHoldSeconds: number;
  effectKind: "laughter" | "timeout" | "warning" | "slowdown" | "penalty";
  effectValue: number;
  ownerCanTrigger: boolean;
  visibility: "owner-only" | "public-after-reveal";
};

export type UserProfile = {
  uid: string;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  photoUrl?: string | null;
  membership?: string | null;
  timeZone?: string | null;
  captureCount?: number;
  timesCaught?: number;
};
