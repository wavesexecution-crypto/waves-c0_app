"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Action = "activate" | "pause" | "resume" | "suspend";

export function ProfileLifecycleControls({ status, ready }: { status: string; ready: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: Action) {
    const confirmText =
      action === "activate"
        ? "Activate Acquisition OS? The OS will start operating with the current brief."
        : action === "pause"
          ? "Pause Acquisition OS?"
          : action === "suspend"
            ? "Suspend Acquisition OS? This stops all acquisition activity."
            : "Resume Acquisition OS?";
    if (!window.confirm(confirmText)) return;
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch("/api/acquisition/profile/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || j.detail || `Failed: ${res.status}`);
      router.refresh();
      setMsg(`✓ ${action} → ${j.nextStatus || j.profile?.status}`);
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "READY" && (
        <button
          onClick={() => act("activate")}
          disabled={busy !== null || !ready}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-sans text-[13px] font-medium disabled:opacity-50"
        >
          {busy === "activate" ? "Activating…" : "Activate — Rent & Operate"}
        </button>
      )}
      {status === "ACTIVE" && (
        <>
          <button onClick={() => act("pause")} disabled={busy !== null} className="px-4 py-2 border rounded-lg font-sans text-[13px]">
            {busy === "pause" ? "Pausing…" : "Pause"}
          </button>
          <button onClick={() => act("suspend")} disabled={busy !== null} className="px-4 py-2 border rounded-lg font-sans text-[13px]">
            {busy === "suspend" ? "Suspending…" : "Suspend"}
          </button>
        </>
      )}
      {status === "PAUSED" && (
        <>
          <button onClick={() => act("resume")} disabled={busy !== null || !ready} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-sans text-[13px]">
            {busy === "resume" ? "Resuming…" : "Resume"}
          </button>
          <button onClick={() => act("suspend")} disabled={busy !== null} className="px-4 py-2 border rounded-lg font-sans text-[13px]">
            Suspend
          </button>
        </>
      )}
      {["DRAFT", "INCOMPLETE"].includes(status) && !ready && (
        <span className="font-sans text-[13px] text-muted-foreground">Complete required fields to activate</span>
      )}
      {msg && <span className="font-sans text-[13px] text-muted-foreground ml-2">{msg}</span>}
    </div>
  );
}

