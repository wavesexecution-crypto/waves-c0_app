import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint 9 flat config for the WavesCo monorepo.
 *
 * Enforces:
 * - strict TS rules (no `any`, no `unsafe` members)
 * - no `console.log` / `console.warn` in source
 * - cross-module import enforcement via no-restricted-imports
 */
export function wavescoConfig(options = {}) {
  const { tsconfigRootDir = process.cwd() } = options;

  return defineConfig([
    globalIgnores([
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/__generated__/**",
      "**/generated/**",
      "**/*.json",
      "**/next-env.d.ts",
    ]),
    {
      name: "wavesco/base",
      files: ["**/*.{ts,tsx}"],
      ignores: ["**/*.config.*", "**/seed.*", "**/scripts/**"],
      languageOptions: {
        globals: { ...globals.node, ...globals.browser },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      plugins: {
        "@typescript-eslint": tseslint.plugin,
      },
      extends: [
        js.configs.recommended,
        ...tseslint.configs.strictTypeChecked,
        ...tseslint.configs.stylisticTypeChecked,
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-return": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { "prefer": "type-imports" }
        ],
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": [
          "error",
          { "checksVoidReturn": { "attributes": false } }
        ],
        "@typescript-eslint/restrict-template-expressions": [
          "error",
          { "allowNumber": true }
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }
        ],
        "no-console": ["error", { "allow": ["error"] }],
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@wavesco/modules/*"],
                message:
                  "Cross-module imports are forbidden. Reach other modules only via the registry and their contracts.",
              },
            ],
          },
        ],
      },
    },
  ]);
}

export default wavescoConfig();
