import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import convexPlugin from "@convex-dev/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Convex rules (scoped to convex/**): args validators, explicit table ids,
  // no process.env (use the typed `env`), no Date.now()/Math.random in queries…
  ...convexPlugin.configs.recommended,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "convex/_generated/**", ".convex/**"]),
]);

export default eslintConfig;
