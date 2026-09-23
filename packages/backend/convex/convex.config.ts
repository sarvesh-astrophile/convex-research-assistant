import agent from "@convex-dev/agent/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GATEWAY_MODEL_ID: v.optional(v.string()),
  },
});
app.use(agent);
app.use(betterAuth);

export default app;
