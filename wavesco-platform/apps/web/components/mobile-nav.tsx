"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { signOut } from "next-auth/react";
import { SidebarNav } from "@/components/sidebar-nav";

/** Mobile drawer navigation. Without this a client on a phone has no way to
 *  reach any screen below 768px, because the desktop rail is `hidden md:flex`.
 *  Uses the existing visual tokens (bg-card / border-border / text-muted-foreground)
 *  so the drawer matches the desktop rail exactly.
 *
 *  The overlay is portalled to <body> on purpose: this component lives inside
 *  the topbar, which carries `backdrop-blur`. `backdrop-filter` establishes a
 *  containing block, so a `position: fixed` descendant resolves against the
 *  56px header instead of the viewport and the drawer collapses to header height. */
export function MobileNav({ internalAccess = false }: { internalAccess?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close the drawer after navigation and on Escape.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="-ml-1 rounded-md p-1.5 text-foreground transition-colors hover:bg-card-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-ring md:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      {mounted
        && open
        && createPortal(
          <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => { setOpen(false); }}
              className="absolute inset-0 h-full w-full cursor-default bg-foreground/40"
            />
            <div className="absolute inset-y-0 left-0 flex h-full w-[min(280px,85vw)] flex-col border-r border-border/80 bg-card shadow-xl">
              <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-border/60 px-5">
                <Image src="/apple-touch-icon.png" alt="" width={24} height={24} className="h-6 w-6 rounded-sm object-cover" />
                <span className="font-mono text-[13px] font-semibold tracking-[0.08em] text-foreground">WAVES OS</span>
                <button
                  type="button"
                  onClick={() => { setOpen(false); }}
                  aria-label="Close navigation menu"
                  className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-3 py-4">
                <SidebarNav internalAccess={internalAccess} onNavigate={() => { setOpen(false); }} />
              </nav>

              <div className="shrink-0 border-t border-border/60 p-3">
                <button
                  type="button"
                  onClick={() => { void signOut({ callbackUrl: "/login" }); }}
                  className="w-full rounded-md border border-border/60 px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground"
                >
                  Sign out
                </button>
                <Link
                  href="/products"
                  onClick={() => { setOpen(false); }}
                  className="mt-2 block text-center font-mono text-[10px] text-muted-foreground/60 underline-offset-2 hover:underline"
                >
                  Waves products
                </Link>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}