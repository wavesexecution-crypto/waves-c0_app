/**
 * Storage takeover — ownership, isolation, lifecycle, failure modes.
 * Local provider only (temp dirs). No network. Synthetic tenants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OLD_ENV = { ...process.env };
let ROOT = "";

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "waves-storage-test-"));
  for (const k of Object.keys(mem)) (mem as any)[k] = [];
  seq = 1;
  // Dummy secrets so @wavesco/auth module evaluation succeeds (mirrors
  // waves-identity.test.ts). Auth behavior itself stays fully mocked.
  process.env.AUTH_SECRET = "test-secret-32-chars-minimum-length-ok";
  process.env.NEXTAUTH_SECRET = "test-secret-32-chars-minimum-length-ok";
  process.env.JWT_SECRET = "test-secret-32-chars-minimum-length-ok";
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_ROOT = ROOT;
  delete process.env.STORAGE_ALLOW_LOCAL;
  delete process.env.VERCEL;
  delete process.env.STORAGE_MAX_UPLOAD_MB;
  vi.clearAllMocks();
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
});

describe("ownership standard (machine-readable)", () => {
  it("every servable kind is client-owned with explicit retention; ephemeral never serves", async () => {
    const { STORAGE_OWNERSHIP } = await import("@/lib/wavesco/artifacts");
    for (const kind of ["upload", "report", "export", "artifact"] as const) {
      expect(STORAGE_OWNERSHIP[kind].owner).toBe("client");
      expect(STORAGE_OWNERSHIP[kind].servesClient).toBe(true);
      expect(STORAGE_OWNERSHIP[kind].retention).toMatch(/explicit|persisted/);
    }
    expect(STORAGE_OWNERSHIP.ephemeral.servesClient).toBe(false);
  });
});

describe("provider resolution", () => {
  it("defaults to local outside production; refuses silent local in prod", async () => {
    const { wavesStorageConfig } = await import("@/lib/wavesco/object-storage");
    delete process.env.STORAGE_PROVIDER;
    expect("config" in wavesStorageConfig()).toBe(true);
    process.env.VERCEL = "1";
    const blocked = wavesStorageConfig();
    expect("error" in blocked).toBe(true);
    process.env.STORAGE_ALLOW_LOCAL = "true";
    expect("config" in wavesStorageConfig()).toBe(true);
  });
  it("s3 without credentials fails loudly; unknown provider rejected", async () => {
    const { wavesStorageConfig } = await import("@/lib/wavesco/object-storage");
    process.env.STORAGE_PROVIDER = "s3";
    expect("error" in wavesStorageConfig()).toBe(true);
    process.env.STORAGE_PROVIDER = "ftp";
    expect("error" in wavesStorageConfig()).toBe(true);
  });
  it("generated keys are tenant-scoped, unique and traversal-proof", async () => {
    const { wavesObjectKey } = await import("@/lib/wavesco/object-storage");
    const { isTenantPath } = await import("@/lib/wavesco/storage");
    const k = wavesObjectKey("t1", "reports", "obj_abc", "../../../etc/passwd.pdf");
    expect(k.startsWith("tenants/t1/reports/")).toBe(true);
    expect(k).not.toContain("..");
    expect(isTenantPath("t1", k)).toBe(true);
    expect(isTenantPath("t2", k)).toBe(false);
    expect(isTenantPath("t1", "tenants/t2/reports/x")).toBe(false);
    expect(isTenantPath("t1", "tenants/t1/reports/%2fetc")).toBe(false);
  });
});

describe("local provider round-trip + isolation", () => {
  it("put/get/delete/exists with cross-tenant and traversal refusal", async () => {
    const { wavesStorageConfig, storagePut, storageGet, storageDelete, storageExists, wavesObjectKey } =
      await import("@/lib/wavesco/object-storage");
    const resolved = wavesStorageConfig();
    if (!("config" in resolved)) throw new Error("local should resolve");
    const key = wavesObjectKey("t1", "uploads", "obj_1", "leads.csv");
    const body = Buffer.from("a,b\n1,2\n");
    expect((await storagePut(resolved.config, "t1", key, body, "text/csv")).ok).toBe(true);
    expect(await storageExists(resolved.config, "t1", key)).toBe(true);
    const got = await storageGet(resolved.config, "t1", key);
    expect(got.ok && got.data?.body.equals(body)).toBe(true);
    // cross-tenant access refused even with the exact key
    await expect(storageGet(resolved.config, "t2", key)).rejects.toThrow(/outside the tenant/);
    await expect(storagePut(resolved.config, "t2", key, body, "text/csv")).rejects.toThrow();
    await expect(storageDelete(resolved.config, "t1", "tenants/t1/uploads/../../evil")).rejects.toThrow();
    const del = await storageDelete(resolved.config, "t1", key);
    expect(del.ok && del.data?.deleted).toBe(true);
    expect(await storageExists(resolved.config, "t1", key)).toBe(false);
    // idempotent re-delete
    expect((await storageDelete(resolved.config, "t1", key)).ok).toBe(true);
    const missing = await storageGet(resolved.config, "t1", key);
    expect(missing.ok).toBe(false);
  });
  it("health ping proves read/write (not decorative)", async () => {
    const { wavesStorageConfig, storagePing } = await import("@/lib/wavesco/object-storage");
    const resolved = wavesStorageConfig();
    if (!("config" in resolved)) throw new Error("local should resolve");
    const ping = await storagePing(resolved.config);
    expect(ping.ok).toBe(true);
    expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("upload validation matrix", () => {
  it("accepts well-formed csv/xlsx/json; sniffs content, never trusts client", async () => {
    const { validateUploadBytes } = await import("@/lib/wavesco/artifacts");
    expect(validateUploadBytes(Buffer.from("a,b\n1,2\n"), "leads.csv")).toMatchObject({ ok: true, ext: ".csv", mime: "text/csv", rowCount: 1 });
    const xlsx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(30, "z"),
      Buffer.from("PK\x05\x06"),
    ]);
    expect(validateUploadBytes(xlsx, "r.exe")).toMatchObject({ ok: false }); // bad ext
    expect(validateUploadBytes(xlsx, "r.xlsx").ok).toBe(true);
    expect(validateUploadBytes(Buffer.from('{"a":1}'), "d.json")).toMatchObject({ ok: true });
    expect(validateUploadBytes(Buffer.from(""), "e.csv")).toMatchObject({ ok: false });
    expect(validateUploadBytes(Buffer.from("PK"), "r.xlsx")).toMatchObject({ ok: false });
    expect(validateUploadBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), "r.xlsx")).toMatchObject({ ok: false }); // truncated, no EOCD
    expect(validateUploadBytes(Buffer.from("{nope"), "d.json")).toMatchObject({ ok: false });
    expect(validateUploadBytes(Buffer.from([0xff, 0xfe, 0x00]), "e.csv")).toMatchObject({ ok: false }); // non-UTF8
    expect(validateUploadBytes(Buffer.from("a\x00b"), "e.csv")).toMatchObject({ ok: false }); // NUL
    expect(validateUploadBytes(Buffer.from("x"), "run.exe")).toMatchObject({ ok: false });
    expect(validateUploadBytes(Buffer.from("x"), "noext")).toMatchObject({ ok: false });
  });
  it("enforces the size cap from env", async () => {
    process.env.STORAGE_MAX_UPLOAD_MB = "0.0001"; // ~100 bytes
    const { validateUploadBytes } = await import("@/lib/wavesco/artifacts");
    expect(validateUploadBytes(Buffer.alloc(50, "a"), "a.csv").ok).toBe(true);
    expect(validateUploadBytes(Buffer.alloc(5000, "a"), "a.csv")).toMatchObject({ ok: false });
  });
});

// ------------------------------------------------------------------
// DB-backed flows (mocked StoredObject registry + real local bytes)
// ------------------------------------------------------------------

type Row = Record<string, any>;
const mem = { storedObject: [] as Row[], acquisitionProfile: [] as Row[], acquisitionDataImport: [] as Row[], activityEvent: [] as Row[], generationBatch: [] as Row[] };
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

/** Prisma-where subset used by these tests: equality + { not: } + { equals, mode }. */
function matchWhere(row: Row, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    const rv = (row as any)[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if ("not" in (v as any)) {
        if (rv === (v as any).not) return false;
        continue;
      }
      if ("equals" in (v as any)) {
        const e = (v as any).equals;
        if ((v as any).mode === "insensitive") {
          if (String(rv ?? "").toLowerCase() !== String(e).toLowerCase()) return false;
        } else if (rv !== e) return false;
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
        const r = mem.storedObject.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      groupBy: async ({ by, where }: any) => {
        const rows = mem.storedObject.filter((r) => Object.entries(where ?? {}).every(([k, v]) => (r as any)[k] === v));
        const m = new Map<string, number>();
        for (const r of rows) m.set(String((r as any)[by[0]]), (m.get(String((r as any)[by[0]])) ?? 0) + 1);
        return [...m.entries()].map(([status, _count]) => ({ status, _count }));
      },
    },
    acquisitionProfile: {
      findFirst: async ({ where }: any) => mem.acquisitionProfile.find((r) => r.tenantId === where.tenantId) ?? null,
      create: async ({ data }: any) => { const r = { id: nid("prof"), ...data }; mem.acquisitionProfile.push(r); return r; },
    },
    acquisitionDataImport: {
      create: async ({ data }: any) => ({ id: nid("imp"), ...data }),
    },
    activityEvent: { create: async ({ data }: any) => ({ id: nid("act"), ...data }) },
    generationBatch: {
      findFirst: async ({ where }: any) => mem.generationBatch.find((r) => r.tenantId === where.tenantId && r.engineBatchId === where.engineBatchId) ?? null,
    },
  };
}

