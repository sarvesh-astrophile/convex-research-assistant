import agent from "@convex-dev/agent/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
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
  },
});
app.use(agent);
app.use(betterAuth);
app.use(exa, { name: "exa", env: { EXA_API_KEY: app.env.EXA_API_KEY } });

export default app;
