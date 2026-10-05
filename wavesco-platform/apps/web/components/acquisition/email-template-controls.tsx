"use client";

import { useState } from "react";

type Template = { id: string; subject: string; body: string; createdAt?: string };

export function EmailTemplateControls({ initialTemplates }: { initialTemplates: Template[] }) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [subject, setSubject] = useState("Hello {{business}} — quick intro");
  const [body, setBody] = useState(
    "Hi {{business}} in {{city}},\n\nWe help businesses in {{city}} bring in more customers through better online presence. Would you be open to a short chat this week?\n\n— WavesCo"
  );
  const [varsBiz, setVarsBiz] = useState("Acme Corp");
  const [varsCity, setVarsCity] = useState("Pune");
  const [varsEmail, setVarsEmail] = useState("acme@example.com");
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function doPreview() {
    setPending("preview");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/acquisition/email/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          template: { subject, body },
          vars: { business: varsBiz, city: varsCity, email: varsEmail },
        }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Preview failed ${res.status}`);
      const p = json.preview ?? json.rendered ?? json;
      setPreview({ subject: p.subject ?? "", body: p.body ?? "" });
      setMessage("Preview rendered — no email sent (server-side render only, audit-logged as email.template.preview)");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function doCreate() {
    setPending("create");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/acquisition/email/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", template: { subject, body } }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Create failed ${res.status}`);
      const tmpl = json.template as Template;
      if (tmpl) {
        setTemplates((prev) => [tmpl, ...prev]);
        setSelectedId(tmpl.id);
      }
      setMessage(`Template created ${tmpl?.id ?? ""} — audit-logged as email.template.create`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function doUpdate() {
    if (!selectedId) {
      setError("Select a template to update");
      return;
    }
    setPending("update");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/acquisition/email/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", templateId: selectedId, template: { subject, body } }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Update failed ${res.status}`);
      const tmpl = json.template as Template;
      if (tmpl) {
        setTemplates((prev) => prev.map((t) => (t.id === tmpl.id ? tmpl : t)));
      }
      setMessage(`Template updated ${tmpl?.id ?? selectedId} — audit-logged as email.template.update`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  function loadTemplate(t: Template) {
    setSubject(t.subject);
    setBody(t.body);
    setSelectedId(t.id);
    setPreview(null);
    setMessage(`Loaded template ${t.id}`);
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/80 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-sans text-[13px] font-semibold">Templates — Manage &amp; Preview</h3>
          <p className="font-sans text-[13px] leading-5 text-muted-foreground">
            List, create, update, and preview templates. Preview renders with <code className="rounded bg-muted px-1 py-0.5">{"{{business}}"}</code>{" "}
            <code className="rounded bg-muted px-1 py-0.5">{"{{city}}"}</code> without sending — audit-logged as email.template.preview.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">{templates.length} templates</span>
      </div>

      {templates.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border/80">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/20 text-left uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className={`border-b last:border-0 hover:bg-accent/40 ${selectedId === t.id ? "bg-accent/30" : ""}`}>
                  <td className="px-3 py-2 font-mono text-[11px]">{t.id.slice(0, 14)}.</td>
                  <td className="max-w-[260px] truncate px-3 py-2" title={t.subject}>
                    {t.subject}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "-"}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => loadTemplate(t)} className="rounded border px-2 py-1 text-[11px] hover:bg-accent">
                      Load
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border/80 border-dashed p-4 text-center text-xs text-muted-foreground">
          No templates yet — create one below. Templates are tenant-scoped and audit-logged. If EmailTemplate table not configured, templates persist as ActivityEvent (type=email_template) or in-memory.
        </div>
      )}

      <div className="grid gap-3">
        <label className="text-xs">
          <span className="text-muted-foreground">Subject — supports {"{{business}}"} {"{{city}}"} {"{{email}}"}</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Hello {{business}}"
            className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-2 font-sans text-[13px]"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Body — supports {"{{business}}"} {"{{city}}"}</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Hi {{business}} in {{city}}..."
            className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-2 font-mono text-xs"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">
            <span className="text-muted-foreground">Preview: business</span>
            <input value={varsBiz} onChange={(e) => setVarsBiz(e.target.value)} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 text-xs" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Preview: city</span>
            <input value={varsCity} onChange={(e) => setVarsCity(e.target.value)} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 text-xs" />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Preview: email</span>
            <input value={varsEmail} onChange={(e) => setVarsEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-border/80 bg-transparent px-2 py-1.5 text-xs" />
          </label>
        </div>
        {selectedId ? <p className="text-[11px] text-muted-foreground">Editing template: <span className="font-mono">{selectedId}</span></p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!pending}
            onClick={doPreview}
            className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {pending === "preview" ? "Rendering." : "Preview (no send)"}
          </button>
          <button
            type="button"
            disabled={!!pending}
            onClick={doCreate}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pending === "create" ? "Creating." : "Create"}
          </button>
          <button
            type="button"
            disabled={!!pending || !selectedId}
            onClick={doUpdate}
            className="rounded-lg border border-border/80 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {pending === "update" ? "Updating." : "Update"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setPreview(null);
              setMessage("Cleared selection");
            }}
            className="rounded-lg border border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            Clear
          </button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-border/80 bg-muted/30 p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Preview — Rendered (no send)</p>
            <p className="mt-1 font-sans text-[13px] font-medium">Subject: {preview.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-card p-2 text-xs">{preview.body}</pre>
            <p className="mt-2 text-[11px] text-muted-foreground">Variables: business={varsBiz}, city={varsCity}, email={varsEmail} — rendered server-side via POST preview, audit-logged.</p>
          </div>
        ) : null}
        {message ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
      </div>
    </div>
  );
}
