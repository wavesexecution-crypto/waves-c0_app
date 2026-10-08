import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Brain,
  ClipboardList,
  CreditCard,
  FileText,
  Handshake,
  House,
  LayoutDashboard,
  ListChecks,
  Mail,
  MessageSquare,
  Package,
  Plug,
  Radar,
  Send,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
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
        { href: "/acquisition", label: "Home", icon: House },
        { href: "/acquisition/profile", label: "Setup", icon: ClipboardList },
        { href: "/acquisition/leads", label: "Leads", icon: Target },
        { href: "/acquisition/outreach", label: "Outreach", icon: Mail },
        { href: "/acquisition/replies", label: "Replies", icon: MessageSquare },
        { href: "/acquisition/analytics", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      title: "Advanced",
      items: [
        { href: "/acquisition/generate", label: "Lead Engine", icon: Sparkles },
        { href: "/acquisition/pipeline", label: "Outreach Pipeline", icon: Radar },
        { href: "/acquisition/campaigns", label: "Campaigns", icon: Handshake },
        { href: "/acquisition/email", label: "Email Setup", icon: Send },
        { href: "/acquisition/follow-ups", label: "Follow-ups", icon: ListChecks },
        { href: "/acquisition/integrations", label: "Connections", icon: Plug },
        { href: "/acquisition/reports", label: "Documents", icon: FileText },
        { href: "/intelligence/analytics", label: "Analytics", icon: TrendingUp },
        { href: "/intelligence/insights", label: "Insights", icon: Activity },
      ],
    },
    {
      title: "Intelligence",
      items: [{ href: "/intelligence/ai", label: "Waves AI", icon: Brain }],
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