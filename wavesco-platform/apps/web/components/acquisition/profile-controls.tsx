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
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {busy === "activate" ? "Activating…" : "Activate — Rent & Operate"}
        </button>
      )}
      {status === "ACTIVE" && (
        <>
          <button onClick={() => act("pause")} disabled={busy !== null} className="px-4 py-2 border rounded-md text-sm">
            {busy === "pause" ? "Pausing…" : "Pause"}
          </button>
          <button onClick={() => act("suspend")} disabled={busy !== null} className="px-4 py-2 border rounded-md text-sm">
            {busy === "suspend" ? "Suspending…" : "Suspend"}
          </button>
        </>
      )}
      {status === "PAUSED" && (
        <>
          <button onClick={() => act("resume")} disabled={busy !== null || !ready} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
            {busy === "resume" ? "Resuming…" : "Resume"}
          </button>
          <button onClick={() => act("suspend")} disabled={busy !== null} className="px-4 py-2 border rounded-md text-sm">
            Suspend
          </button>
        </>
      )}
      {["DRAFT", "INCOMPLETE"].includes(status) && !ready && (
        <span className="text-sm text-muted-foreground">Complete required fields to activate</span>
      )}
      {msg && <span className="text-sm text-muted-foreground ml-2">{msg}</span>}
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
        if (!jsonGroups[group]) jsonGroups[group] = { ...(((initial as any)[group] as Record<string, unknown>) || {}) };
        jsonGroups[group][sub] = v;
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
                className="border rounded-md px-3 py-2 text-sm bg-background"
              />
            ) : (
              <input
                type={f.type === "number" ? "number" : "text"}
                value={values[f.key] || ""}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="border rounded-md px-3 py-2 text-sm bg-background"
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        {ok && <span className="text-sm text-green-600">Saved</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </div>
  );
}

export function DataImportControl({ profileId }: { profileId?: string | null }) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("csv");
  const [rowCount, setRowCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    if (!fileName.trim()) {
      setMsg("File name required");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/acquisition/profile/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: fileName.trim(), fileType, rowCount: rowCount ? Number(rowCount) : undefined, summary: { uploadedAt: new Date().toISOString() } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Import failed");
      setMsg(`✓ Recorded ${j.import?.fileName}`);
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
      <p className="text-xs text-muted-foreground">Record CSV/Excel/CRM imports. Actual file bytes go via your storage; this logs the import for the brief (audited).</p>
      <div className="grid gap-2 md:grid-cols-3">
        <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="leads-2026-09-02.csv" className="border rounded-md px-3 py-2 text-sm bg-background" />
        <select value={fileType} onChange={(e) => setFileType(e.target.value)} className="border rounded-md px-3 py-2 text-sm bg-background">
          <option value="csv">csv</option>
          <option value="excel">excel</option>
          <option value="json">json</option>
        </select>
        <input value={rowCount} onChange={(e) => setRowCount(e.target.value)} placeholder="rows (e.g. 342)" type="number" className="border rounded-md px-3 py-2 text-sm bg-background" />
      </div>
      <button onClick={submit} disabled={busy} className="px-3 py-1.5 border rounded-md text-sm disabled:opacity-50">
        {busy ? "Recording…" : "Record import"}
      </button>
      {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      {profileId && <div className="text-xs text-muted-foreground">Profile: {profileId.slice(0, 8)}… tenant-isolated</div>}
    </div>
  );
}
