import { prisma, withTenantContext } from "@wavesco/db";

// Canonical Acquisition Profile — 8 input groups, no tier gating.
// One per tenant, tenant-isolated, audited.

export type AcquisitionProfileStatus =
  | "DRAFT"
  | "INCOMPLETE"
  | "READY"
  | "ACTIVE"
  | "PAUSED"
  | "SUSPENDED";

export const PROFILE_STATUSES: AcquisitionProfileStatus[] = [
  "DRAFT",
  "INCOMPLETE",
  "READY",
  "ACTIVE",
  "PAUSED",
  "SUSPENDED",
];

// --- Input Groups (as stored) ---
export type CompanySection = {
  companyName?: string | null;
  website?: string | null;
  industry?: string | null;
  whatWeSell?: string | null;
  productsServices?: unknown;
  locationsServed?: unknown;
  businessModel?: string | null;
};

export type ObjectiveSection = {
  acquisitionObjective?: string | null;
  primaryObjective?: string | null;
  targetQuantity?: number | null;
  targetTimeframe?: string | null;
  priorityProductService?: string | null;
};

export type IcpSection = {
  targetCustomer?: string | null;
  b2bB2c?: string | null;
  industry?: string | null;
  category?: string | null;
  companySize?: string | null;
  decisionMakerTitles?: string | null;
  geography?: string | null;
  characteristics?: string | null;
  buyingSignals?: string | null;
  disqualifiers?: string | null;
};

export type OfferSection = {
  productService?: string | null;
  pricing?: string | null;
  valueProp?: string | null;
  promotions?: string | null;
  cta?: string | null;
  differentiators?: string | null;
  proof?: string | null;
};

export type BrandSection = {
  brandInfo?: string | null;
  toneOfVoice?: string | null;
  messagingPrefs?: string | null;
  existingCopy?: string | null;
  caseStudies?: string | null;
  claimsProof?: string | null;
  avoidSaying?: string | null;
};

export type IntegrationsSection = {
  crm?: string | null;
  email?: string | null;
  calendar?: string | null;
  website?: string | null;
  whatsapp?: string | null;
  other?: string | null;
  /** Client email operating mode: "waves_managed" (default) | "client_managed". */
  emailMode?: string | null;
};

export type RulesSection = {
  geoRestrictions?: string | null;
  industriesExclude?: string | null;
  customerTypesExclude?: string | null;
  outreachRestrictions?: string | null;
  approvalRequirements?: string | null;
  businessRules?: string | null;
  complianceConstraints?: string | null;
  operationalLimits?: { daily?: number | string | null; monthly?: number | string | null } | null;
};

// Flat profile shape as stored in DB (plus Json blobs)
export type AcquisitionProfileRecord = {
  id: string;
  tenantId: string;
  status: string;
  version: number;
  companyName?: string | null;
  website?: string | null;
  industry?: string | null;
  whatWeSell?: string | null;
  productsServices?: unknown;
  locationsServed?: unknown;
  businessModel?: string | null;
  acquisitionObjective?: string | null;
  primaryObjective?: string | null;
  targetQuantity?: number | null;
  targetTimeframe?: string | null;
  priorityProductService?: string | null;
  icp?: unknown;
  offer?: unknown;
  brand?: unknown;
  integrations?: unknown;
  rules?: unknown;
  readiness?: unknown;
  activatedAt?: Date | string | null;
  pausedAt?: Date | string | null;
  suspendedAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

// --- Readiness — deterministic, no AI ---
export type ReadinessResult = {
  ready: boolean;
  status: AcquisitionProfileStatus; // derived INCOMPLETE vs READY (or existing ACTIVE/PAUSED etc kept)
  missing: string[];
  present: string[];
  required: string[];
  snapshot: Record<string, unknown>;
};

const REQUIRED_FIELDS: Array<{ key: string; label: string; get: (p: AcquisitionProfileRecord) => unknown }> = [
  { key: "companyName", label: "Company name", get: (p) => p.companyName },
  { key: "website", label: "Website", get: (p) => p.website },
  { key: "industry", label: "Industry", get: (p) => p.industry },
  { key: "whatWeSell", label: "What the company sells", get: (p) => p.whatWeSell },
  { key: "acquisitionObjective", label: "Acquisition objective", get: (p) => p.acquisitionObjective },
  { key: "primaryObjective", label: "Primary objective", get: (p) => p.primaryObjective },
  { key: "icp.targetCustomer", label: "Target customer", get: (p) => (p.icp as any)?.targetCustomer },
  { key: "icp.geography", label: "Geography", get: (p) => (p.icp as any)?.geography },
  { key: "offer.productService", label: "Offer / product service", get: (p) => (p.offer as any)?.productService || (p.offer as any)?.valueProp },
];

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return true;
  return !!v;
}

