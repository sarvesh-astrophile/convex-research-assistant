import { Agent } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ai } from "./budget";
import { tokenCount } from "./budgetLogic";
import { parsePlan } from "./planner";
import { searchDocuments } from "./retrieval";
import { searchProvider } from "./searchProvider";

const maxTasks = Math.min(3, Math.max(1, Number(env.RESEARCH_MAX_TASKS || 3)));

function role(
  ctx: ActionCtx,
  run: Doc<"researchRuns">,
  name: string,
  instructions: string,
  feature: string,
) {
  return new Agent(components.agent, {
    name,
    languageModel: ai.languageModel(ctx, {
      userId: run.userId,
      model: run.modelId,
      action: feature,
    }) as ReturnType<typeof convexGateway>,
    instructions,
  });
}

async function generateRole(
  ctx: ActionCtx,
  run: Doc<"researchRuns">,
  feature: "plan" | "research" | "fact_check",
  name: string,
  instructions: string,
  prompt: string,
  maxOutputTokens: number,
) {
  const reservationId = await ctx.runMutation(internal.budget.reserve, {
    sessionId: run.sessionId,
    runId: run._id,
    feature,
    modelId: run.modelId,
    maxInputTokens: 1_000_000,
    maxOutputTokens,
  });
  try {
    const response = await role(ctx, run, name, instructions, feature).generateText(
      ctx,
      { userId: run.userId },
      { prompt, maxOutputTokens },
    );
    await ctx.runMutation(internal.budget.settle, {
      reservationId,
      inputTokens: tokenCount(response.usage.inputTokens),
      outputTokens: tokenCount(response.usage.outputTokens),
      failed: !tokenCount(response.usage.inputTokens),
    });
    return response.text;
  } catch (error) {
    await ctx.runMutation(internal.budget.settle, {
      reservationId,
      inputTokens: 0,
      outputTokens: 0,
      failed: true,
    });
    throw error;
  }
}

export const plan = internalAction({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }): Promise<string[]> => {
    const run = await ctx.runQuery(internal.research.getRun, { runId });
    const existing = await ctx.runQuery(internal.research.internalArtifacts, {
      runId,
      kind: "plan",
    });
    if (existing.length) return parsePlan(JSON.stringify(existing[0].payload), maxTasks);
    const text = await generateRole(
      ctx,
      run,
      "plan",
      "Planner",
      `Decompose the question into at most ${maxTasks} independent research tasks. Return ONLY JSON in the form {"tasks":["..."]}. No commentary.`,
      run.question,
      500,
    );
    const tasks = parsePlan(text, maxTasks);
    await ctx.runMutation(internal.research.addArtifact, {
      runId,
      kind: "plan",
      payload: { tasks },
    });
    return tasks;
  },
});

export const research = internalAction({
  args: { runId: v.id("researchRuns"), task: v.string() },
  handler: async (ctx, { runId, task }): Promise<void> => {
    const run = await ctx.runQuery(internal.research.getRun, { runId });
    const previous = await ctx.runQuery(internal.research.internalArtifacts, {
      runId,
      kind: "finding",
    });
    if (
      previous.some(
        (artifact) => typeof artifact.payload === "object" && artifact.payload?.task === task,
      )
    )
      return;
    const usageId = await ctx.runMutation(internal.search.reserveSearch, {
      sessionId: run.sessionId,
      promptMessageId: run.promptMessageId,
      runId,
    });
    const web = await searchProvider.search(ctx, task);
    const webSources = await ctx.runMutation(internal.search.saveSearch, {
      sessionId: run.sessionId,
      promptMessageId: run.promptMessageId,
      usageId,
      costUsd: web.costUsd,
      results: web.results,
    });
    const pdfSources = await searchDocuments(ctx, {
      sessionId: run.sessionId,
      promptMessageId: run.promptMessageId,
      query: task,
    });
    const evidence = JSON.stringify({ web: webSources, pdf: pdfSources });
    const finding = await generateRole(
      ctx,
      run,
      "research",
      "Researcher",
      "Summarize only supplied evidence. Cite sources using their [n] indexes; acknowledge missing evidence. Do not invent sources.",
      `Research task: ${task}\nEvidence: ${evidence}`,
      1200,
    );
    await ctx.runMutation(internal.research.addArtifact, {
      runId,
      kind: "finding",
      payload: { task, text: finding },
    });
  },
});

export const write = internalAction({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }): Promise<void> => {
    const run = await ctx.runQuery(internal.research.getRun, { runId });
    const previous = await ctx.runQuery(internal.research.internalArtifacts, {
      runId,
      kind: "draft",
    });
    if (previous.length) return;
    await ctx.runMutation(internal.research.linkSources, { runId });
    const findings = await ctx.runQuery(internal.research.internalArtifacts, {
      runId,
      kind: "finding",
    });
    if (!findings.length) throw new Error("No research findings to write from.");
    const maxOutputTokens = Math.min(8000, Number(env.MAX_REPORT_TOKENS || 8000));
    const reservationId = await ctx.runMutation(internal.budget.reserve, {
      sessionId: run.sessionId,
      runId,
      feature: "write",
      modelId: run.modelId,
      maxInputTokens: 1_000_000,
      maxOutputTokens,
    });
    const writer = role(
      ctx,
      run,
      "Writer",
      `Write a report answering the user's question using ONLY these research findings: ${JSON.stringify(findings.map((finding) => finding.payload))}. Use [n] for supported claims, note uncertainty, and do not introduce unlisted sources.`,
      "write",
    );
    try {
      const result = await writer.streamText(
        ctx,
        { threadId: run.threadId },
        { promptMessageId: run.promptMessageId, maxOutputTokens },
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
      const usage = await result.totalUsage;
      await ctx.runMutation(internal.budget.settle, {
        reservationId,
        inputTokens: tokenCount(usage.inputTokens),
        outputTokens: tokenCount(usage.outputTokens),
        failed: !tokenCount(usage.inputTokens),
      });
      await ctx.runMutation(internal.research.addArtifact, {
        runId,
        kind: "draft",
        payload: { text: await result.text },
      });
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

export const verify = internalAction({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, { runId }): Promise<void> => {
    const run = await ctx.runQuery(internal.research.getRun, { runId });
    const previous = await ctx.runQuery(internal.research.internalArtifacts, {
      runId,
      kind: "critique",
    });
    if (previous.length) return;
    const draft = await ctx.runQuery(internal.research.internalArtifacts, { runId, kind: "draft" });
    if (!draft.length) throw new Error("Report draft not found.");
    const findings = await ctx.runQuery(internal.research.internalArtifacts, {
      runId,
      kind: "finding",
    });
    const text = await generateRole(
      ctx,
      run,
      "fact_check",
      "Fact-checker",
      "Check the report against the supplied findings. Identify unsupported or contradictory claims and annotate confidence. One pass only: no new research or rewriting.",
      `Report: ${JSON.stringify(draft[0].payload)}\nFindings: ${JSON.stringify(findings.map((finding) => finding.payload))}`,
      1200,
    );
    await ctx.runMutation(internal.research.addArtifact, {
      runId,
      kind: "critique",
      payload: { text },
    });
  },
});
