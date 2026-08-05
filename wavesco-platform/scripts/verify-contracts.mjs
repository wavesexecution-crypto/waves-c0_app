// Validates every modules/*/module.contract.json against
// docs/module-contract.schema.json (JSON Schema draft-07).
//
// No modules yet (Phase 6) -> exits 0 with a notice.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const schemaPath = join(root, "docs", "module-contract.schema.json");
const modulesDir = join(root, "modules");

if (!existsSync(schemaPath)) {
  console.error("Missing docs/module-contract.schema.json");
  process.exit(1);
}

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validate(instance, schema) {
  const errors = [];
  const typeOk =
    (schema.type === "integer" && Number.isInteger(instance)) ||
    (schema.type === "array" && Array.isArray(instance)) ||
    (schema.type === "object" && typeof instance === "object" && instance !== null && !Array.isArray(instance)) ||
    (schema.type === "string" && typeof instance === "string") ||
    (schema.type === "boolean" && typeof instance === "boolean");
  if (schema.type && !typeOk) {
    return [{ path: "$", message: "expected " + schema.type + ", got " + typeName(instance) }];
  }
  if (schema.type === "object") {
    if (schema.required) {
      for (const key of schema.required) {
        if (instance[key] === undefined) errors.push({ path: "$." + key, message: "missing required property" });
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (instance[key] !== undefined) {
          for (const e of validate(instance[key], propSchema)) {
            errors.push({ path: "$." + key + e.path.slice(1), message: e.message });
          }
        }
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!schema.properties?.[key]) errors.push({ path: "$." + key, message: "unexpected property" });
      }
    }
  }
  if (schema.type === "array" && Array.isArray(instance)) {
    if (schema.items) {
      instance.forEach((item, i) => {
        for (const e of validate(item, schema.items)) {
          errors.push({ path: "$[" + i + "]" + e.path.slice(1), message: e.message });
        }
      });
    }
  }
  if (schema.pattern && typeof instance === "string" && !new RegExp(schema.pattern).test(instance)) {
    errors.push({ path: "$", message: "does not match pattern " + schema.pattern });
  }
  if (schema.enum && !schema.enum.includes(instance)) {
    errors.push({ path: "$", message: "must be one of " + schema.enum.join(", ") });
  }
  if (schema.type === "string" && schema.minLength && instance.length < schema.minLength) {
    errors.push({ path: "$", message: "shorter than minLength " + schema.minLength });
  }
  return errors;
}

if (!existsSync(modulesDir)) {
  console.log("No modules/ directory yet - contract verification skipped (Phase 6).");
  process.exit(0);
}

const contractFiles = [];
for (const entry of readdirSync(modulesDir)) {
  const dir = join(modulesDir, entry);
  if (!statSync(dir).isDirectory()) continue;
  const file = join(dir, "module.contract.json");
  if (existsSync(file)) contractFiles.push(file);
}

let failed = false;
for (const file of contractFiles) {
  const contract = JSON.parse(readFileSync(file, "utf8"));
  const errors = validate(contract, schema);
  if (errors.length > 0) {
    failed = true;
    console.error("FAIL " + file);
    for (const e of errors) console.error("    " + e.path + " " + e.message);
  } else {
    console.log("PASS " + file);
  }
}

if (failed) process.exit(1);
console.log("Validated " + contractFiles.length + " module contract(s).");
