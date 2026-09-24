import { ExaClient } from "@exalabs/convex-exa";
import type { ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(ctx: ActionCtx, query: string): Promise<{ results: SearchResult[]; costUsd: number }>;
}

const exa = new ExaClient(components.exa);

export const searchProvider: SearchProvider = {
  async search(ctx, query) {
    const response = await exa.search(ctx, {
      query,
      type: "fast",
      numResults: 5,
      contents: { highlights: { maxCharacters: 1200 } },
    });
    return {
      results: response.results.map((result) => ({
        title: result.title || result.url,
        url: result.url,
        snippet: (result.highlights?.join(" … ") || result.text || "").slice(0, 1600),
      })),
      // Exa reports the billed cost for this request when available.
      costUsd: response.costDollars?.total ?? 0.005,
    };
  },
};
