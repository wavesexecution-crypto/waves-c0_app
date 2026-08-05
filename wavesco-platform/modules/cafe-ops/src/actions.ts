import { z } from "zod";
import { withTenantContext } from "@wavesco/db";

export const briefingDateSchema = z.coerce.date();

export interface Briefing {
  date: Date;
  orderCount: number;
  orderValuePaise: number;
  leadCount: number;
  highPriorityLeads: number;
  lowStockItems: { name: string; currentStock: number }[];
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

export async function generateDailyBriefing(tenantId: string): Promise<Briefing> {
  const dayStart = startOfDay(new Date());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  return withTenantContext(tenantId, async (tx) => {
    const [orders, leads, inventory] = await Promise.all([
      tx.cafeOrder.findMany({
        where: { tenantId, placedAt: { gte: dayStart, lt: dayEnd } },
        select: { totalPaise: true },
      }),
      tx.cafeLead.findMany({
        where: { tenantId, createdAt: { gte: dayStart, lt: dayEnd } },
        select: { priority: true },
      }),
      tx.cafeInventoryItem.findMany({
        where: { tenantId, isActive: true },
        select: { name: true, currentStock: true, reorderPoint: true },
      }),
    ]);

    const briefing: Briefing = {
      date: dayStart,
      orderCount: orders.length,
      orderValuePaise: orders.reduce((sum, o) => sum + o.totalPaise, 0),
      leadCount: leads.length,
      highPriorityLeads: leads.filter((l) => l.priority === "HIGH").length,
      lowStockItems: inventory
        .filter((item) => item.currentStock <= item.reorderPoint)
        .sort((a, b) => a.currentStock - b.currentStock)
        .map((item) => ({ name: item.name, currentStock: item.currentStock })),
    };

    await tx.cafeOpsReport.create({
      data: {
        tenantId,
        type: "DAILY",
        title: `Daily briefing · ${dayStart.toISOString().slice(0, 10)}`,
        content: briefing,
        date: dayStart,
      },
    });

    return briefing;
  });
}

export interface WeeklyReport {
  weekStart: Date;
  orderCount: number;
  orderValuePaise: number;
  leadCount: number;
  customerCount: number;
}

export async function generateWeeklyReport(tenantId: string): Promise<WeeklyReport> {
  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  return withTenantContext(tenantId, async (tx) => {
    const [orders, leads, customers] = await Promise.all([
      tx.cafeOrder.aggregate({
        where: { tenantId, placedAt: { gte: weekStart, lt: weekEnd } },
        _count: true,
        _sum: { totalPaise: true },
      }),
      tx.cafeLead.count({ where: { tenantId, createdAt: { gte: weekStart, lt: weekEnd } } }),
      tx.cafeCustomer.count({ where: { tenantId } }),
    ]);

    const report: WeeklyReport = {
      weekStart,
      orderCount: orders._count,
      orderValuePaise: orders._sum.totalPaise ?? 0,
      leadCount: leads,
      customerCount: customers,
    };

    await tx.cafeOpsReport.create({
      data: {
        tenantId,
        type: "WEEKLY",
        title: `Weekly report · w/c ${weekStart.toISOString().slice(0, 10)}`,
        content: report,
        date: weekStart,
      },
    });

    return report;
  });
}

export const reportInputSchema = z.object({
  type: z.enum(["DAILY", "WEEKLY"]),
});
