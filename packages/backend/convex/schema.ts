import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const sessionMode = v.union(v.literal("chat"), v.literal("research"));

export const sessionStatus = v.union(
  v.literal("idle"),
  v.literal("running"),
  v.literal("failed"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export default defineSchema({
  researchSessions: defineTable({
    userId: v.string(),
    threadId: v.string(),
    mode: sessionMode,
    title: v.string(),
    titleEdited: v.boolean(),
    status: sessionStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_threadId", ["threadId"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"]),
  sources: defineTable({
    sessionId: v.id("researchSessions"),
    promptMessageId: v.string(),
    index: v.number(),
    kind: v.union(v.literal("web"), v.literal("document")),
    title: v.string(),
    url: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    chunkId: v.optional(v.id("documentChunks")),
    pageStart: v.optional(v.number()),
    pageEnd: v.optional(v.number()),
    snippet: v.string(),
    dedupeKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_promptMessageId", ["promptMessageId"])
    .index("by_sessionId_and_promptMessageId", ["sessionId", "promptMessageId"]),
  toolUsage: defineTable({
    userId: v.string(),
    sessionId: v.id("researchSessions"),
    promptMessageId: v.string(),
    tool: v.string(),
    units: v.number(),
    estimatedCostUsd: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_sessionId_and_promptMessageId", ["sessionId", "promptMessageId"]),
  documents: defineTable({
    sessionId: v.id("researchSessions"),
    userId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    pageCount: v.optional(v.number()),
    status: v.union(
      v.literal("extracting"),
      v.literal("embedding"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_storageId", ["storageId"])
    .index("by_userId", ["userId"]),
  documentChunks: defineTable({
    documentId: v.id("documents"),
    sessionId: v.id("researchSessions"),
    userId: v.string(),
    chunkIndex: v.number(),
    text: v.string(),
    tokenCount: v.number(),
    pageStart: v.number(),
    pageEnd: v.number(),
    embedding: v.array(v.float64()),
    createdAt: v.number(),
  })
    .index("by_documentId", ["documentId"])
    .index("by_sessionId", ["sessionId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["sessionId"],
    })
    .searchIndex("by_text", { searchField: "text", filterFields: ["sessionId"] }),
  usageLedger: defineTable({
    userId: v.string(),
    sessionId: v.id("researchSessions"),
    feature: v.literal("embedding"),
    modelId: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_feature", ["feature"]),
});
