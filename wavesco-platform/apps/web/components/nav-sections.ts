import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  FileText,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Mail,
  MailCheck,
  MessageSquare,
  Package,
  Plug,
  Settings,
  Sparkles,
  Target,
  Workflow,
  Radar,
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

/**
 * Single navigation source of truth for desktop sidebar + mobile drawer.
 * Primary: the daily acquisition workflow. Secondary: intelligence/operate.
 * Engineering concepts stay out of labels (e.g. "Generate", not "Lead Engine").
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "",
    items: [{ href: "/acquisition", label: "Command Center", icon: LayoutDashboard }],
  },
  {
    title: "Acquire",
    items: [
      { href: "/acquisition/profile", label: "Profile", icon: Settings },
      { href: "/acquisition/leads", label: "Leads", icon: Target },
      { href: "/acquisition/generate", label: "Generate", icon: Sparkles },
      { href: "/acquisition/pipeline", label: "Pipeline", icon: Radar },
      { href: "/acquisition/campaigns", label: "Campaigns", icon: Handshake },
      { href: "/acquisition/outreach", label: "Outreach", icon: Mail },
      { href: "/acquisition/replies", label: "Replies", icon: MessageSquare },
      { href: "/acquisition/follow-ups", label: "Follow-ups", icon: ListChecks },
      { href: "/acquisition/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    title: "Grow",
    items: [
      { href: "/acquisition/agents", label: "Waves AI", icon: Bot },
      { href: "/acquisition/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/intelligence/insights", label: "Insights", icon: Activity },
      { href: "/knowledge", label: "Knowledge", icon: BookOpen },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/products", label: "Your Products", icon: Package },
      { href: "/acquisition/workflows", label: "Workflows", icon: Workflow },
      { href: "/acquisition/integrations", label: "Integrations", icon: Plug },
      { href: "/acquisition/email", label: "Email Control", icon: MailCheck },
    ],
  },
];
