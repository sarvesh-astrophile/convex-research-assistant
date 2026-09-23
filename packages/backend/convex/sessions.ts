import { createThread } from "@convex-dev/agent";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./authHelpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    return await ctx.db
      .query("researchSessions")
      .withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const title = "New chat";
    const threadId = await createThread(ctx, components.agent, { userId, title });
    const now = Date.now();

    return await ctx.db.insert("researchSessions", {
      userId,
      threadId,
      mode: "chat",
      title,
      titleEdited: false,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);

    return session?.userId === userId ? session : null;
  },
});