vi.mock("@wavesco/db", () => ({
  withTenantContext: async (_tid: string, fn: any) => fn(makeTx()),
}));

vi.mock("@/lib/wavesco/control", () => ({
  requireControlAuth: async () => ({ tenantId: "t1", userId: "u1", session: { user: { id: "u1", role: "owner" } } }),
  acquisitionDenied: vi.fn(async () => null),
  auditControl: vi.fn(async () => ({ id: "a1" })),
  sessionRole: () => "owner",
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "u1", tenantId: "t1", role: "owner", email: "owner@test.example" } })),
}));

vi.mock("@/lib/wavesco/lead-engine", () => ({
  leadEngineMode: () => "local",
  getBatchManifest: vi.fn(async () => undefined),
  fetchManifestFile: vi.fn(async () => ({ ok: false as const, error: "no engine in tests" })),
  listBatchManifests: vi.fn(async () => []),
}));

describe("storeUpload end-to-end (registry + bytes + import link)", () => {
  it("persists bytes under a generated key and registers READY metadata", async () => {
    const { storeUpload } = await import("@/lib/wavesco/artifacts");
    const r = await storeUpload("t1", "u1", { bytes: Buffer.from("a,b\n1,2\n"), filename: "../../../evil.csv" }, "import");
    expect(r.ok).toBe(true);
    expect(r.objectKey).toMatch(/^tenants\/t1\/uploads\//);
    expect(r.objectKey).not.toContain("..");
    expect(existsSync(join(ROOT, r.objectKey!))).toBe(true);
    expect(mem.storedObject).toHaveLength(1);
    expect(mem.storedObject[0]).toMatchObject({ tenantId: "t1", kind: "upload", status: "READY", mime: "text/csv" });
  });
  it("rejects bad files before touching disk or registry", async () => {
    const { storeUpload } = await import("@/lib/wavesco/artifacts");
    const before = mem.storedObject.length;
    expect((await storeUpload("t1", "u1", { bytes: Buffer.from("x"), filename: "run.exe" })).ok).toBe(false);
    expect(mem.storedObject.length).toBe(before);
  });
});

describe("archive flow (idempotent, explicit failures)", () => {
  it("archives local engine files once; re-run skips; missing files fail loudly", async () => {
    const dir = join(ROOT, "engine");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "b1.pdf"), "%PDF-1.4 fake");
    const { getBatchManifest } = await import("@/lib/wavesco/lead-engine");
    // Fixture honesty: only b1 exists; unknown batches resolve undefined.
    vi.mocked(getBatchManifest).mockImplementation(async (id: string) =>
      id === "b1" ? ({ batchId: "b1", pdfPath: join(dir, "b1.pdf") } as any) : undefined,
    );
    const { archiveBatchReports } = await import("@/lib/wavesco/artifacts");
    const r1 = await archiveBatchReports("t1", "b1", "u1");
    expect(r1.archived).toHaveLength(1);
    expect(r1.archived[0]).toMatchObject({ filename: "b1.pdf" });
    expect(r1.failures).toHaveLength(1); // xlsx absent
    expect(r1.failures[0]).toMatchObject({ file: "b1.xlsx" });
    const r2 = await archiveBatchReports("t1", "b1", "u1");
    expect(r2.archived).toHaveLength(0);
    expect(r2.skipped).toContain("b1.pdf");
    const r3 = await archiveBatchReports("t1", "ghost", "u1");
    expect(r3.archived).toHaveLength(0);
    expect(r3.failures.length).toBeGreaterThan(0);
  });
});

