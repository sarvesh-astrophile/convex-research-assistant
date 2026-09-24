"use node";

import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { embedMany } from "ai";
import { v } from "convex/values";
import { extractText, getDocumentProxy } from "unpdf";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { chunkPages } from "./chunking";

export const process = internalAction({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    try {
      const doc = await ctx.runQuery(internal.retrieval.getDocument, { documentId });
      if (!doc || doc.status !== "extracting") return;
      const blob = await ctx.storage.get(doc.storageId);
      if (!blob) throw new Error("Uploaded file was not found.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
        throw new Error("Invalid PDF file.");
      const pdf = await getDocumentProxy(bytes);
      const maxPages = Number(env.MAX_PDF_PAGES || 100);
      if (pdf.numPages > maxPages) throw new Error(`PDF exceeds ${maxPages} pages.`);
      const extracted = await extractText(pdf);
      const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
      if (!pages.some((page) => page.trim()))
        throw new Error("No extractable text. Scanned PDFs are not supported.");
      const chunks = chunkPages(pages);
      await ctx.runMutation(internal.documents.updateStatus, {
        documentId,
        status: "embedding",
        pageCount: pdf.numPages,
      });
      const modelId = env.GATEWAY_EMBEDDING_MODEL || "openai/text-embedding-3-small";
      if (Number(env.GATEWAY_EMBEDDING_DIMS || 1536) !== 1536)
        throw new Error("Embedding index requires 1536 dimensions.");
      for (let i = 0; i < chunks.length; i += 8) {
        const batch = chunks.slice(i, i + 8);
        const reservationId = await ctx.runMutation(internal.budget.reserve, {
          sessionId: doc.sessionId,
          feature: "embedding",
          modelId,
          maxInputTokens: batch.reduce((sum, chunk) => sum + chunk.text.length * 4, 0),
          maxOutputTokens: 0,
        });
        try {
          const response = await embedMany({
            model: convexGateway.embeddingModel(modelId),
            values: batch.map((chunk) => chunk.text),
          });
          const tokenCount =
            response.usage?.tokens ?? batch.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
          await ctx.runMutation(internal.documents.saveChunks, {
            documentId,
            modelId,
            tokenCount,
            chunks: batch.map((chunk, index) => {
              const embedding = response.embeddings[index];
              if (!embedding || embedding.length !== 1536)
                throw new Error("Unexpected embedding dimensions.");
              return { ...chunk, embedding };
            }),
          });
          await ctx.runMutation(internal.budget.settle, {
            reservationId,
            inputTokens: tokenCount,
            outputTokens: 0,
            failed: !response.usage?.tokens,
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
      }
      await ctx.runMutation(internal.documents.updateStatus, { documentId, status: "ready" });
    } catch (error) {
      await ctx.runMutation(internal.documents.updateStatus, {
        documentId,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "PDF ingestion failed.",
      });
    }
  },
});
