import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Brain,
  CreditCard,
  FileText,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageSquare,
  Package,
  Radar,
  Settings,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Single source of truth for dashboard navigation.
 *  Rendered by the desktop sidebar and the mobile drawer so a client can
 *  reach every screen at every viewport. Every href resolves to a route. */
export function buildNavSections(internalAccess: boolean): NavSection[] {
  return [
    {
      title: "Waves",
      items: [
        { href: "/products", label: "Your Products", icon: Package },
        { href: "/billing", label: "Billing", icon: CreditCard },
      ],
    },
    {
      title: "",
      items: [{ href: "/command", label: "Command Center", icon: LayoutDashboard }],
    },
    {
      title: "Acquisition OS",
      items: [
        { href: "/acquisition", label: "Overview", icon: Radar },
        { href: "/acquisition/profile", label: "Company Profile", icon: Settings },
        { href: "/acquisition/leads", label: "Leads", icon: Target },
        { href: "/acquisition/generate", label: "Lead Engine", icon: Sparkles },
        { href: "/acquisition/pipeline", label: "Outreach Pipeline", icon: Radar },
        { href: "/acquisition/campaigns", label: "Campaigns", icon: Handshake },
        { href: "/acquisition/outreach", label: "Cold Email", icon: Mail },
        { href: "/acquisition/replies", label: "Replies", icon: MessageSquare },
        { href: "/acquisition/follow-ups", label: "Follow-ups", icon: ListChecks },
        { href: "/acquisition/reports", label: "Reports", icon: FileText },
        { href: "/acquisition/analytics", label: "Acquisition Analytics", icon: BarChart3 },
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
      title: "Delivery",
      items: [{ href: "/clients", label: "Clients", icon: Users }],
    },
    {
      title: "Knowledge",
      items: [{ href: "/knowledge", label: "Knowledge Base", icon: BookOpen }],
    },
    ...(internalAccess
      ? [{ title: "", items: [{ href: "/modules", label: "Modules", icon: Bot }] }]
      : []),
    {
      title: "",
      items: [{ href: "/settings", label: "Settings", icon: Settings }],
    },
  ];
}

/** True when `href` is the active route for `pathname`. */
export function isActiveHref(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  return href !== "/" && href.split("/").length >= 2 && pathname.startsWith(`${href}/`);
}