describe("download authorization matrix", () => {
  async function seedPdf() {
    const { storeUpload } = await import("@/lib/wavesco/artifacts");
    // seed via direct registry row (arbitrary bytes) to test download in isolation
    const body = Buffer.from("%PDF-1.4 bytes");
    const id = "obj_dl1";
    const key = `tenants/t1/reports/${id}-b1.pdf`;
    mkdirSync(join(ROOT, "tenants/t1/reports"), { recursive: true });
    writeFileSync(join(ROOT, key), body);
    mem.storedObject.push({
      id, tenantId: "t1", kind: "report", batchId: "b1", fileName: 'a"b.pdf',
      mime: "application/pdf", sizeBytes: body.length, sha256: "x", provider: "local",
      bucket: null, objectKey: key, status: "READY", createdByUserId: "u1",
    });
    return id;
  }
  it("owner downloads own file (header-sanitized); others/forged/deleted/missing fail safely", async () => {
    const id = await seedPdf();
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/download/route");
    const ok = await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="a_b.pdf"');
    expect(ok.headers.get("x-waves-storage")).toBe("waves-held");
    // forged id
    expect((await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id: "../../etc/passwd" }) })).status).toBe(404);
    // other tenant's row is invisible (same id, different tenant → no match)
    mem.storedObject.push({ ...mem.storedObject[0], id: "obj_dl2", tenantId: "t2", objectKey: "tenants/t2/reports/obj_dl2-b.pdf" });
    // control mock is fixed to t1; t2's row must not resolve for t1
    expect((await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id: "obj_dl2" }) })).status).toBe(404);
    // deleted → 410
    mem.storedObject.find((r) => r.id === id)!.status = "DELETED";
    expect((await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id }) })).status).toBe(410);
    // missing bytes → 404 with reason (row READY again, bytes removed)
    mem.storedObject.find((r) => r.id === id)!.status = "READY";
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(ROOT, `tenants/t1/reports/${id}-b1.pdf`));
    const gone = await mod.GET(new Request("http://t/x"), { params: Promise.resolve({ id }) });
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as any).reason).toMatch(/not found|retrieved|missing/i);
  });
});

