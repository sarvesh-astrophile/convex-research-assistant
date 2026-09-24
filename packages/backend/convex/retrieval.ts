import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { embed } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { reciprocalRankFusion } from "./retrievalRank";

export const getDocument = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => await ctx.db.get("documents", documentId),
});

export const hasReadyDocuments = internalQuery({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session) throw new Error("Session not found.");
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(10);
    return docs.some((doc) => doc.status === "ready");
  },
});

export const textMatches = internalQuery({
  args: { sessionId: v.id("researchSessions"), query: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("researchSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    const hits = await ctx.db
      .query("documentChunks")
      .withSearchIndex("by_text", (q) =>
        q.search("text", args.query).eq("sessionId", args.sessionId),
      )
      .take(12);
    const ready = [];
    for (const hit of hits) {
      const doc = await ctx.db.get("documents", hit.documentId);
      if (doc?.status === "ready") ready.push(hit._id);
    }
    return ready;
  },
});

export const hydrate = internalQuery({
  args: { sessionId: v.id("researchSessions"), ids: v.array(v.id("documentChunks")) },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("researchSessions", args.sessionId);
    if (!session) throw new Error("Session not found.");
    const result = [];
    for (const id of args.ids.slice(0, 30)) {
      const chunk = await ctx.db.get("documentChunks", id);
      if (!chunk || chunk.sessionId !== args.sessionId) continue;
      const doc = await ctx.db.get("documents", chunk.documentId);
      if (doc?.status === "ready") result.push({ chunk, filename: doc.filename });
    }
    return result;
  },
});

export const recordSources = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    promptMessageId: v.string(),
    ids: v.array(v.id("documentChunks")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get("researchSessions", args.sessionId);
    if (!session || session.status !== "running") throw new Error("Session unavailable.");
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_sessionId_and_promptMessageId", (q) =>
        q.eq("sessionId", args.sessionId).eq("promptMessageId", args.promptMessageId),
      )
      .take(30);
    const results = [];
    for (const id of args.ids.slice(0, 5)) {
      const chunk = await ctx.db.get("documentChunks", id);
      if (!chunk || chunk.sessionId !== session._id) continue;
      const doc = await ctx.db.get("documents", chunk.documentId);
      if (!doc || doc.status !== "ready") continue;
      const dedupeKey = `chunk:${id}`;
      let source = existing.find((item) => item.dedupeKey === dedupeKey);
      if (!source) {
        const index = existing.length + 1;
        const _id = await ctx.db.insert("sources", {
          sessionId: args.sessionId,
          promptMessageId: args.promptMessageId,
          index,
          kind: "document",
          title: doc.filename,
          documentId: doc._id,
          chunkId: id,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          snippet: chunk.text.slice(0, 600),
          dedupeKey,
          createdAt: Date.now(),
        });
        source = (await ctx.db.get("sources", _id))!;
        existing.push(source);
      }
      results.push({
        index: source.index,
        title: source.title,
        pages: `${chunk.pageStart}${chunk.pageEnd === chunk.pageStart ? "" : `–${chunk.pageEnd}`}`,
        excerpt: chunk.text.slice(0, 1200),
      });
    }
    return results;
  },
});

export async function searchDocuments(
  ctx: ActionCtx,
  args: { sessionId: Id<"researchSessions">; promptMessageId: string; query: string },
): Promise<{ index: number; title: string; pages: string; excerpt: string }[]> {
  if (!(await ctx.runQuery(internal.retrieval.hasReadyDocuments, { sessionId: args.sessionId })))
    return [];
  const modelId = env.GATEWAY_EMBEDDING_MODEL || "openai/text-embedding-3-small";
  const reservationId = await ctx.runMutation(internal.budget.reserve, {
    sessionId: args.sessionId,
    feature: "embedding",
    modelId,
    maxInputTokens: args.query.length * 4,
    maxOutputTokens: 0,
  });
  let embedding;
  let textIds;
  try {
    [textIds, embedding] = await Promise.all([
      ctx.runQuery(internal.retrieval.textMatches, {
        sessionId: args.sessionId,
        query: args.query,
      }),
      embed({ model: convexGateway.embeddingModel(modelId), value: args.query }),
    ]);
    await ctx.runMutation(internal.budget.settle, {
      reservationId,
      inputTokens: embedding.usage?.tokens ?? Math.ceil(args.query.split(/\s+/).length * 1.4),
      outputTokens: 0,
      failed: !embedding.usage?.tokens,
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
  if (embedding.embedding.length !== 1536) throw new Error("Unexpected embedding dimensions.");
  const vectorHits = await ctx.vectorSearch("documentChunks", "by_embedding", {
    vector: embedding.embedding,
    limit: 12,
    filter: (q) => q.eq("sessionId", args.sessionId),
  });
  const ids = [...new Set<Id<"documentChunks">>([...textIds, ...vectorHits.map((hit) => hit._id)])];
  const hydrated = await ctx.runQuery(internal.retrieval.hydrate, {
    sessionId: args.sessionId,
    ids,
  });
  const valid = new Set(hydrated.map((entry) => entry.chunk._id));
  const best = reciprocalRankFusion<Id<"documentChunks">>(
    [textIds, vectorHits.map((hit) => hit._id)].map((list) => list.filter((id) => valid.has(id))),
    5,
  );
  return await ctx.runMutation(internal.retrieval.recordSources, {
    sessionId: args.sessionId,
    promptMessageId: args.promptMessageId,
    ids: best,
  });
}
