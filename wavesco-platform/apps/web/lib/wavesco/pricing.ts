/**
 * Acquisition OS self-serve lease pricing — the commercial model, enforced
 * SERVER-SIDE ONLY.
 *
 * This mirrors the historical Waves Acquire pricing (LEASE_30/90/180/365).
 * Never trust the client for an amount: every checkout derives the paise from
 * this table, the AcquisitionOrder row stores that exact amount, and the
 * verify route re-checks the captured Razorpay payment against it.
 *
 * The production app has no other price surface; changing anything here
 * changes the commercial model — keep in sync with Waves' offer, not with
 * client requests.
 */
export const LEASE_PRICES = {
  LEASE_30: { paise: 6000000, days: 30, rupees: 60000, monthly: 60000, save: 0 },
  LEASE_90: { paise: 16500000, days: 90, rupees: 165000, monthly: 55000, save: 15000 },
  LEASE_180: { paise: 30000000, days: 180, rupees: 300000, monthly: 50000, save: 60000 },
  LEASE_365: { paise: 54000000, days: 365, rupees: 540000, monthly: 45000, save: 240000 },
} as const;

export type LeaseType = keyof typeof LEASE_PRICES;

export const VALID_LEASE_TYPES = Object.keys(LEASE_PRICES) as LeaseType[];

export interface LeaseInfo {
  leaseType: LeaseType;
  paise: number;
  days: number;
  rupees: number;
  monthly: number;
  save: number;
}

export function isValidLeaseType(v: unknown): v is LeaseType {
  return typeof v === "string" && v in LEASE_PRICES;
}

/** Returns lease metadata or throws for anything not in the lock table. */
export function leaseInfo(v: unknown): LeaseInfo {
  if (!isValidLeaseType(v)) {
    const err: any = new Error(`Invalid leaseType: ${String(v)}`);
    err.status = 400;
    throw err;
  }
  const e = LEASE_PRICES[v];
  return { leaseType: v, ...e };
}

export function daysForLease(v: unknown): number {
  return leaseInfo(v).days;
}

/** Server-rendered lease options (stable order — cheapest first). */
export const PUBLIC_LEASES: LeaseInfo[] = VALID_LEASE_TYPES.map((t) => leaseInfo(t));