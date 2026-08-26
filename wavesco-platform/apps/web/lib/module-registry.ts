import { WAVECO_MODULES, getProductModule } from "./product-modules";
import type { ModuleContract } from "./module-loader";

export interface WebhookContext {
  request: Request;
  tenantId: string;
}

export type WebhookHandler = (ctx: WebhookContext) => Promise<Response>;

export interface LoadedModule {
  contract: ModuleContract;
  actions: Record<string, unknown>;
  webhooks: Record<string, WebhookHandler>;
}

function normalizeContract(raw: unknown): ModuleContract {
  return raw as ModuleContract;
}

/**
 * Statically-built registry of all installed WavesCo product modules.
 * The legacy Cafe demo modules have been removed; the generic module
 * framework (catalog + per-tenant enablement) is unchanged.
 */
export function buildRegistry(): Record<string, LoadedModule> {
  const registry: Record<string, LoadedModule> = {};
  for (const mod of WAVECO_MODULES) {
    registry[mod.contract.name] = {
      contract: normalizeContract(mod.contract),
      actions: {},
      webhooks: {},
    };
  }
  return registry;
}

export function getModule(name: string): LoadedModule | undefined {
  const mod = getProductModule(name);
  if (!mod) return undefined;
  return {
    contract: normalizeContract(mod.contract),
    actions: {},
    webhooks: {},
  };
}
