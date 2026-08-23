"use client";

import { useActionState } from "react";
import { Badge, Button } from "@wavesco/ui";
import { Boxes, Check, Power, AlertCircle, Sparkles } from "lucide-react";
import { disableModuleAction, enableModuleAction, type ModuleActionResult } from "@/lib/modules";

const initialState: ModuleActionResult = { ok: false };

export interface ModuleCardProps {
  name: string;
  displayName: string;
  description: string;
  version: string;
  requiresEnv: string[];
  enabled: boolean;
  usage?: string;
  tables?: string[];
}

const iconMap: Record<string, string> = {
  "cafe-leads": "◐",
  "cafe-orders": "⬢",
  "cafe-inventory": "⬣",
  "cafe-crm": "⬥",
  "cafe-ops": "⬔",
};

export function ModuleCard({
  name,
  displayName,
  description,
  version,
  requiresEnv,
  enabled,
  usage,
  tables,
}: ModuleCardProps) {
  const [enableState, enableAction, enabling] = useActionState(enableModuleAction, initialState);
  const [disableState, disableAction, disabling] = useActionState(disableModuleAction, initialState);
  const error = enableState.error ?? disableState.error;

  return (
    <div
      className={`group relative flex flex-col rounded-[14px] border p-4 transition-all duration-200 ${
        enabled
          ? "border-emerald-200/60 bg-emerald-50/20 shadow-subtle hover:shadow-card dark:border-emerald-900/30 dark:bg-emerald-950/10"
          : "border-border/60 bg-card shadow-subtle hover:shadow-card hover:border-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-[10px] border text-[14px] shadow-subtle ${
              enabled ? "bg-card border-emerald-200/50 dark:border-emerald-900/30" : "bg-muted/40 border-border/60 text-muted-foreground"
            }`}
          >
            {iconMap[name] ?? <Boxes className="h-4 w-4" />}
          </div>
          <div>
            <p className="text-[13px] font-semibold tracking-tight leading-none">{displayName}</p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {name} · v{version}
            </p>
          </div>
        </div>
        <Badge
          variant={enabled ? "success" : "secondary"}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium h-6 ${enabled ? "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600" : ""}`}
        >
          {enabled ? (
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> Active
            </span>
          ) : (
            "Disabled"
          )}
        </Badge>
      </div>

      <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground line-clamp-2">{description}</p>

      {/* Meta */}
      <div className="mt-3 space-y-2">
        {usage ? (
          <div className="rounded-[10px] border border-border/60 bg-muted/20 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Usage</p>
            <p className="text-[12.5px] font-medium tracking-tight mt-0.5">{usage}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {tables?.slice(0, 3).map((t) => (
            <span key={t} className="rounded-full border border-border/60 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {t}
            </span>
          ))}
        </div>

        {requiresEnv.length > 0 ? (
          <div className="flex items-start gap-2 rounded-[9px] border border-amber-200/60 bg-amber-50/50 px-2.5 py-2 dark:border-amber-900/30 dark:bg-amber-950/20">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-200">
              Requires <span className="font-mono font-medium">{requiresEnv.join(", ")}</span>
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" /> No credentials required
          </div>
        )}

        {error ? (
          <p role="alert" className="rounded-[8px] border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div className="mt-4 flex gap-2">
        {enabled ? (
          <form action={disableAction} className="flex-1">
            <input type="hidden" name="moduleName" value={name} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={disabling}
              className="h-7 w-full rounded-full border-border/70 text-xs font-medium"
            >
              <Power className="h-3.5 w-3.5" />
              {disabling ? "Disabling…" : "Disable"}
            </Button>
          </form>
        ) : (
          <form action={enableAction} className="flex-1">
            <input type="hidden" name="moduleName" value={name} />
            <Button type="submit" size="sm" disabled={enabling} className="h-7 w-full rounded-full text-xs font-medium shadow-subtle">
              {enabling ? "Enabling…" : "Enable"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
