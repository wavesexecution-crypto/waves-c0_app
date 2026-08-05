import contract from "../module.contract.json";
import * as actions from "./actions";

export interface ModuleInstance {
  contract: typeof contract;
  actions: typeof actions;
  webhooks: Record<string, never>;
}

export function registerModule(): ModuleInstance {
  return {
    contract,
    actions,
    webhooks: {},
  };
}
