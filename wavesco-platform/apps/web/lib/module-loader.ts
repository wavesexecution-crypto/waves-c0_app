import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ModuleWebhookContract {
  path: string;
  method: string;
  signature: string;
}

export interface ModuleContract {
  name: string;
  displayName: string;
  version: string;
  description: string;
  entry: string;
  requiresEnv: string[];
  tables: string[];
  webhooks: ModuleWebhookContract[];
  permissions: { action: string; resource: string }[];
  audit: boolean;
  actions: string[];
}

export function modulesRoot(): string {
  return join(process.cwd(), "..", "..", "modules");
}

/** Reads every module contract JSON from the filesystem (server-only). */
export function loadModuleContracts(): ModuleContract[] {
  const root = modulesRoot();
  if (!existsSync(root)) return [];

  const contracts: ModuleContract[] = [];
  for (const entry of readdirSync(root)) {
    const file = join(root, entry, "module.contract.json");
    if (!existsSync(file)) continue;
    try {
      contracts.push(JSON.parse(readFileSync(file, "utf8")) as ModuleContract);
    } catch {
      // Unparseable contract — skip; verify-contracts surfaces the failure.
    }
  }
  return contracts;
}

export function getContract(name: string): ModuleContract | undefined {
  return loadModuleContracts().find((c) => c.name === name);
}