export function readinessCheck(profile: AcquisitionProfileRecord | null): ReadinessResult {
  if (!profile) {
    return {
      ready: false,
      status: "DRAFT",
      missing: REQUIRED_FIELDS.map((f) => f.label),
      present: [],
      required: REQUIRED_FIELDS.map((f) => f.key),
      snapshot: {},
    };
  }
  const missing: string[] = [];
  const present: string[] = [];
  const snapshot: Record<string, unknown> = {};
  for (const f of REQUIRED_FIELDS) {
    const v = f.get(profile);
    const presentFlag = isPresent(v);
    snapshot[f.key] = presentFlag;
    if (presentFlag) present.push(f.label);
    else missing.push(f.label);
  }
  const ready = missing.length === 0;
  // Derive INCOMPLETE vs READY; if already ACTIVE/PAUSED/SUSPENDED keep that status externally, but readiness ready flag still true
  const status: AcquisitionProfileStatus = ready ? "READY" : profile.status === "DRAFT" && present.length === 0 ? "DRAFT" : "INCOMPLETE";
  return {
    ready,
    status,
    missing,
    present,
    required: REQUIRED_FIELDS.map((f) => f.key),
    snapshot,
  };
}

// --- State Machine ---
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["INCOMPLETE", "READY", "ACTIVE"], // ACTIVE allowed directly if ready — will validate
  INCOMPLETE: ["READY", "DRAFT", "ACTIVE"],
  READY: ["ACTIVE", "INCOMPLETE", "DRAFT"],
  ACTIVE: ["PAUSED", "SUSPENDED", "INCOMPLETE", "READY"],
  PAUSED: ["ACTIVE", "SUSPENDED", "INCOMPLETE"],
  SUSPENDED: ["ACTIVE", "PAUSED", "INCOMPLETE"],
};

export function canTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// Deterministic next status after activate/pause/resume/suspend with readiness guard
export function nextStatusForAction(current: string, action: "activate" | "pause" | "resume" | "suspend", readiness: ReadinessResult): { next: string | null; error?: string } {
  if (action === "activate") {
    if (!readiness.ready) return { next: null, error: `Cannot activate — missing: ${readiness.missing.join(", ")}` };
    if (current === "ACTIVE") return { next: null, error: "Already active" };
    if (["READY", "DRAFT", "INCOMPLETE", "PAUSED", "SUSPENDED"].includes(current)) return { next: "ACTIVE" };
    return { next: null, error: `Invalid transition ${current} → ACTIVE` };
  }
  if (action === "pause") {
    if (current !== "ACTIVE") return { next: null, error: `Can only pause from ACTIVE, current ${current}` };
    return { next: "PAUSED" };
  }
  if (action === "resume") {
    if (current !== "PAUSED") return { next: null, error: `Can only resume from PAUSED, current ${current}` };
    if (!readiness.ready) return { next: null, error: `Cannot resume — missing: ${readiness.missing.join(", ")}` };
    return { next: "ACTIVE" };
  }
  if (action === "suspend") {
    if (["ACTIVE", "PAUSED"].includes(current)) return { next: "SUSPENDED" };
    return { next: null, error: `Can only suspend from ACTIVE/PAUSED, current ${current}` };
  }
  return { next: null, error: "Unknown action" };
}

// --- Validation for upsert (no tier gating) ---
export function validateProfileInput(input: Record<string, unknown>): { valid: boolean; errors: string[]; sanitized: Record<string, unknown> } {
  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};
  // Allow any of the 8 groups; strip unknown top-level keys, keep only allowlisted
  const allow = new Set([
    "companyName",
    "website",
    "industry",
    "whatWeSell",
    "productsServices",
    "locationsServed",
    "businessModel",
    "acquisitionObjective",
    "primaryObjective",
    "targetQuantity",
    "targetTimeframe",
    "priorityProductService",
    "icp",
    "offer",
    "brand",
    "integrations",
    "rules",
  ]);
  for (const [k, v] of Object.entries(input)) {
    if (!allow.has(k)) continue;
    sanitized[k] = v;
  }
  // Basic length checks, but don't block optional
  if (sanitized.website && typeof sanitized.website === "string" && sanitized.website.length > 0) {
    const w = sanitized.website as string;
    // Reject obviously invalid (spaces, !, etc.) — deterministic, no AI
    if (w.includes(" ") || w.includes("!")) {
      errors.push("Website must be a valid URL");
    } else {
      try {
        const u = new URL(w);
        if (!["http:", "https:"].includes(u.protocol)) errors.push("Website must be http(s)");
      } catch {
        // allow bare domain, prepend https for check
        try {
          new URL(`https://${w}`);
          // Bare domain must contain a dot and no spaces
          if (!w.includes(".")) throw new Error("invalid");
        } catch {
          errors.push("Website must be a valid URL");
        }
      }
    }
  }
  if (sanitized.targetQuantity !== undefined && sanitized.targetQuantity !== null) {
    const n = Number(sanitized.targetQuantity);
    if (!Number.isFinite(n) || n < 0) errors.push("targetQuantity must be a non-negative number");
  }
  // Redact secrets inside JSON blobs before persisting — never store raw keys
  for (const k of ["icp", "offer", "brand", "integrations", "rules"] as const) {
    if (sanitized[k] && typeof sanitized[k] === "object") {
      sanitized[k] = redactSecrets(sanitized[k] as any);
      // Deep redact for nested api_key etc. — shallow is enough for top level, but also check nested one level
      const obj: any = sanitized[k];
      for (const sub of Object.keys(obj)) {
        if (typeof obj[sub] === "object" && obj[sub] !== null) {
          obj[sub] = redactSecrets(obj[sub]);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors, sanitized };
}

// --- Agent Context Builder — structured, masked, tenant-scoped ---
export function maskUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//***`;
  } catch {
    return "***";
  }
}

