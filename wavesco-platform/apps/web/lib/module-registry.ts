import { registerModule as leads } from "@wavesco/cafe-leads/server";
import { registerModule as orders } from "@wavesco/cafe-orders/server";
import { registerModule as inventory } from "@wavesco/cafe-inventory/server";
import { registerModule as crm } from "@wavesco/cafe-crm/server";
import { registerModule as ops } from "@wavesco/cafe-ops/server";
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

/** Statically-built registry of all installed CafeOS modules. */
export function buildRegistry(): Record<string, LoadedModule> {
  const leadsInstance = leads();
  const ordersInstance = orders();
  const inventoryInstance = inventory();
  const crmInstance = crm();
  const opsInstance = ops();

  return {
    [leadsInstance.contract.name]: {
      contract: normalizeContract(leadsInstance.contract),
      actions: leadsInstance.actions,
      webhooks: leadsInstance.webhooks,
    },
    [ordersInstance.contract.name]: {
      contract: normalizeContract(ordersInstance.contract),
      actions: ordersInstance.actions,
      webhooks: ordersInstance.webhooks,
    },
    [inventoryInstance.contract.name]: {
      contract: normalizeContract(inventoryInstance.contract),
      actions: inventoryInstance.actions,
      webhooks: inventoryInstance.webhooks,
    },
    [crmInstance.contract.name]: {
      contract: normalizeContract(crmInstance.contract),
      actions: crmInstance.actions,
      webhooks: crmInstance.webhooks,
    },
    [opsInstance.contract.name]: {
      contract: normalizeContract(opsInstance.contract),
      actions: opsInstance.actions,
      webhooks: opsInstance.webhooks,
    },
  };
}

export function getModule(name: string): LoadedModule | undefined {
  return buildRegistry()[name];
}