describe("upload route guards", () => {
  it("multipart csv → 200 + import link; exe → 400; unauthenticated → 401", async () => {
    const mod = await import("@/app/api/acquisition/storage/objects/route");
    const form = new FormData();
    form.append("file", new File([Buffer.from("a,b\n1,2\n")], "leads.csv", { type: "text/csv" }));
    const ok = await mod.POST(new Request("http://t/x", { method: "POST", body: form }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).objectId).toBeDefined();
    const bad = new FormData();
    bad.append("file", new File([Buffer.from("x")], "run.exe", { type: "application/x-msdownload" }));
    expect((await mod.POST(new Request("http://t/x", { method: "POST", body: bad }))).status).toBe(400);
    const empty = new FormData();
    expect((await mod.POST(new Request("http://t/x", { method: "POST", body: empty }))).status).toBe(400);
  });
});

describe("delete + purge (idempotent, audited)", () => {
  it("owner delete removes bytes + tombstones; replay is a no-op success", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const key = "tenants/t1/uploads/obj_del-f.csv";
    mkdirSync(join(ROOT, "tenants/t1/uploads"), { recursive: true });
    writeFileSync(join(ROOT, key), body);
    mem.storedObject.push({
      id: "obj_del", tenantId: "t1", kind: "upload", fileName: "f.csv", mime: "text/csv",
      sizeBytes: body.length, sha256: "y", provider: "local", bucket: null,
      objectKey: key, status: "READY", createdByUserId: "u1",
    });
    const mod = await import("@/app/api/acquisition/storage/objects/[id]/route");
    const r1 = await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: "obj_del" }) });
    expect(r1.status).toBe(200);
    expect(existsSync(join(ROOT, key))).toBe(false);
    expect(mem.storedObject.find((r) => r.id === "obj_del")!.status).toBe("DELETED");
    const r2 = await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: "obj_del" }) });
    expect(((await r2.json()) as any)).toMatchObject({ ok: true, already: true });
    expect((await mod.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: "ghost" }) })).status).toBe(404);
  });
  it("purge removes tenant bytes, keeps tombstones, reruns to zero", async () => {
    const { purgeTenantObjects } = await import("@/lib/wavesco/artifacts");
    // seed two live rows with bytes
    for (const [id, fn] of [["obj_p1", "a.csv"], ["obj_p2", "b.csv"]] as const) {
      const key = `tenants/t1/uploads/${id}-${fn}`;
      mkdirSync(join(ROOT, "tenants/t1/uploads"), { recursive: true });
      writeFileSync(join(ROOT, key), Buffer.from("x"));
      mem.storedObject.push({
        id, tenantId: "t1", kind: "upload", fileName: fn, mime: "text/csv",
        sizeBytes: 1, sha256: "z", provider: "local", bucket: null,
        objectKey: key, status: "READY", createdByUserId: "u1",
      });
    }
    const r1 = await purgeTenantObjects("t1", "gdpr-test");
    expect(r1.objects).toBeGreaterThanOrEqual(2);
    expect(r1.failed).toHaveLength(0);
    const r2 = await purgeTenantObjects("t1", "gdpr-test");
    expect(r2).toMatchObject({ objects: 0 });
    expect(mem.storedObject.filter((r) => r.tenantId === "t1" && r.status !== "DELETED")).toHaveLength(0);
  });
});

