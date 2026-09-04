import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Client-controlled storage — pure + fault-classification tests.
 * A live S3 provider is the single external dependency (documented); these
 * tests cover every code path that must hold regardless of connectivity.
 */

import {
  canonicalUriFor,
  encryptStorageCredentials,
  decryptStorageCredentials,
  tenantStoragePath,
  isTenantPath,
  sanitizeStorageConfigForClient,
  presignStorageGetUrl,
  signRequest,
  testStorageConnection,
  type StorageConfig,
} from "@/lib/wavesco/storage";

const CFG: StorageConfig = {
  provider: "s3",
  bucket: "my-bucket",
  region: "us-east-1",
  endpoint: null,
  accessKeyId: "AKIATESTKEY",
  secretAccessKey: "s3cr3t",
};
const NOW = new Date("2026-09-04T00:00:00.000Z");

describe("SigV4 signing", () => {
  it("is deterministic for identical inputs", () => {
    const a = signRequest(CFG, { method: "PUT", path: "tenants/t1/reports/a.pdf", body: "hi", contentType: "application/pdf", now: NOW });
    const b = signRequest(CFG, { method: "PUT", path: "tenants/t1/reports/a.pdf", body: "hi", contentType: "application/pdf", now: NOW });
    expect(a.headers.authorization).toBe(b.headers.authorization);
    expect(a.headers["x-amz-content-sha256"]).toBe(b.headers["x-amz-content-sha256"]);
  });

  it("signs host, date, payload hash and an Authorization header", () => {
    const signed = signRequest(CFG, { method: "GET", path: "tenants/t1/leads/x.json", now: NOW });
    expect(signed.headers.host).toBeTruthy();
    expect(signed.headers["x-amz-date"]).toBe("20260904T000000Z");
    expect(signed.headers["x-amz-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\//);
    expect(canonicalUriFor(CFG, "tenants/t1/leads/x.json")).toBe("/my-bucket/tenants/t1/leads/x.json");
  });

  it("changes signature when credentials change", () => {
    const cfg2 = { ...CFG, secretAccessKey: "s3cr3t-TAMPERED" };
    const a = signRequest(CFG, { method: "PUT", path: "x", now: NOW }).headers.authorization;
    const b = signRequest(cfg2, { method: "PUT", path: "x", now: NOW }).headers.authorization;
    expect(a).not.toBe(b);
  });

  it("presigned URL carries query auth and never exposes the secret", () => {
    const url = presignStorageGetUrl(CFG, "tenants/t1/reports/a.pdf", 3600, { now: NOW });
    expect(url).toBeTruthy();
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).not.toContain(CFG.secretAccessKey);
  });
});

describe("credential encryption", () => {
  beforeEach(() => {
    process.env.STORAGE_ENCRYPTION_KEY = "unit-test-master-key";
  });
  afterEach(() => {
    delete process.env.STORAGE_ENCRYPTION_KEY;
  });

  function makeCred(): string {
    const enc = encryptStorageCredentials("AKIA123", "secret456");
    if ("error" in enc) throw new Error("encryption failed");
    return enc.cred;
  }

  it("round-trips credentials", () => {
    const dec = decryptStorageCredentials(makeCred());
    expect(dec).toEqual({ accessKeyId: "AKIA123", secretAccessKey: "secret456" });
  });

  it("never stores plaintext", () => {
    const cred = makeCred();
    expect(cred).not.toContain("AKIA123");
    expect(cred).not.toContain("secret456");
  });

  it("fails closed when the server key is missing", () => {
    delete process.env.STORAGE_ENCRYPTION_KEY;
    const enc = encryptStorageCredentials("AKIA123", "secret456");
    expect("error" in enc && enc.error).toBe("no_key");
    expect(decryptStorageCredentials("v1.abc.def.ghi")).toBeNull();
  });

  it("rejects tampered ciphertext", () => {
    const parts = makeCred().split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptStorageCredentials(parts.join("."))).toBeNull();
  });
});
describe("tenant-scoped path guards", () => {
  it("builds safe tenant paths", () => {
    expect(tenantStoragePath("tenant-a", "reports", "lead report (1).pdf")).toBe("tenants/tenant-a/reports/lead_report__1_.pdf");
  });

  it("rejects traversal and cross-tenant keys", () => {
    expect(isTenantPath("tenant-a", "tenants/tenant-a/reports/a.pdf")).toBe(true);
    expect(isTenantPath("tenant-a", "tenants/tenant-b/reports/a.pdf")).toBe(false);
    expect(isTenantPath("tenant-a", "../etc/passwd")).toBe(false);
    expect(isTenantPath("tenant-a", "/tenants/tenant-a/reports/a.pdf")).toBe(false);
    expect(isTenantPath("tenant-a", "")).toBe(false);
  });
});

describe("client sanitization (secret leakage)", () => {
  it("strips the credential blob before returning to the browser", () => {
    const safe = sanitizeStorageConfigForClient({
      provider: "s3",
      bucket: "b",
      region: "us-east-1",
      endpoint: null,
      cred: "v1.iv.auth.cipher",
      lastTestOk: true,
    });
    expect(safe).not.toHaveProperty("cred");
    expect(safe).toMatchObject({ bucket: "b", lastTestOk: true, configured: true });
  });

  it("returns null for a missing config", () => {
    expect(sanitizeStorageConfigForClient(null)).toBeNull();
  });
});

describe("fault classification through real fetch responses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports ok when the provider accepts the probe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<ListBucketResult/>", { status: 200 })));
    const r = await testStorageConnection(CFG, { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.data?.latencyMs).toBeTypeOf("number");
  });

  it("classifies invalid credentials (403 InvalidAccessKeyId)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error><Code>InvalidAccessKeyId</Code></Error>", { status: 403 })));
    const r = await testStorageConnection(CFG, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.fault).toBe("invalid_credentials");
  });

  it("classifies permission errors as permission_denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })));
    const r = await testStorageConnection(CFG, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.fault).toBe("permission_denied");
  });

  it("classifies a missing bucket as not_found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 })));
    const r = await testStorageConnection(CFG, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.fault).toBe("not_found");
  });

  it("classifies provider outages as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const r = await testStorageConnection(CFG, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.fault).toBe("unavailable");
  });

  it("classifies timeouts as timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }));
    const r = await testStorageConnection(CFG, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.fault).toBe("timeout");
  });
});