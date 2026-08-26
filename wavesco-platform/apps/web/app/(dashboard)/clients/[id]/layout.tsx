import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { getClientWorkspace } from "@/lib/client-workspace";
import { ClientTabs } from "@/components/clients/client-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export function generateMetadata(): Metadata {
  return { title: "Client · WavesCo" };
}

export default async function ClientLayout({ children, params }: LayoutProps) {
  const session = await auth();
  const tenantId = requireTenantId(session);
  const { id } = await params;
  const data = await getClientWorkspace(tenantId, id);
  if (!data) notFound();
  const { client } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/clients" className="text-xs text-muted-foreground hover:underline">
          ← Clients
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[client.company, client.email, client.phone].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <ClientTabs clientId={id} />
      {children}
    </div>
  );
}
