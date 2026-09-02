"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Brain,
  FileText,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Mail,
  Radar,
  Settings,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@wavesco/ui";

interface NavItem {
  href?: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function Sidebar({ internalAccess = true }: { internalAccess?: boolean }) {
  const pathname = usePathname();

  const sections: NavSection[] = [
    {
      title: "",
      items: [{ href: "/command", label: "Command Center", icon: LayoutDashboard }],
    },
    {
      title: "Acquisition OS",
      items: [
        { href: "/acquisition", label: "Overview", icon: Radar },
        { href: "/acquisition/leads", label: "Leads", icon: Target },
        { href: "/acquisition/generate", label: "Lead Engine", icon: Sparkles },
        { href: "/acquisition/pipeline", label: "Outreach Pipeline", icon: Radar },
        { href: "/acquisition/campaigns", label: "Campaigns", icon: Handshake },
        { href: "/acquisition/outreach", label: "Cold Email", icon: Mail },
        { href: "/acquisition/follow-ups", label: "Follow-ups", icon: ListChecks },
        { href: "/acquisition/reports", label: "Reports", icon: FileText },
      ],
    },
    {
      title: "Intelligence",
      items: [
        { href: "/intelligence/ai", label: "Waves AI", icon: Brain },
        { href: "/intelligence/analytics", label: "Analytics", icon: BarChart3 },
        { href: "/intelligence/insights", label: "Insights", icon: Activity },
      ],
    },
    {
      title: "Knowledge",
      items: [{ href: "/knowledge", label: "Knowledge Base", icon: BookOpen }],
    },
    ...(internalAccess
      ? ([
          {
            title: "",
            items: [{ href: "/modules", label: "Modules", icon: Bot }],
          },
        ] as NavSection[])
      : []),
    {
      title: "",
      items: [{ href: "/settings", label: "Settings", icon: Settings }],
    },
  ];

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
      {sections.map((section, si) => (
        <div key={si} className="space-y-1">
          {section.title ? (
            <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {section.title}
            </p>
          ) : null}
          {section.items.map((item) => {
            const Icon = item.icon;
            const active = item.href ? (pathname === item.href || (item.href !== "/" && item.href.split("/").length === 2 ? pathname.startsWith(`${item.href}/`) : pathname === item.href)) : false;

            if (item.disabled || !item.href) {
              return (
                <span
                  key={item.label}
                  title="Coming in a later phase"
                  className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-1.5 text-sm text-muted-foreground/50"
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
