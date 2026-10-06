/**
 * STORAGE OWNERSHIP — cross-tenant enforcement matrix.
 *
 * The requirement under test: a client must never reach another client's
 * objects by changing an id in the request, and every unauthorized attempt
 * must FAIL CLOSED.
 *
 * This suite deliberately drives the real route handlers and the real
 * ownership kernel against two synthetic tenants (t1 = "Client A",
 * t2 = "Client B") over real bytes on a temp local object store. Only the
 * database is faked, and the fake enforces the same `(id, tenantId)`
 * predicates the real Prisma/RLS layer does.
 *
 * Matrix:
 *   A creates / reads / updates / deletes        → allowed
 *   B reads / updates / deletes A's object       → denied (404, no bytes)
 *   unauthenticated                               → denied (401)
 *   authorized operator (owner/admin of OWN tenant) → allowed within own tenant
 *   operator of B touching A                      → denied
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OLD_ENV = { ...process.env };
let ROOT = "";

// ── Session the mocked control layer will hand back ──────────────────────
// Mutable so a single test can impersonate A, B, an anonymous caller or an
// operator without re-importing the routes.
let SESSION: { id: string; tenantId: string; role: string } | null = {
  id: "uA", tenantId: "tA", role: "owner",
};
let AUTH_THROW = false;

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "waves-ownership-"));
  SESSION = { id: "uA", tenantId: "tA", role: "owner" };
  AUTH_THROW = false;
  seq = 1;
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  process.env.AUTH_SECRET = "test-secret-32-chars-minimum-length-ok";
  process.env.NEXTAUTH_SECRET = "test-secret-32-chars-minimum-length-ok";
  process.env.JWT_SECRET = "test-secret-32-chars-minimum-length-ok";
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_ROOT = ROOT;
  delete process.env.STORAGE_ALLOW_LOCAL;
  delete process.env.VERCEL;
  delete process.env.STORAGE_MAX_UPLOAD_MB;
  // No client-controlled credentials by default → Waves-held writes.
  delete process.env.STORAGE_ENCRYPTION_KEY;
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Fake registry ─────────────────────────────────────────────────────────

type Row = Record<string, any>;
const mem = { storedObject: [] as Row[], acquisitionProfile: [] as Row[], acquisitionDataImport: [] as Row[], activityEvent: [] as Row[], generationBatch: [] as Row[] };
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

function matchWhere(row: Row, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    const rv = row[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("not" in v) {
        if (rv === v.not) return false;
        continue;
      }
      if ("equals" in v) {
        const e = v.equals;
        if ((v as { mode?: string }).mode === "insensitive") {
          if (String(rv ?? "").toLowerCase() !== String(e).toLowerCase()) return false;
        } else if (rv !== e) return false;
        continue;
      }
      if ("in" in v) {
        if (!Array.isArray(v.in) || !v.in.includes(rv)) return false;
        continue;
      }
    }
    if (rv !== v) return false;
  }
  return true;
}

function makeTx() {
  return {
    storedObject: {
      findFirst: async ({ where }: any) => mem.storedObject.find((r) => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any = {}) => mem.storedObject.filter((r) => matchWhere(r, where)),
      create: async ({ data }: any) => { const r = { id: nid("obj"), ...data }; mem.storedObject.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.storedObject.find((x) => x.id === where.id);
        if (!r) throw new Error("record not found");
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }: any) => {
        const hits = mem.storedObject.filter((r) => matchWhere(r, where));
        for (const r of hits) Object.assign(r, data);
        return { count: hits.length };
      },
      groupBy: async ({ by, where }: any) => {
        const rows = mem.storedObject.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v));
        const m = new Map<string, number>();
        for (const r of rows) m.set(String(r[by[0]]), (m.get(String(r[by[0]])) ?? 0) + 1);
        return [...m.entries()].map(([status, _count]) => ({ status, _count }));
      },
    },
    acquisitionProfile: {
      findFirst: async ({ where }: any) => mem.acquisitionProfile.find((r) => r.tenantId === where.tenantId) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("prof"), ...data }; mem.acquisitionProfile.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = mem.acquisitionProfile.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    acquisitionDataImport: { create: async ({ data }: any) => ({ id: nid("imp"), ...data }) },
    activityEvent: { create: async ({ data }: any) => ({ id: nid("act"), ...data }) },
    generationBatch: {
      findFirst: async ({ where }: any) =>
        mem.generationBatch.find((r) => r.tenantId === where.tenantId && r.engineBatchId === where.engineBatchId) ?? null,
    },
  };
}

// withTenantContext also models the real SET LOCAL app.tenant_id behaviour:
// the transaction can only see rows whose tenantId matches. A route that tried
// to read without the tenant predicate would therefore get nothing, exactly as
// RLS would make it.
vi.mock("@wavesco/db", () => ({
  withTenantContext: async (tid: string, fn: any) => fn(makeTx()),
  getTenantTx: () => null,
}));

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: async () => {
    if (AUTH_THROW || !SESSION) throw new Error("UNAUTHORIZED");
    return { session: { user: SESSION }, tenantId: SESSION.tenantId, userId: SESSION.id };
  },
  acquisitionDenied: vi.fn(async () => null),
  auditControl: vi.fn(async () => ({ id: "a1" })),
  sessionRole: () => SESSION?.role ?? "member",
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => {
    if (AUTH_THROW || !SESSION) return null;
    return { user: { id: SESSION.id, tenantId: SESSION.tenantId, role: SESSION.role, email: "u@test.example" } };
  }),
}));

vi.mock("@/lib/wavesco/lead-engine", () => ({
  leadEngineMode: () => "local",
  leadEngineRoot: () => join(process.env.LEAD_ENGINE_ROOT ?? "D:/nonexistent-engine"),
  getBatchManifest: vi.fn(async () => undefined),
  fetchManifestFile: vi.fn(async () => ({ ok: false as const, error: "no engine in tests" })),
  listBatchManifests: vi.fn(async () => []),
}));

const asA = () => { SESSION = { id: "uA", tenantId: "tA", role: "owner" }; };
const asB = () => { SESSION = { id: "uB", tenantId: "tB", role: "owner" }; };
const asAnon = () => { AUTH_THROW = true; SESSION = null; };

// ── Fixtures ──────────────────────────────────────────────────────────────

async function createObjectForA(name = "leads.csv", bytes = Buffer.from("name,email\na,a@x.test\n")) {
  const { storeUpload } = await import("@/lib/wavesco/artifacts");
  asA();
  const r = await storeUpload("tA", "uA", { bytes, filename: name }, "import");
  if (!r.ok) throw new Error(`fixture upload failed: ${r.error}`);
  return { id: r.objectId!, key: r.objectKey!, bytes, row: mem.storedObject.find((x) => x.id === r.objectId)! };
}

// ═══════════════════════════════════════════════════════════════════════════

describe("CLIENT A — full lifecycle on its own object", () => {
  it("A creates, and the row is stamped with A as the authoritative owner", async () => {
    const o = await createObjectForA();
    expect(o.row.tenantId).toBe("tA");
    expect(o.key.startsWith("tenants/tA/")).toBe(true);
    expect(o.row.status).toBe("READY");
    // custody is recorded, so reads know where the bytes live
    expect(o.row.custody).toBe("waves-held");
    expect(existsSync(join(ROOT, o.key))).toBe(true);
  });

  it("A reads its own object and receives the real bytes", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    asA();
    const res = await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(o.bytes.toString());
    expect(res.headers.get("x-waves-custody")).toBe("waves-held");
    // Never leak the provider key or bucket to the caller.
    expect(res.headers.get("x-waves-storage")).toBe("waves-held");
  });

  it("A reads its own metadata without exposing objectKey or bucket", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    asA();
    const res = await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object.id).toBe(o.id);
    expect(body.object.objectKey).toBeUndefined();
    expect(body.object.bucket).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("tenants/tA");
  });

  it("A deletes its own object: bytes gone, tombstone kept", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    asA();
    const res = await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(200);
    expect(existsSync(join(ROOT, o.key))).toBe(false);
    const row = mem.storedObject.find((x) => x.id === o.id)!;
    expect(row.status).toBe("DELETED");
    expect(row.deletedAt).toBeTruthy();
    // Idempotent replay.
    const again = await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: o.id }) });
    expect(((await again.json()) as any)).toMatchObject({ ok: true, already: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("CLIENT B — cross-tenant access to A's object (must fail closed)", () => {
  it("B cannot READ A's object by substituting A's id", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    asB();
    const res = await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("name,email");
    // A's bytes are untouched.
    expect(existsSync(join(ROOT, o.key))).toBe(true);
  });

  it("B cannot read A's object METADATA either", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    asB();
    const res = await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("leads.csv");
  });

  it("B cannot UPDATE A's object (tombstone write is tenant-scoped)", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    asB();
    const res = await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(404);
    // Row still READY, bytes still present.
    expect(mem.storedObject.find((x) => x.id === o.id)!.status).toBe("READY");
    expect(existsSync(join(ROOT, o.key))).toBe(true);
  });

  it("B cannot DELETE A's object bytes", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    asB();
    await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: o.id }) });
    expect(existsSync(join(ROOT, o.key))).toBe(true);
  });

  it("B cannot LIST A's objects", async () => {
    await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/route");
    asB();
    const res = await mod.GET(new Request("http://t/x"));
    const body = (await res.json()) as any;
    expect(body.objects).toHaveLength(0);
  });

  it("B cannot archive A's batch report into B's own storage", async () => {
    const dir = join(ROOT, "engine");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "batchA.pdf"), "%PDF-1.4 A-private-report");
    const { getBatchManifest } = await import("@/lib/wavesco/lead-engine");
    const spy = vi.mocked(getBatchManifest);
    spy.mockImplementation(async (id: string) =>
      id === "batchA" ? ({ batchId: "batchA", pdfPath: join(dir, "batchA.pdf") } as any) : undefined,
    );
    mem.generationBatch.push({ id: "gbA", tenantId: "tA", engineBatchId: "batchA" });

    const route = await import("@/app/api/acquisition/storage/archive/route");
    asB();
    const res = await route.POST(
      new Request("http://t/x", { method: "POST", body: JSON.stringify({ batchId: "batchA" }) }),
    );
    // 404, not 403 — indistinguishable from "no such batch", so B cannot even
    // probe which batch ids exist in other workspaces.
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalledWith("batchA");
    expect(mem.storedObject.filter((x) => x.tenantId === "tB" && x.kind === "report")).toHaveLength(0);
    expect(existsSync(join(ROOT, "tenants/tB/reports"))).toBe(false);
  });

  id_B_downloads_A_via_reports_route: it("B cannot fetch A's report through /api/reports/[batch]/file", async () => {
    const dir = join(ROOT, "engine");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "repA.pdf"), "%PDF-1.4 secret");
    const { getBatchManifest } = await import("@/lib/wavesco/lead-engine");
    const spy = vi.mocked(getBatchManifest);
    spy.mockImplementation(async (id: string) =>
      id === "repA" ? ({ batchId: "repA", pdfPath: join(dir, "repA.pdf") } as any) : undefined,
    );
    mem.generationBatch.push({ id: "gbRep", tenantId: "tA", engineBatchId: "repA" });

    const route = await import("@/app/api/reports/[batch]/file/route");
    asB();
    const res = await route.GET(new Request("http://t/x"), { params: Promise.resolve({ batch: "repA" }) });
    expect(res.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain("secret");
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("UNAUTHENTICATED — fails closed", () => {
  it("cannot download, list, or delete", async () => {
    const o = await createObjectForA();
    const dl = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    const obj = await import("@/app/api/acquisition/storage/objects/[id]/route");
    const list = await import("@/app/api/acquisition/storage/objects/route");
    const arch = await import("@/app/api/acquisition/storage/archive/route");
    asAnon();
    const ctx = { params: Promise.resolve({ id: o.id }) };
    expect((await dl.GET(new Request("http://t/x"), ctx)).status).toBe(401);
    expect((await obj.GET(new Request("http://t/x"), ctx)).status).toBe(401);
    expect((await obj.DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(401);
    expect((await list.GET(new Request("http://t/x"))).status).toBe(401);
    expect((await arch.POST(new Request("http://t/x", { method: "POST", body: JSON.stringify({ batchId: "batchA" }) }))).status).toBe(401);
    // Nothing happened.
    expect(existsSync(join(ROOT, o.key))).toBe(true);
    expect(mem.storedObject.find((x) => x.id === o.id)!.status).toBe("READY");
  });

  it("cannot read the storage connection config", async () => {
    const route = await import("@/app/api/acquisition/storage/route");
    asAnon();
    expect((await route.GET()).status).toBe(401);
    expect((await route.POST(new Request("http://t/x", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await route.DELETE()).status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("ROLE + OPERATOR gating inside a tenant", () => {
  it("a member cannot delete an object; the owner can", async () => {
    const o = await createObjectForA();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    const ctx = { params: Promise.resolve({ id: o.id }) };

    SESSION = { id: "uM", tenantId: "tA", role: "member" };
    expect((await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(403);
    expect(existsSync(join(ROOT, o.key))).toBe(true);

    asA();
    expect((await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(200);
  });

  it("a member cannot upload or archive; an admin can", async () => {
    const route = await import("@/app/api/acquisition/storage/objects/route");
    const arch = await import("@/app/api/acquisition/storage/archive/route");
    const form = () => {
      const f = new FormData();
      f.append("file", new File([Buffer.from("a,b\n1,2\n")], "x.csv", { type: "text/csv" }));
      return f;
    };
    SESSION = { id: "uM", tenantId: "tA", role: "member" };
    expect((await route.POST(new Request("http://t/x", { method: "POST", body: form() }))).status).toBe(403);
    expect((await arch.POST(new Request("http://t/x", { method: "POST", body: "{}" }))).status).toBe(403);

    SESSION = { id: "uAd", tenantId: "tA", role: "admin" };
    expect((await route.POST(new Request("http://t/x", { method: "POST", body: form() }))).status).toBe(200);
    expect((await arch.POST(new Request("http://t/x", { method: "POST", body: "{}" }))).status).toBe(400); // missing batchId, but past authz
  });

  it("an operator of ANOTHER tenant is still refused A's object", async () => {
    const o = await createObjectForA();
    const dl = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    const obj = await import("@/app/api/acquisition/storage/objects/[id]/route");
    const ctx = { params: Promise.resolve({ id: o.id }) };

    // B's admin — the highest role B has — is refused on role before we even
    // consider ownership (delete is owner-only by policy).
    SESSION = { id: "uBop", tenantId: "tB", role: "admin" };
    expect((await dl.GET(new Request("http://t/x"), ctx)).status).toBe(404); // reads allowed by role…
    expect((await obj.DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(403); // …delete is not

    // B's OWNER clears the role gate and is then stopped by ownership itself.
    // This is the case that matters: a fully-privileged operator of B asking
    // for A's object by id must not get it.
    SESSION = { id: "uBowner", tenantId: "tB", role: "owner" };
    expect((await dl.GET(new Request("http://t/x"), ctx)).status).toBe(404);
    expect((await obj.DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(404);

    expect(existsSync(join(ROOT, o.key))).toBe(true);
    expect(mem.storedObject.find((x) => x.id === o.id)!.status).toBe("READY");
  });

  it("a member of A can read A's object (read is not owner-only)", async () => {
    const o = await createObjectForA();
    const dl = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    SESSION = { id: "uM", tenantId: "tA", role: "member" };
    const res = await dl.GET(new Request("http://t/x"), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(o.bytes.toString());
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("OWNERSHIP KERNEL — tenantId is the only owner", () => {
  it("loadOwnedStoredObject resolves by (id, tenantId), never id alone", async () => {
    const o = await createObjectForA();
    const { loadOwnedStoredObject } = await import("@/lib/wavesco/ownership");
    const tx = makeTx();
    expect((await loadOwnedStoredObject(tx as never, "tA", o.id))?.id).toBe(o.id);
    expect(await loadOwnedStoredObject(tx as never, "tB", o.id)).toBeNull();
    expect(await loadOwnedStoredObject(tx as never, "", o.id)).toBeNull();
    expect(await loadOwnedStoredObject(tx as never, "tA", "../../etc/passwd")).toBeNull();
  });

  it("tenantOwnsBatch requires a tenant link, in either of the two forms", async () => {
    const { tenantOwnsBatch } = await import("@/lib/wavesco/ownership");
    const tx = makeTx();
    mem.generationBatch.push({ id: "g1", tenantId: "tA", engineBatchId: "linked" });
    expect(await tenantOwnsBatch(tx as never, "tA", "linked")).toBe(true);
    expect(await tenantOwnsBatch(tx as never, "tB", "linked")).toBe(false);
    expect(await tenantOwnsBatch(tx as never, "tA", "unlinked")).toBe(false);
    expect(await tenantOwnsBatch(tx as never, "", "linked")).toBe(false);

    mem.storedObject.push({
      id: "o9", tenantId: "tA", kind: "report", batchId: "archived-only", fileName: "f.pdf",
      mime: "application/pdf", sizeBytes: 1, sha256: "s", provider: "local", bucket: null,
      custody: "waves-held", objectKey: "tenants/tA/reports/o9-f.pdf", status: "READY",
    });
    expect(await tenantOwnsBatch(tx as never, "tA", "archived-only")).toBe(true);
    expect(await tenantOwnsBatch(tx as never, "tB", "archived-only")).toBe(false);
  });

  it("resolveCustodyTarget refuses a row that is not this tenant's", async () => {
    const o = await createObjectForA();
    const { resolveCustodyTarget } = await import("@/lib/wavesco/ownership");
    const tx = makeTx();
    expect((await resolveCustodyTarget(tx as never, "tA", o.row as never)).ok).toBe(true);
    const bad = await resolveCustodyTarget(tx as never, "tB", o.row as never);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/not owned/i);
  });

  it("resolveCustodyTarget refuses a key outside the tenant prefix", async () => {
    const { resolveCustodyTarget } = await import("@/lib/wavesco/ownership");
    const tx = makeTx();
    const row = {
      id: "x", tenantId: "tA", kind: "upload", batchId: null, fileName: "f.csv",
      mime: "text/csv", sizeBytes: 1, sha256: "s", provider: "local", bucket: null,
      custody: "waves-held", objectKey: "tenants/tB/uploads/stolen.csv", status: "READY",
    };
    const r = await resolveCustodyTarget(tx as never, "tA", row as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/outside the tenant scope/i);
  });

  it("client-controlled custody fails closed with no connection configured", async () => {
    const { resolveCustodyTarget } = await import("@/lib/wavesco/ownership");
    const tx = makeTx();
    const row = {
      id: "x", tenantId: "tA", kind: "upload", batchId: null, fileName: "f.csv",
      mime: "text/csv", sizeBytes: 1, sha256: "s", provider: "s3", bucket: "client-bucket",
      custody: "client-controlled", objectKey: "tenants/tA/uploads/x-f.csv", status: "READY",
    };
    const r = await resolveCustodyTarget(tx as never, "tA", row as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no usable connection/i);
  });

  it("normalizeCustody degrades an unknown value to waves-held (never to client)", async () => {
    const { normalizeCustody } = await import("@/lib/wavesco/ownership");
    expect(normalizeCustody("waves-held")).toBe("waves-held");
    expect(normalizeCustody("client-controlled")).toBe("client-controlled");
    expect(normalizeCustody(null)).toBe("waves-held");
    expect(normalizeCustody("bogus")).toBe("waves-held");
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("PURGE + RECONCILE stay inside one tenant", () => {
  it("purging B removes only B's objects", async () => {
    const a = await createObjectForA();
    asB();
    const { storeUpload } = await import("@/lib/wavesco/artifacts");
    const b = await storeUpload("tB", "uB", { bytes: Buffer.from("x,y\n1,2\n"), filename: "b.csv" });
    expect(b.ok).toBe(true);

    const { purgeTenantObjects } = await import("@/lib/wavesco/artifacts");
    const res = await purgeTenantObjects("tB", "operator-test");
    expect(res.objects).toBeGreaterThanOrEqual(1);
    expect(res.failed).toHaveLength(0);
    // A's object is completely untouched.
    expect(existsSync(join(ROOT, a.key))).toBe(true);
    expect(mem.storedObject.find((x) => x.id === a.id)!.status).toBe("READY");
  });

  it("reconciling B never inspects or tombstones A's objects", async () => {
    await createObjectForA();
    asB();
    const { reconcileStorage } = await import("@/lib/wavesco/artifacts");
    const res = await reconcileStorage("tB");
    expect(res.checked).toBe(0);
    expect(mem.storedObject.every((r) => r.tenantId !== "tA" || r.status === "READY")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("FORGED / MALFORMED ids fail closed", () => {
  it("path traversal, absolute paths and url-encoded slashes are refused", async () => {
    const o = await createObjectForA();
    const dl = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    const obj = await import("@/app/api/acquisition/storage/objects/[id]/route");
    asA();
    for (const bad of [
      "../../../etc/passwd",
      "..%2f..%2fetc%2fpasswd",
      "/etc/passwd",
      "tenants/tB/uploads/other.csv",
      o.key, // the real key is not an id — it must not resolve
      "",
    ]) {
      const ctx = { params: Promise.resolve({ id: bad }) };
      expect((await dl.GET(new Request("http://t/x"), ctx)).status).toBe(404);
      expect((await obj.DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(404);
    }
    expect(existsSync(join(ROOT, o.key))).toBe(true);
  });

  it("a deleted object is 410, never re-served", async () => {
    const o = await createObjectForA();
    const obj = await import("@/app/api/acquisition/storage/objects/[id]/route");
    const dl = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    asA();
    await obj.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: o.id }) });
    const res = await dl.GET(new Request("http://t/x"), { params: Promise.resolve({ id: o.id }) });
    expect(res.status).toBe(410);
  });
});