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
});
