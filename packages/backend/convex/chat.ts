import { listUIMessages, saveMessage, syncStreams, vStreamArgs } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { stepCountIs } from "ai";

import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { getAssistantAgent } from "./assistant";
import { requireUserId } from "./authHelpers";

const MAX_PROMPT_LENGTH = 20_000;
const MAX_TITLE_LENGTH = 60;

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db
      .query("researchSessions")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!session || session.userId !== userId) {
      throw new Error("Chat session not found.");
    }

    const [paginated, streams] = await Promise.all([
      listUIMessages(ctx, components.agent, args),
      syncStreams(ctx, components.agent, {
        threadId: args.threadId,
        streamArgs: args.streamArgs,
      }),
    ]);

    return { ...paginated, streams };
  },
});

export const sendMessage = mutation({
  args: {
    sessionId: v.id("researchSessions"),
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { sessionId, threadId, prompt }) => {
    const userId = await requireUserId(ctx);
    const session = await ctx.db.get("researchSessions", sessionId);
    const trimmedPrompt = prompt.trim();

    if (!session || session.userId !== userId || session.threadId !== threadId) {
      throw new Error("Chat session not found.");
    }
    if (!trimmedPrompt) {
      throw new Error("Message cannot be empty.");
    }
    if (session.status === "running") {
      throw new Error("Wait for the current response to finish before sending another message.");
    }
    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Message cannot exceed ${MAX_PROMPT_LENGTH.toLocaleString()} characters.`);
    }

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      userId,
      prompt: trimmedPrompt,
    });
    const now = Date.now();
    const firstMessage = session.title === "New chat" && !session.titleEdited;

    await ctx.db.patch("researchSessions", sessionId, {
      title: firstMessage
        ? trimmedPrompt.slice(0, MAX_TITLE_LENGTH) +
          (trimmedPrompt.length > MAX_TITLE_LENGTH ? "..." : "")
        : session.title,
      status: "running",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.chat.streamResponse, {
      sessionId,
      threadId,
      promptMessageId: messageId,
      prompt: trimmedPrompt,
    });

    return null;
  },
});

export const streamResponse = internalAction({
  args: {
    sessionId: v.id("researchSessions"),
    threadId: v.string(),
    promptMessageId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const readyDocuments = await ctx.runQuery(internal.documents.readyForResponse, {
        sessionId: args.sessionId,
        threadId: args.threadId,
      });
      const refersToDocuments =
        readyDocuments.length > 0 &&
        (/\b(pdf|document|file|upload|guide|manual|handbook|attachment|summari[sz]e)\b/i.test(
          args.prompt,
        ) ||
          readyDocuments.some((name) => {
            const stem = name.replace(/\.pdf$/i, "").trim();
            return stem.length >= 3 && args.prompt.toLowerCase().includes(stem.toLowerCase());
          }));
      const result = await getAssistantAgent(
        args.sessionId,
        args.promptMessageId,
        readyDocuments,
      ).streamText(
        ctx,
        { threadId: args.threadId },
        {
          promptMessageId: args.promptMessageId,
          stopWhen: stepCountIs(4),
          prepareStep: ({ stepNumber }) =>
            stepNumber === 0 && refersToDocuments
              ? { toolChoice: { type: "tool", toolName: "searchDocuments" } }
              : undefined,
        },
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
      await ctx.runMutation(internal.chat.finishResponse, {
        sessionId: args.sessionId,
        status: "completed",
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.finishResponse, {
        sessionId: args.sessionId,
        status: "failed",
      });
      throw error;
    }
  },
});

export const finishResponse = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, { sessionId, status }) => {
    const session = await ctx.db.get("researchSessions", sessionId);
    if (!session) {
      return null;
    }

    await ctx.db.patch("researchSessions", sessionId, {
      status,
      updatedAt: Date.now(),
    });
    return null;
  },
});