describe("reconcile detects byte loss (never silent READY)", () => {
  it("missing bytes → MISSING + report; healthy → clean", async () => {
    const { reconcileStorage } = await import("@/lib/wavesco/artifacts");
    const key = "tenants/t1/reports/obj_r1-r.pdf";
    mkdirSync(join(ROOT, "tenants/t1/reports"), { recursive: true });
    writeFileSync(join(ROOT, key), Buffer.from("%PDF"));
    mem.storedObject.push({
      id: "obj_r1", tenantId: "t1", kind: "report", batchId: "b9", fileName: "r.pdf", mime: "application/pdf",
      sizeBytes: 5, sha256: "q", provider: "local", bucket: null, objectKey: key, status: "READY", createdByUserId: "u1",
    });
    // t2's row must not be touched by t1's reconcile
    mem.storedObject.push({
      id: "obj_r2", tenantId: "t2", kind: "report", batchId: "b9", fileName: "r.pdf", mime: "application/pdf",
      sizeBytes: 5, sha256: "q", provider: "local", bucket: null, objectKey: "tenants/t2/reports/obj_r2-r.pdf", status: "READY", createdByUserId: "u9",
    });
    const { unlinkSync } = await import("node:fs");
    unlinkSync(join(ROOT, key));
    const r = await reconcileStorage("t1");
    expect(r.checked).toBeGreaterThanOrEqual(1);
    expect(r.missing.map((m) => m.objectId)).toContain("obj_r1");
    expect(mem.storedObject.find((x) => x.id === "obj_r1")!.status).toBe("MISSING");
    expect(mem.storedObject.find((x) => x.id === "obj_r2")!.status).toBe("READY");
  });
});

