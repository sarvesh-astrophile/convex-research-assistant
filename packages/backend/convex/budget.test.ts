/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

test("two simultaneous holds cannot both enter a monthly budget", async () => {
  vi.stubEnv("BUDGET_MONTHLY_USD_DEFAULT", "0.30");
  const t = convexTest(schema, modules);
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("researchSessions", {
      userId: "test-user",
      threadId: "test-thread",
      mode: "chat",
      title: "test",
      titleEdited: false,
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const attempt = () =>
    t.mutation(internal.budget.reserve, {
      sessionId,
      feature: "chat",
      modelId: "openai/gpt-5-mini",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 0,
    });
  const results = await Promise.allSettled([attempt(), attempt()]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const reservations = await t.run(async (ctx) => ctx.db.query("budgetReservations").take(2));
  expect(reservations).toHaveLength(1);
  const [reservation] = reservations;
  await t.mutation(internal.budget.settle, {
    reservationId: reservation._id,
    inputTokens: 1_000_000,
    outputTokens: 0,
  });
  await t.mutation(internal.budget.settle, {
    reservationId: reservation._id,
    inputTokens: 1_000_000,
    outputTokens: 0,
  });
  const accounts = await t.run(async (ctx) => ctx.db.query("budgetAccounts").take(2));
  expect(accounts).toHaveLength(1);
  expect(accounts[0].reservedNanos).toBe(0);
  expect(accounts[0].spentNanos).toBe(250_000_000);
  const ledger = await t.run(async (ctx) => ctx.db.query("usageLedger").take(2));
  expect(ledger).toHaveLength(1);
  const alerts = await t.run(async (ctx) => ctx.db.query("budgetAlerts").take(5));
  expect(alerts.map((alert) => alert.threshold)).toEqual([0.8]);
});

test("an exhausted budget blocks before a fake model is invoked", async () => {
  vi.stubEnv("BUDGET_MONTHLY_USD_DEFAULT", "0.01");
  const t = convexTest(schema, modules);
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("researchSessions", {
      userId: "another-user",
      threadId: "another-thread",
      mode: "chat",
      title: "test",
      titleEdited: false,
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const fakeModel = vi.fn(async () => ({ inputTokens: 10, outputTokens: 10 }));
  await expect(
    (async () => {
      await t.mutation(internal.budget.reserve, {
        sessionId,
        feature: "chat",
        modelId: "openai/gpt-5-mini",
        maxInputTokens: 1_000_000,
        maxOutputTokens: 0,
      });
      await fakeModel();
    })(),
  ).rejects.toThrow("Monthly budget exhausted");
  expect(fakeModel).not.toHaveBeenCalled();
});

test("a research run records ordered progress and artifacts without chat messages", async () => {
  const t = convexTest(schema, modules);
  const { runId } = await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("researchSessions", {
      userId: "researcher",
      threadId: "shared-thread",
      mode: "research",
      title: "report",
      titleEdited: false,
      status: "running",
      createdAt: 1,
      updatedAt: 1,
    });
    const runId = await ctx.db.insert("researchRuns", {
      sessionId,
      userId: "researcher",
      threadId: "shared-thread",
      question: "compare A and B",
      promptMessageId: "prompt",
      status: "pending",
      modelId: "openai/gpt-5-mini",
      createdAt: 1,
      updatedAt: 1,
    });
    return { runId };
  });
  await t.mutation(internal.research.advance, { runId, status: "planning" });
  await t.mutation(internal.research.addArtifact, {
    runId,
    kind: "plan",
    payload: { tasks: ["Compare A", "Compare B"] },
  });
  await t.mutation(internal.research.advance, { runId, status: "researching" });
  const result = await t.run(async (ctx) => ({
    run: await ctx.db.get("researchRuns", runId),
    artifacts: await ctx.db
      .query("researchArtifacts")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .take(10),
  }));
  expect(result.run?.status).toBe("researching");
  expect(result.artifacts).toHaveLength(1);
  expect(result.artifacts[0].kind).toBe("plan");
});
