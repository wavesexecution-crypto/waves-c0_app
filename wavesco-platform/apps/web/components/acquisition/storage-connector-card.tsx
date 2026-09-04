"use client";

import { useState, useCallback } from "react";

type TestResult = { ok: boolean; latencyMs?: number | null; fault?: string; message?: string };
type NoticeKind = "ok" | "error" | "warn";
type Notice = { kind: NoticeKind; text: string } | null;

interface Props {
  initial: Record<string, unknown> | null;
}

const FAULT_LABELS: Record<string, string> = {
  invalid_credentials: "The credentials were rejected.",
  permission_denied: "The credentials do not have permission for this bucket.",
  not_found: "The bucket was not found.",
  timeout: "The storage provider did not respond in time.",
  unavailable: "The storage provider is unreachable right now.",
};

export function StorageConnectorCard({ initial }: Props) {
  const [storage, setStorage] = useState<Record<string, unknown> | null>(initial);
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [endpoint, setEndpoint] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [busy, setBusy] = useState<"none" | "test" | "connect" | "disconnect">("none");
  const [notice, setNotice] = useState<Notice>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const report = useCallback((kind: NoticeKind, text: string) => {
    setNotice({ kind, text });
  }, []);

  async function testCandidate() {
    const payload = { bucket, region, endpoint, accessKeyId: accessKey, secretAccessKey: secretKey };
    setBusy("test");
    setNotice(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/acquisition/storage/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        fault?: string;
        message?: string;
        latencyMs?: number | null;
        error?: string;
      };
      if (res.status === 401) return report("error", "Your session expired — sign in again.");
      if (json.error && !("ok" in json)) return report("error", json.error);
      const ok = json.ok === true;
      setTestResult({ ok, fault: json.fault, message: json.message, latencyMs: json.latencyMs });
      report(
        ok ? "ok" : "error",
        ok
          ? `Connected — bucket reachable${json.latencyMs != null ? ` in ${Math.round(json.latencyMs)}ms` : ""}.`
          : json.message ?? FAULT_LABELS[json.fault ?? ""] ?? "Connection failed.",
      );
    } catch (e) {
      report("error", e instanceof Error ? e.message : "Test failed.");
    } finally {
      setBusy("none");
    }
  }

  async function onConnect() {
    if (!bucket || !accessKey || !secretKey) {
      return report("warn", "Fill in the bucket name, region, access key and secret key.");
    }
    setBusy("connect");
    setNotice(null);
    try {
      const res = await fetch("/api/acquisition/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucket, region, endpoint, accessKeyId: accessKey, secretAccessKey: secretKey }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        configured?: boolean;
        storage?: Record<string, unknown> | null;
        test?: TestResult | null;
        error?: string;
      };
      if (!res.ok || !json.configured) return report("error", json.error ?? "Could not connect storage.");
      setStorage(json.storage ?? null);
      setTestResult(json.test ?? null);
      report(
        json.test?.ok ? "ok" : "warn",
        json.test?.ok
          ? "Storage connected and verified."
          : `Storage saved, but the first test did not verify yet — ${json.test?.message ?? "please retest."}`,
      );
      if (json.test?.ok) {
        setBucket("");
        setAccessKey("");
        setSecretKey("");
        setEndpoint("");
      }
    } catch (e) {
      report("error", e instanceof Error ? e.message : "Connect failed.");
    } finally {
      setBusy("none");
    }
  }

  async function onRetestPersisted() {
    setBusy("test");
    setNotice(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/acquisition/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => ({}))) as { test?: TestResult | null; error?: string; configured?: boolean };
      if (!res.ok || !json.configured) return report("error", json.error ?? "Could not test storage.");
      setTestResult(json.test ?? null);
      report(
        json.test?.ok ? "ok" : "error",
        json.test?.ok ? `Connected (${Math.round(json.test.latencyMs ?? 0)}ms).` : json.test?.message ?? "Connection failed.",
      );
    } catch (e) {
      report("error", e instanceof Error ? e.message : "Test failed.");
    } finally {
      setBusy("none");
    }
  }

  async function onDisconnect() {
    if (typeof window !== "undefined" && !window.confirm("Disconnect storage? Files already stored stay in your bucket; new reports stay with Waves until you reconnect.")) return;
    setBusy("disconnect");
    setNotice(null);
    try {
      const res = await fetch("/api/acquisition/storage", { method: "DELETE" });
      if (!res.ok) return report("error", "Could not disconnect storage.");
      setStorage(null);
      setTestResult(null);
      report("ok", "Storage disconnected.");
    } catch (e) {
      report("error", e instanceof Error ? e.message : "Disconnect failed.");
    } finally {
      setBusy("none");
    }
  }

  const connected = storage != null;
  const lastOk = connected && (storage.lastTestOk as boolean | null) === true;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Client-controlled storage</h3>
          <p className="text-xs text-muted-foreground">
            {connected
              ? `Connected to bucket “${String(storage.bucket)}”. Your leads, reports and files are stored in your own cloud storage.`
              : "Your acquisition data lives in your own cloud storage (S3-compatible). Waves runs the OS — you own the data."}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${lastOk ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : connected ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}>
          {connected ? (lastOk ? "CONNECTED" : "SAVED — NOT VERIFIED") : "NOT CONNECTED"}
        </span>
      </div>

      {connected ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy !== "none"} onClick={onRetestPersisted} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50">
            {busy === "test" ? "Testing…" : "Test Connection"}
          </button>
          <button type="button" disabled={busy !== "none"} onClick={onDisconnect} className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50">
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
          {testResult ? (
            <span className={`text-[11px] ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
              {testResult.ok ? `OK — ${Math.round(testResult.latencyMs ?? 0)}ms` : testResult.message ?? FAULT_LABELS[testResult.fault ?? ""] ?? "failed"}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block text-xs">
            <span className="text-muted-foreground">Bucket name</span>
            <input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="acme-company-data" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Region</span>
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs md:col-span-2">
            <span className="text-muted-foreground">Endpoint (optional — for S3-compatible providers)</span>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://s3.eu-west-1.amazonaws.com" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Access key</span>
            <input type="password" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Secret key</span>
            <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button type="button" disabled={busy !== "none"} onClick={onConnect} className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {busy === "connect" ? "Connecting…" : busy === "test" ? "Testing…" : "Connect Storage"}
            </button>
            <button type="button" disabled={busy !== "none"} onClick={testCandidate} className="rounded-md border px-4 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50">
              Test Connection
            </button>
          </div>
        </div>
      )}

      {testResult && !testResult.ok && !connected ? (
        <p className="mt-2 text-[11px] text-red-500">{testResult.message ?? FAULT_LABELS[testResult.fault ?? ""] ?? "Connection failed."}</p>
      ) : null}
      {notice ? (
        <p className={`mt-2 text-[11px] ${notice.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : notice.kind === "warn" ? "text-amber-600 dark:text-amber-400" : "text-red-500"}`}>
          {notice.text}
        </p>
      ) : null}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Credentials are sent once over HTTPS and stored encrypted — they are never shown again in this page.
      </p>
    </section>
  );
}