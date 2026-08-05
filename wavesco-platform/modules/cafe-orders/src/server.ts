import contract from "../module.contract.json";
import * as actions from "./actions";
import { swiggyWebhook } from "./routes/webhooks/swiggy";
import { zomatoWebhook } from "./routes/webhooks/zomato";
import type { WebhookRegistry } from "./types";

export interface ModuleInstance {
  contract: typeof contract;
  actions: typeof actions;
  webhooks: WebhookRegistry;
}

export function registerModule(): ModuleInstance {
  return {
    contract,
    actions,
    webhooks: {
      swiggy: swiggyWebhook,
      zomato: zomatoWebhook,
    },
  };
}
