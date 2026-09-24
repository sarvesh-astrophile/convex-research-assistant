import {
  start,
  vWorkflowId,
  vResultValidator,
  cancel,
  restart,
  type WorkflowId,
} from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireUserId } from "./authHelpers";
import { env } from "./_generated/server";

const active = new Set(["pending", "planning", "researching", "writing", "verifying"]);

export async function beginResearch(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"researchSessions">;
    threadId: string;
    userId: string;
    promptMessageId: string;
    question: string;
  },
) {
  const modelId = env.GATEWAY_MODEL_ID;
  if (!modelId) throw new Error("GATEWAY_MODEL_ID is required.");
  const ongoing = await ctx.db
    .query("researchRuns")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
    .order("desc")
    .take(1);
  if (ongoing.some((run) => active.has(run.status)))
    throw new Error("A research run is already active.");
  const now = Date.now();
  const runId = await ctx.db.insert("researchRuns", {
    ...args,
    modelId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  const workflowId = await start(
    ctx,
    internal.researchFlow.run,
    { runId },
    {
      onComplete: internal.research.complete,
      context: { runId },
      startAsync: true,
    },
  );
  await ctx.db.patch("researchRuns", runId, { workflowId });
  return runId;
}

export const list = query({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found.");
    return await ctx.db
      .query("researchRuns")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(20);
  },
});

export const artifacts = query({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }) => {
    const userId = await requireUserId(ctx);
    const run = await ctx.db.get("researchRuns", runId);
    if (!run || run.userId !== userId) throw new Error("Research run not found.");
    return await ctx.db
      .query("researchArtifacts")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .take(20);
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("researchRuns", runId);
    if (!run || !active.has(run.status)) throw new Error("Research run is no longer active.");
    return run;
  },
});

export const internalArtifacts = internalQuery({
  args: {
    runId: v.id("researchRuns"),
    kind: v.union(
      v.literal("plan"),
      v.literal("finding"),
      v.literal("draft"),
      v.literal("critique"),
    ),
  },
  handler: async (ctx, { runId, kind }) =>
    await ctx.db
      .query("researchArtifacts")
      .withIndex("by_runId_and_kind", (q) => q.eq("runId", runId).eq("kind", kind))
      .take(10),
});

export const linkSources = internalMutation({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("researchRuns", runId);
    if (!run) throw new Error("Research run not found.");
    const sources = await ctx.db
      .query("sources")
      .withIndex("by_sessionId_and_promptMessageId", (q) =>
        q.eq("sessionId", run.sessionId).eq("promptMessageId", run.promptMessageId),
      )
      .take(30);
    for (const source of sources) await ctx.db.patch("sources", source._id, { runId });
  },
});

const runStatus = v.union(
  v.literal("planning"),
  v.literal("researching"),
  v.literal("writing"),
  v.literal("verifying"),
);
export const advance = internalMutation({
  args: { runId: v.id("researchRuns"), status: runStatus },
  handler: async (ctx, { runId, status }) => {
    const run = await ctx.db.get("researchRuns", runId);
    if (!run || !active.has(run.status)) throw new Error("Research run is no longer active.");
    await ctx.db.patch("researchRuns", runId, { status, updatedAt: Date.now() });
  },
});

export const addArtifact = internalMutation({
  args: {
    runId: v.id("researchRuns"),
    kind: v.union(
      v.literal("plan"),
      v.literal("finding"),
      v.literal("draft"),
      v.literal("critique"),
    ),
    payload: v.any(),
  },
  handler: async (ctx, { runId, kind, payload }) => {
    const run = await ctx.db.get("researchRuns", runId);
    if (!run || !active.has(run.status)) throw new Error("Research run is no longer active.");
    return await ctx.db.insert("researchArtifacts", {
      runId,
      sessionId: run.sessionId,
      kind,
      payload,
      createdAt: Date.now(),
    });
  },
});

export const complete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ runId: v.id("researchRuns") }),
  },
  handler: async (ctx, { result, context }) => {
    const run = await ctx.db.get("researchRuns", context.runId);
    if (!run || run.status === "cancelled") return;
    const session = await ctx.db.get("researchSessions", run.sessionId);
    if (!session) return;
    const status =
      result.kind === "success" ? "completed" : result.kind === "canceled" ? "cancelled" : "failed";
    await ctx.db.patch("researchRuns", run._id, {
      status,
      updatedAt: Date.now(),
      error: result.kind === "failed" ? result.error.slice(0, 500) : undefined,
    });
    await ctx.db.patch("researchSessions", run.sessionId, {
      status,
      updatedAt: Date.now(),
    });
  },
});

export const cancelRun = mutation({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }) => {
    const userId = await requireUserId(ctx);
    const run = await ctx.db.get("researchRuns", runId);
    if (!run || run.userId !== userId || !run.workflowId)
      throw new Error("Research run not found.");
    if (!active.has(run.status)) return;
    await cancel(ctx, components.workflow, run.workflowId as WorkflowId);
    await ctx.db.patch("researchRuns", runId, { status: "cancelled", updatedAt: Date.now() });
    await ctx.db.patch("researchSessions", run.sessionId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
  },
});

export const retryRun = mutation({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }) => {
    const userId = await requireUserId(ctx);
    const run = await ctx.db.get("researchRuns", runId);
    if (!run || run.userId !== userId || run.status !== "failed" || !run.workflowId)
      throw new Error("No failed workflow to retry.");
    const session = await ctx.db.get("researchSessions", run.sessionId);
    if (!session || session.status === "running") throw new Error("Another run is already active.");
    await ctx.db.patch("researchRuns", runId, {
      status: "pending",
      error: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("researchSessions", run.sessionId, {
      status: "running",
      updatedAt: Date.now(),
    });
    await restart(ctx, components.workflow, run.workflowId as WorkflowId, { startAsync: true });
  },
});
