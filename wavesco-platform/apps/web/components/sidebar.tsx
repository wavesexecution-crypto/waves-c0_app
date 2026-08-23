"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Boxes,
  CreditCard,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@wavesco/ui";
import { Badge } from "@wavesco/ui";

interface NavSection {
  label: string;
  items: NavItem[];
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

const sections: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/system", label: "My System", icon: Layers },
      { href: "/modules", label: "Modules", icon: Boxes },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/ai", label: "AI", icon: Sparkles },
      { href: "/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/support", label: "Support", icon: LifeBuoy },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar({
  plan,
  tenantName,
  onNavigate,
}: {
  plan?: string;
  tenantName?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Brand — precise, quiet */}
      <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-border/60 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-foreground text-background">
          <span className="text-[11px] font-semibold tracking-[0.04em]">W</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-none tracking-[-0.02em]">WavesCo</p>
          <p className="text-[10.5px] leading-none tracking-wide text-muted-foreground mt-0.5">Business OS</p>
        </div>
        {plan ? (
          <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-medium tracking-wide uppercase">
            {plan}
          </Badge>
        ) : null}
      </div>

      {/* Navigation — generous breathing, strong hierarchy */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13px] font-[450] leading-none transition-all duration-150",
                          active
                            ? "bg-foreground text-background shadow-subtle"
                            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-[15px] w-[15px] shrink-0 transition-colors",
                            active ? "text-background" : "text-muted-foreground group-hover:text-foreground",
                          )}
                          strokeWidth={active ? 2.2 : 1.7}
                        />
                        <span className="flex-1 truncate tracking-[-0.01em]">{item.label}</span>
                        {item.badge ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                              active ? "bg-white/15 text-white" : "bg-muted text-muted-foreground",
                            )}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer — system health, quiet */}
      <div className="shrink-0 border-t border-border/60 p-3">
        <div className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-20"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="text-[11px] font-medium tracking-tight">All systems operational</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {tenantName ? `${tenantName} · ` : ""}Managed by WavesCo
          </p>
        </div>
      </div>
    </div>
  );
}

export function SidebarNav() {
  return <Sidebar />;
}
