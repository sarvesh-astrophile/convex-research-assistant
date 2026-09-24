import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./authHelpers";
import { ai } from "./budget";
import { tokenCount } from "./budgetLogic";
import { env } from "./_generated/server";

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    return await ai.requests.list(ctx, { userId, limit: 20 });
  },
});

export const comparisonModels = query({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return (env.GATEWAY_COMPARISON_MODEL_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  },
});

export const compare = action({
  args: { sessionId: v.id("researchSessions"), requestId: v.string(), modelId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const owner = await ctx.runQuery(internal.documents.sessionOwner, {
      sessionId: args.sessionId,
    });
    if (owner !== userId) throw new Error("Session not found.");
    const allowed = (env.GATEWAY_COMPARISON_MODEL_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!allowed.includes(args.modelId)) throw new Error("Model is not permitted for comparison.");
    const requests = await ai.requests.list(ctx, { userId, limit: 100 });
    const original = requests.find((request) => request._id === args.requestId);
    if (!original) throw new Error("Request not found or no longer retained.");
    const reservationId = await ctx.runMutation(internal.budget.reserve, {
      sessionId: args.sessionId,
      feature: "chat",
      modelId: args.modelId,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000,
    });
    try {
      const started = Date.now();
      const result = await ai.requests.rerun(ctx, {
        requestId: args.requestId,
        model: args.modelId,
      });
      await ctx.runMutation(internal.budget.settle, {
        reservationId,
        inputTokens: tokenCount(result.promptTokens),
        outputTokens: tokenCount(result.completionTokens),
        failed: !tokenCount(result.promptTokens),
      });
      return {
        originalRequestId: args.requestId,
        comparisonRequestId: result.requestId,
        modelId: args.modelId,
        text: result.text,
        costUsd: result.costNanos / 1e9,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      await ctx.runMutation(internal.budget.settle, {
        reservationId,
        inputTokens: 0,
        outputTokens: 0,
        failed: true,
      });
      throw error;
    }
  },
});
