import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";

// The published @convex-dev/ai-budget rc imports its dashboard HTML with an
// extensionless path (`./dashboard`). Convex's bundler resolves that, but the
// edge-runtime test environment does not. Redirect that one specifier.
const dashboardPath = fileURLToPath(
  new URL("./node_modules/@convex-dev/ai-budget/dist/client/dashboard.js", import.meta.url),
);

const resolveAiBudgetDashboard: Plugin = {
  name: "resolve-ai-budget-dashboard",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "./dashboard" && importer?.includes("@convex-dev/ai-budget/dist/client")) {
      return dashboardPath;
    }
  },
};

export default defineConfig({
  plugins: [resolveAiBudgetDashboard],
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts"],
    server: { deps: { inline: ["@convex-dev/ai-budget"] } },
  },
});