export function ProfileQuickForm({
  title,
  fields,
  initial,
  onSaved,
}: {
  title: string;
  fields: Array<{ key: string; label: string; placeholder?: string; type?: "text" | "textarea" | "number" }>;
  initial: Record<string, unknown>;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      const raw = (initial as any)?.[f.key];
      v[f.key] = raw == null ? "" : String(raw);
    }
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    setSaving(true);
    setErr(null);
    setOk(false);
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      let val: unknown = values[f.key];
      if (f.type === "number") {
        const n = Number(val);
        val = val === "" ? null : Number.isFinite(n) ? n : null;
      } else if (typeof val === "string") {
        val = val.trim() === "" ? null : val.trim();
      }
      payload[f.key] = val;
    }
    // Handle icp/offer/brand/rules nested JSON keys: if key contains dot, parse accordingly
    // For flat keys we send as top-level; for icp.* we need to merge into icp object
    const body: Record<string, unknown> = {};
    const jsonGroups: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k.includes(".")) {
        const [group, sub] = k.split(".", 2);
        if (group && sub) {
          if (!jsonGroups[group]) jsonGroups[group] = { ...(((initial as any)[group] as Record<string, unknown>) || {}) };
          jsonGroups[group][sub] = v;
        }
      } else {
        body[k] = v;
      }
    }
    for (const [g, obj] of Object.entries(jsonGroups)) body[g] = obj;

    try {
      const res = await fetch("/api/acquisition/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || j.errors?.join(", ") || `Save failed ${res.status}`);
      setOk(true);
      router.refresh();
      onSaved?.();
      setTimeout(() => setOk(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 border rounded-lg p-4 bg-card">
      <h4 className="font-medium">{title}</h4>
      <div className="grid gap-3">
        {fields.map((f) => (
          <label key={f.key} className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
            {f.type === "textarea" ? (
              <textarea
                value={values[f.key] || ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                rows={3}
                className="border rounded-lg px-3 py-2 font-sans text-[13px] bg-background"
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key] || ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="border rounded-lg px-3 py-2 font-sans text-[13px] bg-background"
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-sans text-[13px] disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {ok && <span className="font-sans text-[13px] text-green-600">Saved</span>}
        {err && <span className="font-sans text-[13px] text-destructive">{err}</span>}
      </div>
    </div>
  );
}

export function DataImportControl({ profileId }: { profileId?: string | null }) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("csv");
  const [rowCount, setRowCount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (file) {
      await submitWithUpload();
      return;
    }
    if (!fileName.trim()) {
      setMsg("Choose a file to upload, or enter a file name to record a metadata-only import.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await recordImport(fileName.trim(), fileType, rowCount ? Number(rowCount) : undefined, null);
      setMsg(`✓ Recorded ${fileName.trim()}`);
      router.refresh();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function recordImport(name: string, type: string, rows: number | undefined, objectId: string | null) {
    const res = await fetch("/api/acquisition/profile/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: name, fileType: type,
        rowCount: rows,
        summary: { uploadedAt: new Date().toISOString(), ...(objectId ? { objectId } : { bytesStored: false }) },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Import failed");
    return j;
  }

  async function submitWithUpload() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "data-import");
      const up = await fetch("/api/acquisition/storage/objects", { method: "POST", body: form });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(uj.reason || uj.error || `Upload failed (${up.status})`);
      const ext = (file.name.split(".").pop() ?? "csv").toLowerCase();
      const type = ext === "xlsx" ? "excel" : ext === "json" ? "json" : "csv";
      await recordImport(file.name, type, undefined, uj.objectId ?? null);
      setMsg(`✓ Uploaded and recorded ${file.name} (${uj.sizeBytes ?? "?"} bytes)`);
      setFile(null);
      setFileName("");
      router.refresh();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <h4 className="font-medium">Existing acquisition data</h4>
      <p className="font-sans text-[13px] leading-5 text-muted-foreground">Upload a CSV/XLSX/JSON file (stored durably, max 10 MB) — or record a metadata-only import. Uploads are validated and tenant-isolated.</p>
      <div className="grid gap-2 md:grid-cols-3">
        <input type="file" accept=".csv,.xlsx,.json" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setFileName(f.name); }} className="border rounded-lg px-3 py-2 font-sans text-[13px] bg-background md:col-span-1" />
        <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="leads-2026-09-02.csv" className="border rounded-lg px-3 py-2 font-sans text-[13px] bg-background" />
        <div className="flex gap-2">
          <select value={fileType} onChange={(e) => setFileType(e.target.value)} className="border rounded-lg px-3 py-2 font-sans text-[13px] bg-background">
            <option value="csv">csv</option>
            <option value="excel">excel</option>
            <option value="json">json</option>
          </select>
          <input value={rowCount} onChange={(e) => setRowCount(e.target.value)} placeholder="rows" type="number" className="border rounded-lg px-3 py-2 font-sans text-[13px] bg-background w-24" />
        </div>
      </div>
      {file && <p className="font-sans text-[13px] leading-5 text-muted-foreground">Selected: {file.name} ({file.size.toLocaleString()} bytes) — will upload on submit.</p>}
      <button onClick={submit} disabled={busy} className="px-3 py-1.5 border rounded-lg font-sans text-[13px] disabled:opacity-50">
        {busy ? "Working…" : file ? "Upload & record import" : "Record import"}
      </button>
      {msg && <div className="font-sans text-[13px] text-muted-foreground">{msg}</div>}
      {profileId && <div className="font-sans text-[13px] leading-5 text-muted-foreground">Profile: {profileId.slice(0, 8)}… tenant-isolated</div>}
    </div>
  );
}
