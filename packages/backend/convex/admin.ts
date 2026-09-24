import { v } from "convex/values";
import { env, mutation, query } from "./_generated/server";
import { nanosForUsd, periodAt } from "./budgetLogic";
import { monthlyCapNanos } from "./budget";
import { ai } from "./budget";

async function requireAdmin(ctx: {
  auth: { getUserIdentity(): Promise<{ email?: string; tokenIdentifier: string } | null> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!env.ADMIN_EMAIL || identity?.email?.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase())
    throw new Error("Admin access required.");
  return identity.tokenIdentifier;
}

export const overview = query({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    await requireAdmin(ctx);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Invalid UTC month.");
    const accounts = await ctx.db
      .query("budgetAccounts")
      .withIndex("by_period", (q) => q.eq("period", period))
      .take(100);
    return { period, defaultCapUsd: monthlyCapNanos() / 1e9, accounts };
  },
});

export const increase = mutation({
  args: { userId: v.string(), amountUsd: v.number(), note: v.string() },
  handler: async (ctx, args) => {
    const grantedBy = await requireAdmin(ctx);
    if (
      !args.userId ||
      args.note.trim().length < 3 ||
      args.amountUsd <= 0 ||
      args.amountUsd > 100 ||
      !Number.isFinite(args.amountUsd)
    )
      throw new Error("Provide a user, an amount up to $100, and a reason.");
    const period = periodAt(Date.now());
    let account = await ctx.db
      .query("budgetAccounts")
      .withIndex("by_userId_and_period", (q) => q.eq("userId", args.userId).eq("period", period))
      .unique();
    if (!account) {
      const id = await ctx.db.insert("budgetAccounts", {
        userId: args.userId,
        period,
        spentNanos: 0,
        reservedNanos: 0,
        increaseNanos: 0,
      });
      account = (await ctx.db.get("budgetAccounts", id))!;
    }
    await ctx.db.patch("budgetAccounts", account._id, {
      increaseNanos: account.increaseNanos + nanosForUsd(args.amountUsd),
    });
    await ctx.db.insert("budgetIncreases", {
      userId: args.userId,
      period,
      amountUsd: args.amountUsd,
      grantedBy,
      note: args.note.trim(),
      createdAt: Date.now(),
    });
  },
});

export const setAuditRetention = mutation({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    await requireAdmin(ctx);
    if (!Number.isInteger(days) || days < 1 || days > 30)
      throw new Error("Retention must be 1–30 days.");
    await ai.global.setRetention(ctx, { retentionMs: days * 24 * 60 * 60 * 1000 });
  },
});
