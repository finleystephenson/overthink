// ESLint flat config. Type-aware rules for all the TypeScript.
// The older JavaScript is not linted yet; it moves to TypeScript module by module.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.d.mts", "node_modules/**", ".overthink/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // Google TypeScript style guide: named exports, no `any`, `import type` for types, === always.
      "no-restricted-syntax": ["error", { selector: "ExportDefaultDeclaration", message: "Use named exports (Google TS style)." }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off", "@typescript-eslint/no-floating-promises": "off" },
  },
);
