// ESLint flat config for the Attenza TypeScript sources (API, web, shared).
// Run from the repo root: `pnpm lint`. Non-TypeScript files (configs,
// scripts, migrations) are out of scope — the lint script passes only
// .ts/.tsx paths, so this config's rules only ever apply to those.
import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.d.ts",
      "qa-shots/**",
      "design-concepts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Web is React: load only the two classic hooks rules. This makes the
  // existing eslint-disable-next-line react-hooks/exhaustive-deps comments
  // valid (without the plugin ESLint errors with "definition not found"),
  // without adopting the newer preset's error-level rules
  // (e.g. set-state-in-effect), which would flag existing web components
  // that are out of scope for this lint pass.
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Test mocks use `any` for stub services: production code stays
    // strictly typed, but forcing concrete mock types across every spec
    // adds churn without safety (specs never ship).
    files: ["**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
