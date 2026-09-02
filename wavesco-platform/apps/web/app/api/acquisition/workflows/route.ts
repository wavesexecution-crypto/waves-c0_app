import { NextResponse } from "next/server";
import { requireControlAuth } from "@/lib/wavesco/control";
import { n8nBaseUrl, n8nApiKey, getWorkflows, getExecutions, readAutomationManifest } from "@/lib/wavesco/n8n";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireControlAuth();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const digest = (e as { digest?: string })?.digest as string | undefined;
    const isUnauthorized =
      msg === "UNAUTHORIZED" ||
      msg.includes("UNAUTHORIZED") ||
      msg.includes("NEXT_REDIRECT") ||
      (digest !== undefined && digest.includes("NEXT_REDIRECT"));
    if (isUnauthorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = n8nBaseUrl();
  if (!base) {
    return NextResponse.json({ status: "BLOCKED", reason: "N8N_BASE_URL missing", workflows: [] }, { status: 200 });
  }

  // Try live fetch; server-side key only
  try {
    const wfRes = await getWorkflows();
    if (wfRes.ok && wfRes.data) {
      // enrich with execution state best-effort
      let executions: unknown[] = [];
      try {
        const execRes = await getExecutions(20);
        if (execRes.ok && execRes.data) executions = execRes.data.data ?? [];
      } catch {
        // ignore execution fetch failure
      }
      const workflows = wfRes.data.data ?? [];
      // Attach execution hints where possible
      const execByWf = new Map<string, unknown[]>();
      for (const ex of executions as { workflowId?: string }[]) {
        const wid = ex.workflowId ?? "";
        if (!wid) continue;
        const arr = execByWf.get(wid) ?? [];
        arr.push(ex);
        execByWf.set(wid, arr);
      }
      const enriched = workflows.map((w) => ({
        ...w,
        executions: execByWf.get(w.id) ?? [],
      }));
      return NextResponse.json({ status: "ok", workflows: enriched, executions }, { status: 200 });
    }

    // Not ok -> fallback to manifest if available, else error
    if (wfRes.reason === "no_api_key") {
      const manifest = readAutomationManifest();
      if (manifest.ok && manifest.workflows) {
        return NextResponse.json(
          {
            status: "ok",
            workflows: manifest.workflows.map((m) => ({
              id: m.id,
              name: m.name,
              active: false,
              trigger: m.trigger,
              purpose: m.purpose,
              _fallback: true,
            })),
            executions: [],
            fallback: "manifest",
            reason: wfRes.error ?? "N8N_API_KEY missing — showing manifest inventory",
          },
          { status: 200 }
        );
      }
      return NextResponse.json({ status: "error", reason: wfRes.error ?? "N8N_API_KEY missing", workflows: [] }, { status: 200 });
    }

    // Other error (http_error, network, no_base_url)
    const manifest = readAutomationManifest();
    if (manifest.ok && manifest.workflows && manifest.workflows.length > 0) {
      return NextResponse.json(
        {
          status: "ok",
          workflows: manifest.workflows.map((m) => ({
            id: m.id,
            name: m.name,
            active: false,
            trigger: m.trigger,
            purpose: m.purpose,
            _fallback: true,
          })),
          executions: [],
          fallback: "manifest",
          reason: wfRes.error ?? "n8n unreachable — showing manifest inventory",
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ status: "error", reason: wfRes.error ?? "n8n unreachable", workflows: [] }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: "error", reason: msg, workflows: [] }, { status: 200 });
  }
}
