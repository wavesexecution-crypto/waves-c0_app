"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@wavesco/ui/src/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  before?: string;
  after?: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  pending?: boolean;
}

/**
 * Safe destructive confirmation dialog — shows before/after preview.
 * Uses Dialog from @wavesco/ui (Radix) for consistent UX.
 * Falls back to window.confirm only if Dialog is not available, but
 * this component is the preferred path for all destructive actions.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  before,
  after,
  confirmLabel = "Confirm",
  variant = "destructive",
  onConfirm,
  pending = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {(before || after) && (
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs">
            {before && (
              <div>
                <span className="font-medium uppercase tracking-wide text-muted-foreground">Before:</span>{" "}
                <span className="font-mono">{before}</span>
              </div>
            )}
            {after && (
              <div>
                <span className="font-medium uppercase tracking-wide text-muted-foreground">After:</span>{" "}
                <span className="font-mono">{after}</span>
              </div>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          This action is audit-logged (who/what/when, before/after) and reflects live DB/n8n state. Failures are surfaced, not hidden.
        </p>
        <DialogFooter>
          <button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={
              variant === "destructive"
                ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                : "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            }
          >
            {pending ? "…" : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook-like helper for destructive actions that prefer window.confirm
 * when Dialog is not desired, but still enforces before/after visibility.
 * Use this to keep audit-safe messaging consistent.
 */
export function confirmDestructive(opts: {
  title: string;
  before: string;
  after: string;
  detail?: string;
}): boolean {
  const msg = `${opts.title}\n\nBefore: ${opts.before}\nAfter: ${opts.after}${opts.detail ? `\n\n${opts.detail}` : ""}\n\nThis is audit-logged. Continue?`;
  if (typeof window !== "undefined") return window.confirm(msg);
  return false;
}

export function useConfirmDialog() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    description: string;
    before?: string;
    after?: string;
    confirmLabel?: string;
    variant?: "default" | "destructive";
    onConfirm?: () => void;
  }>({ open: false, title: "", description: "" });

  const confirm = (opts: {
    title: string;
    description: string;
    before?: string;
    after?: string;
    confirmLabel?: string;
    variant?: "default" | "destructive";
    onConfirm: () => void;
  }) => {
    setState({ open: true, ...opts });
  };

  const dialog = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}
      title={state.title}
      description={state.description}
      before={state.before}
      after={state.after}
      confirmLabel={state.confirmLabel}
      variant={state.variant}
      onConfirm={() => state.onConfirm?.()}
    />
  );

  return { confirm, dialog };
}
