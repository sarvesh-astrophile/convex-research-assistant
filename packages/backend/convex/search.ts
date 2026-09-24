import { v } from "convex/values";
import { env, internalMutation, query } from "./_generated/server";
import { requireUserId } from "./authHelpers";

const MAX_SEARCH_CALLS = Number(env.RESEARCH_MAX_TASKS || 3);

export const listSources = query({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Chat session not found.");
    return await ctx.db
      .query("sources")
      .withIndex("by_sessionId_and_promptMessageId", (q) => q.eq("sessionId", sessionId))
      .take(300);
  },
});

export const reserveSearch = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    promptMessageId: v.string(),
    runId: v.optional(v.id("researchRuns")),
  },
  handler: async (ctx, { sessionId, promptMessageId, runId }) => {
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.status !== "running") throw new Error("Search session is unavailable.");
    const previous = await ctx.db
      .query("toolUsage")
      .withIndex("by_sessionId_and_promptMessageId", (q) =>
        q.eq("sessionId", sessionId).eq("promptMessageId", promptMessageId),
      )
      .take(MAX_SEARCH_CALLS);
    if (previous.length >= MAX_SEARCH_CALLS)
      throw new Error("Search limit reached for this question.");
    return await ctx.db.insert("toolUsage", {
      userId: session.userId,
      sessionId,
      runId,
      promptMessageId,
      tool: "exa.search",
      units: 1,
      estimatedCostUsd: 0,
      createdAt: Date.now(),
    });
  },
});

export const saveSearch = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    promptMessageId: v.string(),
    usageId: v.id("toolUsage"),
    costUsd: v.number(),
    results: v.array(v.object({ title: v.string(), url: v.string(), snippet: v.string() })),
  },
  handler: async (ctx, args) => {
    const usage = await ctx.db.get("toolUsage", args.usageId);
    if (
      !usage ||
      usage.sessionId !== args.sessionId ||
      usage.promptMessageId !== args.promptMessageId
    )
      throw new Error("Search reservation not found.");
    await ctx.db.patch("toolUsage", args.usageId, { estimatedCostUsd: args.costUsd });
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_sessionId_and_promptMessageId", (q) =>
        q.eq("sessionId", args.sessionId).eq("promptMessageId", args.promptMessageId),
      )
      .take(15);
    const citations: { index: number; title: string; url: string | undefined; snippet: string }[] =
      [];
    const known = new Map<string, { index: number; title: string; url?: string; snippet: string }>(
      existing.map((source) => [source.dedupeKey, source]),
    );
    let nextIndex = existing.length + 1;
    for (const result of args.results.slice(0, 5)) {
      let url: URL;
      try {
        url = new URL(result.url);
      } catch {
        continue;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      url.hash = "";
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.startsWith("utm_") || key === "fbclid" || key === "gclid")
          url.searchParams.delete(key);
      }
      const dedupeKey = url.toString();
      const found = known.get(dedupeKey);
      if (found) {
        citations.push({
          index: found.index,
          title: found.title,
          url: found.url,
          snippet: found.snippet,
        });
        continue;
      }
      const index = nextIndex++;
      const source = {
        sessionId: args.sessionId,
        promptMessageId: args.promptMessageId,
        index,
        kind: "web" as const,
        title: result.title.slice(0, 300),
        url: dedupeKey,
        snippet: result.snippet.slice(0, 1600),
        dedupeKey,
        createdAt: Date.now(),
      };
      await ctx.db.insert("sources", source);
      known.set(dedupeKey, source);
      citations.push({ index, title: source.title, url: dedupeKey, snippet: source.snippet });
    }
    return citations;
  },
});