export function redactSecrets<T>(obj: T): T {
  // Deep redact of known secret keys at any nesting depth (including inside
  // arrays). Profile JSON blobs are user-supplied and arbitrarily nested —
  // a shallow pass leaked credentials 3+ levels deep into the database.
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactSecrets(v)) as unknown as T;
  const clone: any = { ...(obj as any) };
  const secretKeys = ["api_key", "apiKey", "secret", "token", "password", "credentialRef", "credential", "DATABASE_URL", "DIRECT_URL"];
  for (const k of Object.keys(clone)) {
    if (secretKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()))) {
      clone[k] = "***";
    } else if (clone[k] && typeof clone[k] === "object") {
      clone[k] = redactSecrets(clone[k]);
    }
  }
  return clone;
}

export type AgentContext = {
  company: {
    name: string | null;
    website: string | null;
    websiteMasked: string | null;
    industry: string | null;
    whatWeSell: string | null;
    productsServices: unknown;
    locationsServed: unknown;
    businessModel: string | null;
  };
  objective: {
    acquisitionObjective: string | null;
    primaryObjective: string | null;
    targetQuantity: number | null;
    targetTimeframe: string | null;
    priorityProductService: string | null;
  };
  icp: unknown;
  offer: unknown;
  brand: unknown;
  existing_data: {
    importsSummary: unknown;
  };
  integrations: {
    refs: unknown;
    health?: unknown;
  };
  constraints: unknown;
  operating_preferences: unknown;
  current_state: {
    tenantId: string;
    profileId: string | null;
    status: string;
    readiness: ReadinessResult;
    activatedAt: unknown;
    version: number | null;
  };
  historical_context: {
    campaignsSummary?: unknown;
    leadStats?: unknown;
    outreachHistory?: unknown;
    activityEvents?: unknown;
    performance?: unknown;
  };
  meta: {
    tenantId: string;
    profileVersion: number | null;
    generatedAt: string;
    model: "nemotron-3-super";
  };
};

export async function buildAgentContext(
  tenantId: string,
  profile: AcquisitionProfileRecord | null,
  opts?: {
    integrationsHealth?: unknown;
    leadStats?: unknown;
    campaignsSummary?: unknown;
    outreachHistory?: unknown;
    activityEvents?: unknown;
  }
): Promise<AgentContext> {
  const readiness = readinessCheck(profile);
  // Fetch imports summary if profile exists
  let importsSummary: unknown = null;
  if (profile) {
    try {
      importsSummary = await withTenantContext(tenantId, async (tx: any) => {
        const imports = await (tx as any).acquisitionDataImport.findMany({
          where: { tenantId, profileId: profile.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { fileName: true, fileType: true, rowCount: true, status: true, summary: true, createdAt: true },
        });
        return imports;
      });
    } catch {
      importsSummary = [];
    }
  }

  return {
    company: {
      name: profile?.companyName ?? null,
      website: profile?.website ?? null,
      websiteMasked: maskUrl(profile?.website ?? null),
      industry: profile?.industry ?? null,
      whatWeSell: profile?.whatWeSell ?? null,
      productsServices: profile?.productsServices ?? null,
      locationsServed: profile?.locationsServed ?? null,
      businessModel: profile?.businessModel ?? null,
    },
    objective: {
      acquisitionObjective: profile?.acquisitionObjective ?? null,
      primaryObjective: profile?.primaryObjective ?? null,
      targetQuantity: (profile?.targetQuantity as number | null) ?? null,
      targetTimeframe: profile?.targetTimeframe ?? null,
      priorityProductService: profile?.priorityProductService ?? null,
    },
    icp: redactSecrets(profile?.icp ?? null),
    offer: redactSecrets(profile?.offer ?? null),
    brand: redactSecrets(profile?.brand ?? null),
    existing_data: {
      importsSummary,
    },
    integrations: {
      refs: redactSecrets(profile?.integrations ?? null),
      health: opts?.integrationsHealth ?? null,
    },
    constraints: redactSecrets(profile?.rules ?? null),
    operating_preferences: null,
    current_state: {
      tenantId,
      profileId: profile?.id ?? null,
      status: profile?.status ?? "DRAFT",
      readiness,
      activatedAt: profile?.activatedAt ?? null,
      version: profile?.version ?? null,
    },
    historical_context: {
      campaignsSummary: opts?.campaignsSummary ?? null,
      leadStats: opts?.leadStats ?? null,
      outreachHistory: opts?.outreachHistory ?? null,
      activityEvents: opts?.activityEvents ?? null,
      performance: null,
    },
    meta: {
      tenantId,
      profileVersion: profile?.version ?? null,
      generatedAt: new Date().toISOString(),
      model: "nemotron-3-super",
    },
  };
}
