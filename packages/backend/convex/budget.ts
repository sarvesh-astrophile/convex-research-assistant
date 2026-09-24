import { AIBudget } from "@convex-dev/ai-budget";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { estimateNanos, nanosForUsd, periodAt, canReserve } from "./budgetLogic";
import { requireUserId } from "./authHelpers";

export const ai = new AIBudget(components.aiBudget);

export const feature = v.union(
  v.literal("chat"),
  v.literal("plan"),
  v.literal("research"),
  v.literal("write"),
  v.literal("fact_check"),
  v.literal("embedding"),
);

// Fail closed for model IDs whose prices are not explicitly known. Rates are USD per million tokens.
export function modelPrice(modelId: string) {
  if (modelId === "openai/gpt-5-mini") return { input: 0.25, output: 2 };
  if (modelId === "openai/text-embedding-3-small") return { input: 0.02, output: 0 };
  if (env.GATEWAY_MODEL_PRICES_JSON) {
    const prices: unknown = JSON.parse(env.GATEWAY_MODEL_PRICES_JSON);
    if (prices && typeof prices === "object" && !Array.isArray(prices)) {
      const price: unknown = (prices as Record<string, unknown>)[modelId];
      if (price && typeof price === "object") {
        const entry = price as { input?: unknown; output?: unknown };
        if (
          typeof entry.input === "number" &&
          Number.isFinite(entry.input) &&
          entry.input > 0 &&
          typeof entry.output === "number" &&
          Number.isFinite(entry.output) &&
          entry.output >= 0
        ) {
          return { input: entry.input, output: entry.output };
        }
      }
    }
  }
  throw new Error(`Configure pricing for model ${modelId} before using the budget.`);
}

export function monthlyCapNanos() {
  const usd = Number(env.BUDGET_MONTHLY_USD_DEFAULT);
  if (!usd || usd <= 0) throw new Error("BUDGET_MONTHLY_USD_DEFAULT must be a positive number.");
  return nanosForUsd(usd);
}

export const reserve = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    runId: v.optional(v.id("researchRuns")),
    feature,
    modelId: v.string(),
    maxInputTokens: v.number(),
    maxOutputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("researchSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    if (
      !Number.isSafeInteger(args.maxInputTokens) ||
      args.maxInputTokens < 0 ||
      !Number.isSafeInteger(args.maxOutputTokens) ||
      args.maxOutputTokens < 0
    )
      throw new Error("Invalid model token reservation.");
    const cap = monthlyCapNanos();
    const price = modelPrice(args.modelId);
    const estimate = estimateNanos(args.maxInputTokens, args.maxOutputTokens, price);
    const period = periodAt(Date.now());
    let account = await ctx.db
      .query("budgetAccounts")
      .withIndex("by_userId_and_period", (q) => q.eq("userId", session.userId).eq("period", period))
      .unique();
    if (!account) {
      const id = await ctx.db.insert("budgetAccounts", {
        userId: session.userId,
        period,
        spentNanos: 0,
        reservedNanos: 0,
        increaseNanos: 0,
      });
      account = (await ctx.db.get("budgetAccounts", id))!;
    }
    if (!canReserve(account, cap, estimate))
      throw new Error(
        `Monthly budget exhausted for ${period} (cap $${(cap + account.increaseNanos) / 1e9}).`,
      );
    await ctx.db.patch("budgetAccounts", account._id, {
      reservedNanos: account.reservedNanos + estimate,
    });
    return await ctx.db.insert("budgetReservations", {
      accountId: account._id,
      userId: session.userId,
      sessionId: session._id,
      runId: args.runId,
      feature: args.feature,
      modelId: args.modelId,
      reservedNanos: estimate,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const settle = internalMutation({
  args: {
    reservationId: v.id("budgetReservations"),
    inputTokens: v.number(),
    outputTokens: v.number(),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get("budgetReservations", args.reservationId);
    if (!reservation || reservation.status === "settled") return;
    if (
      !Number.isFinite(args.inputTokens) ||
      args.inputTokens < 0 ||
      !Number.isFinite(args.outputTokens) ||
      args.outputTokens < 0
    )
      throw new Error("Invalid model usage.");
    const account = await ctx.db.get("budgetAccounts", reservation.accountId);
    if (!account) throw new Error("Budget account missing.");
    // A failed call may still have reached a provider. Charge its held maximum when usage is unavailable.
    const actual = args.failed
      ? reservation.reservedNanos
      : estimateNanos(args.inputTokens, args.outputTokens, modelPrice(reservation.modelId));
    await ctx.db.patch("budgetAccounts", account._id, {
      reservedNanos: account.reservedNanos - reservation.reservedNanos,
      spentNanos: account.spentNanos + actual,
    });
    await ctx.db.patch("budgetReservations", reservation._id, { status: "settled" });
    await ctx.db.insert("usageLedger", {
      userId: reservation.userId,
      sessionId: reservation.sessionId,
      runId: reservation.runId,
      feature: reservation.feature,
      modelId: reservation.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: actual / 1e9,
      createdAt: Date.now(),
    });
    const thresholds = (env.BUDGET_ALERT_THRESHOLDS || "0.8,1.0").split(",").map(Number);
    for (const threshold of thresholds) {
      if (!(threshold > 0 && threshold <= 1)) continue;
      if (account.spentNanos + actual < (monthlyCapNanos() + account.increaseNanos) * threshold)
        continue;
      const previous = await ctx.db
        .query("budgetAlerts")
        .withIndex("by_userId_and_period_and_threshold", (q) =>
          q.eq("userId", account.userId).eq("period", account.period).eq("threshold", threshold),
        )
        .unique();
      if (!previous)
        await ctx.db.insert("budgetAlerts", {
          userId: account.userId,
          period: account.period,
          threshold,
          firedAt: Date.now(),
        });
    }
  },
});

export const myBudget = query({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    const userId = await requireUserId(ctx);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Invalid UTC month.");
    const account = await ctx.db
      .query("budgetAccounts")
      .withIndex("by_userId_and_period", (q) => q.eq("userId", userId).eq("period", period))
      .unique();
    return {
      period,
      capUsd: monthlyCapNanos() / 1e9,
      spentUsd: (account?.spentNanos ?? 0) / 1e9,
      reservedUsd: (account?.reservedNanos ?? 0) / 1e9,
      increaseUsd: (account?.increaseNanos ?? 0) / 1e9,
    };
  },
});

export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("budgetReservations")
      .withIndex("by_status_and_createdAt", (q) =>
        q.eq("status", "open").lt("createdAt", Date.now() - 15 * 60_000),
      )
      .take(20);
    for (const reservation of stale)
      await ctx.runMutation(internal.budget.settle, {
        reservationId: reservation._id,
        inputTokens: 0,
        outputTokens: 0,
        failed: true,
      });
  },
});
