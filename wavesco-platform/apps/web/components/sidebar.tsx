"use client";

import { SidebarNav } from "@/components/sidebar-nav";

/** Desktop navigation rail. Renders the same items as the mobile drawer via
 *  `SidebarNav`, so no screen can exist on one viewport but not the other. */
export function Sidebar({ internalAccess = false }: { internalAccess?: boolean }) {
  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
      <SidebarNav internalAccess={internalAccess} />
    </nav>
  );
}