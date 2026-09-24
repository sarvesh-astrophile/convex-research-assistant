import { createThread } from "@convex-dev/agent";
import { cancel, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { sessionMode } from "./schema";

import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
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
  args: { mode: v.optional(sessionMode) },
  handler: async (ctx, { mode }) => {
    const userId = await requireUserId(ctx);
    const title = mode === "research" ? "New research" : "New chat";
    const threadId = await createThread(ctx, components.agent, { userId, title });
    const now = Date.now();

    return await ctx.db.insert("researchSessions", {
      userId,
      threadId,
      mode: mode ?? "chat",
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

export const rename = mutation({
  args: { sessionId: v.id("researchSessions"), title: v.string() },
  handler: async (ctx, { sessionId, title }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found.");
    const trimmed = title.trim();
    if (trimmed.length < 1 || trimmed.length > 80)
      throw new Error("Title must be 1–80 characters.");
    await ctx.db.patch("researchSessions", sessionId, {
      title: trimmed,
      titleEdited: true,
      updatedAt: Date.now(),
    });
  },
});

async function deleteOwnedSession(ctx: MutationCtx, session: Doc<"researchSessions">) {
  const runs = await ctx.db
    .query("researchRuns")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", session._id))
    .take(100);
  for (const run of runs) {
    if (run.workflowId && !["completed", "failed", "cancelled"].includes(run.status))
      await cancel(ctx, components.workflow, run.workflowId as WorkflowId);
  }
  await ctx.db.delete("researchSessions", session._id);
  await ctx.scheduler.runAfter(0, internal.sessions.cleanup, { sessionId: session._id });
  await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
    threadId: session.threadId,
    limit: 100,
  });
}

export const remove = mutation({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found.");
    await deleteOwnedSession(ctx, session);
  },
});

export const removeOwnedBatch = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const sessions = await ctx.db
      .query("researchSessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(5);
    for (const session of sessions) await deleteOwnedSession(ctx, session);
    return sessions.length;
  },
});

export const cleanup = internalMutation({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    let deleted = 0;
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(30);
    for (const row of chunks) {
      await ctx.db.delete("documentChunks", row._id);
      deleted++;
    }
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(10);
    for (const row of docs) {
      await ctx.storage.delete(row.storageId);
      await ctx.db.delete("documents", row._id);
      deleted++;
    }
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_sessionId_and_promptMessageId", (q) => q.eq("sessionId", sessionId))
      .take(30);
    for (const row of sources) {
      await ctx.db.delete("sources", row._id);
      deleted++;
    }
    const artifacts = await ctx.db
      .query("researchArtifacts")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(30);
    for (const row of artifacts) {
      await ctx.db.delete("researchArtifacts", row._id);
      deleted++;
    }
    const runs = await ctx.db
      .query("researchRuns")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(10);
    for (const row of runs) {
      await ctx.db.delete("researchRuns", row._id);
      deleted++;
    }
    if (deleted) await ctx.scheduler.runAfter(0, internal.sessions.cleanup, { sessionId });
  },
});
