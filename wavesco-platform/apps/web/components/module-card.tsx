"use client";

import { useActionState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@wavesco/ui";
import { disableModuleAction, enableModuleAction, type ModuleActionResult } from "@/lib/modules";

const initialState: ModuleActionResult = { ok: false };

export interface ModuleCardProps {
  name: string;
  displayName: string;
  description: string;
  version: string;
  requiresEnv: string[];
  enabled: boolean;
}

export function ModuleCard({
  name,
  displayName,
  description,
  version,
  requiresEnv,
  enabled,
}: ModuleCardProps) {
  const [enableState, enableAction, enabling] = useActionState(enableModuleAction, initialState);
  const [disableState, disableAction, disabling] = useActionState(disableModuleAction, initialState);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{displayName}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <Badge variant={enabled ? "success" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{name}</span> · v{version}
        </p>
        {requiresEnv.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Requires env: <span className="font-mono">{requiresEnv.join(", ")}</span>
          </p>
        ) : null}
        {enableState.error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {enableState.error}
          </p>
        ) : null}
        {disableState.error ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {disableState.error}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        {enabled ? (
          <form action={disableAction}>
            <input type="hidden" name="moduleName" value={name} />
            <Button type="submit" variant="outline" size="sm" disabled={disabling}>
              {disabling ? "Disabling…" : "Disable"}
            </Button>
          </form>
        ) : (
          <form action={enableAction}>
            <input type="hidden" name="moduleName" value={name} />
            <Button type="submit" size="sm" disabled={enabling}>
              {enabling ? "Enabling…" : "Enable"}
            </Button>
          </form>
        )}
      </CardFooter>
    </Card>
  );
}
