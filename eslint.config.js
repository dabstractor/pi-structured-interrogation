// @ts-check
// ESLint flat config — pi-interrogator.
// typescript-eslint recommended (non-type-aware): machine-gates the bug
// classes tsc does not catch (unused vars, == slips, unsafe negations).
// Wired into validate.sh Phase 1 via `npm run lint`.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Pipeline state and prose live here — never linted.
  { ignores: ["node_modules", "plan", "spec"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // Test fixtures legitimately stub broad host shapes; recommended's
      // other rules (unused vars, prefer-nullish, etc.) stay at error.
      "@typescript-eslint/no-explicit-any": "off",
      // The codebase-wide convention for intentionally-unused args/vars is
      // a leading underscore (stub/spy signatures, carried-for-parity
      // params); everything else unused is dead code and must be removed.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
