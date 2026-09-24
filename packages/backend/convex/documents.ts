import { v } from "convex/values";
import { env, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./authHelpers";

const maxDocs = Number(env.MAX_DOCS_PER_THREAD || 10);
const maxBytes = Number(env.MAX_PDF_BYTES || 26214400);

export const list = query({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found.");
    return await ctx.db
      .query("documents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(20);
  },
});

export const readyForResponse = internalQuery({
  args: { sessionId: v.id("researchSessions"), threadId: v.string() },
  handler: async (ctx, { sessionId, threadId }) => {
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.threadId !== threadId) throw new Error("Session not found.");
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(maxDocs);
    return documents
      .filter((document) => document.status === "ready")
      .map(({ filename }) => filename);
  },
});

export const sessionOwner = internalQuery({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session) throw new Error("Session not found.");
    return session.userId;
  },
});

export const uploadUrl = mutation({
  args: { sessionId: v.id("researchSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found.");
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(maxDocs);
    if (docs.length >= maxDocs) throw new Error("Document limit reached for this session.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const attach = mutation({
  args: { sessionId: v.id("researchSessions"), storageId: v.id("_storage"), filename: v.string() },
  handler: async (ctx, { sessionId, storageId, filename }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found.");
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .take(maxDocs);
    if (existing.length >= maxDocs) throw new Error("Document limit reached for this session.");
    const attached = await ctx.db
      .query("documents")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .unique();
    if (attached) throw new Error("PDF has already been attached.");
    const metadata = await ctx.db.system.get("_storage", storageId);
    if (
      !metadata ||
      metadata.size > maxBytes ||
      metadata.size === 0 ||
      metadata.contentType !== "application/pdf" ||
      !filename.toLowerCase().endsWith(".pdf") ||
      filename.length > 255
    ) {
      throw new Error("Upload a PDF smaller than the configured file limit.");
    }
    const documentId = await ctx.db.insert("documents", {
      sessionId,
      userId,
      storageId,
      filename,
      mimeType: "application/pdf",
      sizeBytes: metadata.size,
      status: "extracting",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.ingest.process, { documentId });
    return documentId;
  },
});

export const updateStatus = internalMutation({
  args: {
    documentId: v.id("documents"),
    status: v.union(v.literal("embedding"), v.literal("ready"), v.literal("failed")),
    pageCount: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("documents", args.documentId);
    if (!doc) return null;
    await ctx.db.patch("documents", args.documentId, {
      status: args.status,
      pageCount: args.pageCount ?? doc.pageCount,
      error: args.error,
    });
    return null;
  },
});

export const saveChunks = internalMutation({
  args: {
    documentId: v.id("documents"),
    modelId: v.string(),
    tokenCount: v.number(),
    chunks: v.array(
      v.object({
        chunkIndex: v.number(),
        text: v.string(),
        tokenCount: v.number(),
        pageStart: v.number(),
        pageEnd: v.number(),
        embedding: v.array(v.float64()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("documents", args.documentId);
    if (!doc || doc.status !== "embedding")
      throw new Error("Document is no longer being ingested.");
    for (const chunk of args.chunks) {
      await ctx.db.insert("documentChunks", {
        ...chunk,
        documentId: doc._id,
        sessionId: doc.sessionId,
        userId: doc.userId,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

export const retry = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const userId = await requireUserId(ctx);
    const doc = await ctx.db.get("documents", documentId);
    if (!doc || doc.userId !== userId || doc.status !== "failed")
      throw new Error("Failed PDF not found.");
    await ctx.db.patch("documents", documentId, { error: "Preparing to retry extraction." });
    await ctx.scheduler.runAfter(0, internal.documents.retryCleanup, { documentId });
  },
});

export const retryCleanup = internalMutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get("documents", documentId);
    if (!doc || doc.status !== "failed") return;
    const chunks = await ctx.db
      .query("documentChunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", documentId))
      .take(40);
    for (const chunk of chunks) await ctx.db.delete("documentChunks", chunk._id);
    if (chunks.length)
      await ctx.scheduler.runAfter(0, internal.documents.retryCleanup, { documentId });
    else {
      await ctx.db.patch("documents", documentId, { status: "extracting", error: undefined });
      await ctx.scheduler.runAfter(0, internal.ingest.process, { documentId });
    }
  },
});
