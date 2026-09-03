import { auth } from "@/lib/auth";
import { requireTenantId } from "@/lib/tenant";
import { withTenantContext } from "@wavesco/db";
import { FlashProfile } from "@/components/acquisition/flash-profile";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AcquisitionProfilePage() {
  const session = await auth();
  const tenantId = requireTenantId(session as any);

  let profile: any = null;
  try {
    profile = await withTenantContext(tenantId, async (tx: any) => {
      const p = await (tx as any).acquisitionProfile.findFirst({ where: { tenantId } });
      return p;
    });
  } catch {}

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <div className="flex items-center justify-between">
          <Link href="/acquisition" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            ← Back to Acquisition OS
          </Link>
          <span className="text-xs text-muted-foreground">One Waves account · tenant-isolated</span>
        </div>
      </div>
      <FlashProfile initialProfile={profile} />
    </div>
  );
}
