import { withTenantContext } from "@wavesco/db";
import { getLeadStats } from "./lead-engine";
import { computeIntegrationStatuses } from "./integrations";

/**
 * Assembles a compact, REAL company-context block for AI prompts.
 * Only live data enters here — never placeholders. Obsidian snippets are
 * appended by the caller when the operator supplies a knowledge topic.
 */
export async function buildCompanyContext(tenantId: string): Promise<string> {
  const lines: string[] = [];

  // Lead corpus (Lead Engine SQLite)
  try {
    const s = getLeadStats();
    const tiers = Object.entries(s.byTier)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `[Lead corpus · leads.db] total=${s.total} tiers(${tiers}) emailReady=${s.emailReady} contacted=${s.contacted} replies=${s.replies} optedOut=${s.optedOut} bounced=${s.bounced} newLast7d=${s.newLast7d}`,
    );
  } catch {
    lines.push("[Lead corpus] UNAVAILABLE");
  }

  // Platform PostgreSQL state
  try {
    await withTenantContext(tenantId, async (tx) => {
      const [campaigns, queued, sent, failed, followUps, clients, projects, openTasks] = await Promise.all([
        tx.campaign.count({ where: { tenantId } }),
        tx.outreachEmail.count({ where: { tenantId, status: { in: ["pending_approval", "submitted", "approved"] } } }),
        tx.outreachEmail.count({ where: { tenantId, status: "sent" } }),
        tx.outreachEmail.count({ where: { tenantId, status: "failed" } }),
        tx.followUp.count({ where: { tenantId, status: "pending" } }),
        tx.client.count({ where: { tenantId } }),
        tx.project.count({ where: { tenantId, status: { notIn: ["completed", "cancelled"] } } }),
        tx.projectTask.count({ where: { tenantId, status: { in: ["todo", "in_progress", "blocked"] } } }),
      ]);
      lines.push(
        `[Platform] campaigns=${campaigns} emailsQueued=${queued} emailsSent=${sent} emailsFailed=${failed} followUpsPending=${followUps} clients=${clients} activeProjects=${projects} openTasks=${openTasks}`,
      );
    });
  } catch {
    lines.push("[Platform] UNAVAILABLE");
  }

  // Integration health
  try {
    const systems = await computeIntegrationStatuses(tenantId);
    lines.push(
      `[Systems] ${systems.map((s) => `${s.key}:${s.state}`).join(" ")}`,
    );
  } catch {
    lines.push("[Systems] UNAVAILABLE");
  }

  return lines.join("\n");
}
