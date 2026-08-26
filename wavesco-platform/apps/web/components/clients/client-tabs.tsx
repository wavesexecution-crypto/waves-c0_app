"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@wavesco/ui";

const tabs = [
  { seg: "", label: "Overview" },
  { seg: "projects", label: "Projects" },
  { seg: "tasks", label: "Tasks" },
  { seg: "deliverables", label: "Deliverables" },
  { seg: "activity", label: "Activity" },
];

export function ClientTabs({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const base = `/clients/${clientId}`;
  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base;
        const active = pathname === href;
        return (
          <Link
            key={t.label}
            href={href}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-b-2 border-primary font-medium text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