describe("reports file route is tenant-gated", () => {
  it("unlinked batch → 404 (no cross-tenant fetch); linked + stored → waves-held", async () => {
    mem.generationBatch.push({ id: "gb1", tenantId: "t1", engineBatchId: "b7" });
    const key = "tenants/t1/reports/obj_b7-b7.pdf";
    mkdirSync(join(ROOT, "tenants/t1/reports"), { recursive: true });
    writeFileSync(join(ROOT, key), Buffer.from("%PDF-7"));
    mem.storedObject.push({
      id: "obj_b7", tenantId: "t1", kind: "report", batchId: "b7", fileName: "b7.pdf", mime: "application/pdf",
      sizeBytes: 7, sha256: "w", provider: "local", bucket: null, objectKey: key, status: "READY", createdByUserId: "u1",
    });
    const mod = await import("@/app/api/reports/[batch]/file/route");
    const mk = (batch: string, type: string) =>
      mod.GET(new Request(`http://t/api/reports/${batch}/file?type=${type}`), { params: Promise.resolve({ batch }) });
    // attacker batch (not linked to t1) → 404 even though it "exists" on the engine
    expect((await mk("victim-batch", "pdf")).status).toBe(404);
    const ok = await mk("b7", "pdf");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-waves-storage")).toBe("waves-held");
  });
});

describe("s3 glue fails loudly without network (no silent success)", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; vi.unstubAllGlobals(); });
  function s3env() {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.STORAGE_S3_BUCKET = "waves-test-bucket";
    process.env.STORAGE_S3_REGION = "us-east-1";
    process.env.STORAGE_S3_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  }
  it("put/get/delete/timeout classify as unavailable (never ok:false silent)", async () => {
    s3env();
    const { wavesStorageConfig, storagePut, storageGet, storageDelete, storageExists, storagePing } =
      await import("@/lib/wavesco/object-storage");
    const resolved = wavesStorageConfig();
    if (!("config" in resolved)) throw new Error("s3 should resolve with creds");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const key = "tenants/t1/uploads/obj_x-a.csv";
    expect((await storagePut(resolved.config, "t1", key, Buffer.from("a"), "text/csv")).ok).toBe(false);
    expect((await storageGet(resolved.config, "t1", key)).ok).toBe(false);
    expect((await storageDelete(resolved.config, "t1", key)).ok).toBe(false);
    expect(await storageExists(resolved.config, "t1", key)).toBe(false);
    const ping = await storagePing(resolved.config);
    expect(ping.ok).toBe(false);
    expect(ping.provider).toBe("s3");
  });
  it("401/403 from the provider classify distinctly (no secret leak in messages)", async () => {
    s3env();
    const { wavesStorageConfig, storageGet } = await import("@/lib/wavesco/object-storage");
    const resolved = wavesStorageConfig();
    if (!("config" in resolved)) throw new Error("s3 should resolve with creds");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    const r = await storageGet(resolved.config, "t1", "tenants/t1/uploads/obj_x-a.csv");
    expect(r.ok).toBe(false);
    expect(r.fault).toBe("permission_denied");
    expect(JSON.stringify(r)).not.toContain("EXAMPLEKEY");
  });
});

describe("storage health endpoint honesty", () => {
  it("local provider reports ok with location; prod-refusal reports unavailable", async () => {
    const mod = await import("@/app/api/acquisition/storage/health/route");
    const ok = await mod.GET();
    expect(ok.status).toBe(200);
    const j: any = await ok.json();
    expect(j.state).toBe("ok");
    expect(j.provider).toBe("local");
    expect(j.counts).toBeDefined();
    process.env.VERCEL = "1";
    const blocked = await mod.GET();
    const jb: any = await blocked.json();
    expect(jb.state).toBe("unavailable");
    expect(jb.reason).toMatch(/persistent storage/i);
  });
});
