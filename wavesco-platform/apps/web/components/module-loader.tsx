import type { ReactNode } from "react";
import { Skeleton } from "@wavesco/ui";

export interface ModuleLoaderProps {
  loading: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Wrapper that renders a skeleton while a module's async UI loads, then
 * the module component. Modules register their UI via the registry; the
 * host app decides when to suspend on loading state.
 */
export function ModuleLoader({ loading, children, fallback }: ModuleLoaderProps) {
  if (loading) {
    return <>{fallback ?? <Skeleton className="h-24 w-full" />}</>;
  }
  return <>{children}</>;
}
