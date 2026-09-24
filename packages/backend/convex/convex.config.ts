import agent from "@convex-dev/agent/convex.config";
import aiBudget from "@convex-dev/ai-budget/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import exa from "@exalabs/convex-exa/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GATEWAY_MODEL_ID: v.optional(v.string()),
    EXA_API_KEY: v.string(),
    GATEWAY_EMBEDDING_MODEL: v.optional(v.string()),
    GATEWAY_EMBEDDING_DIMS: v.optional(v.string()),
    MAX_DOCS_PER_THREAD: v.optional(v.string()),
    MAX_PDF_BYTES: v.optional(v.string()),
    MAX_PDF_PAGES: v.optional(v.string()),
    RESEARCH_MAX_TASKS: v.optional(v.string()),
    BUDGET_MONTHLY_USD_DEFAULT: v.optional(v.string()),
    BUDGET_ALERT_THRESHOLDS: v.optional(v.string()),
    RATE_LIMIT_RESEARCH_PER_HOUR: v.optional(v.string()),
    RATE_LIMIT_CHAT_PER_MINUTE: v.optional(v.string()),
    MAX_REPORT_TOKENS: v.optional(v.string()),
    GATEWAY_COMPARISON_MODEL_IDS: v.optional(v.string()),
    GATEWAY_MODEL_PRICES_JSON: v.optional(v.string()),
    ADMIN_EMAIL: v.optional(v.string()),
  },
});
app.use(agent);
app.use(betterAuth);
app.use(aiBudget);
app.use(rateLimiter);
app.use(workflow);
app.use(exa, { name: "exa", env: { EXA_API_KEY: app.env.EXA_API_KEY } });

export default app;
