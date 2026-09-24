"use node";

import { convexGateway } from "@convex-dev/ai-sdk-provider";
import { embedMany } from "ai";
import { v } from "convex/values";
import { extractText, getDocumentProxy } from "unpdf";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";

const WORDS_PER_CHUNK = 450;
const OVERLAP = 70;

function chunkPages(pages: string[]) {
  const words = pages.flatMap((text, page) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ word, page: page + 1 })),
  );
  const chunks: {
    chunkIndex: number;
    text: string;
    tokenCount: number;
    pageStart: number;
    pageEnd: number;
  }[] = [];
  for (let start = 0; start < words.length; start += WORDS_PER_CHUNK - OVERLAP) {
    const window = words.slice(start, start + WORDS_PER_CHUNK);
    if (!window.length) break;
    chunks.push({
      chunkIndex: chunks.length,
      text: window.map((entry) => entry.word).join(" "),
      tokenCount: Math.ceil(window.length * 1.4),
      pageStart: window[0].page,
      pageEnd: window[window.length - 1].page,
    });
    if (start + WORDS_PER_CHUNK >= words.length) break;
  }
  return chunks;
}

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
        const response = await embedMany({
          model: convexGateway.embeddingModel(modelId),
          values: batch.map((chunk) => chunk.text),
        });
        await ctx.runMutation(internal.documents.saveChunks, {
          documentId,
          modelId,
          tokenCount:
            response.usage?.tokens ?? batch.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
          chunks: batch.map((chunk, index) => {
            const embedding = response.embeddings[index];
            if (!embedding || embedding.length !== 1536)
              throw new Error("Unexpected embedding dimensions.");
            return { ...chunk, embedding };
          }),
        });
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
