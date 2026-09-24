import { expect, test } from "vitest";
import { canReserve, estimateNanos, nanosForUsd, periodAt } from "./budgetLogic";
import { chunkPages } from "./chunking";
import { reciprocalRankFusion } from "./retrievalRank";
import { parsePlan } from "./planner";

test("monthly UTC period changes at midnight on the first", () => {
  expect(periodAt(Date.parse("2026-09-30T23:59:59Z"))).toBe("2026-09");
  expect(periodAt(Date.parse("2026-10-01T00:00:00Z"))).toBe("2026-10");
});

test("reservation counts in-flight usage and admits an exact-cap request", () => {
  const cap = nanosForUsd(1);
  const hold = estimateNanos(10_000, 1_000, { input: 0.25, output: 2 });
  expect(
    canReserve({ spentNanos: cap - 2 * hold, reservedNanos: hold, increaseNanos: 0 }, cap, hold),
  ).toBe(true);
  expect(
    canReserve({ spentNanos: cap - hold, reservedNanos: hold, increaseNanos: 0 }, cap, hold),
  ).toBe(false);
});

test("overlapping chunks retain the words and their source pages", () => {
  const chunks = chunkPages([
    Array.from({ length: 400 }, (_, i) => `p1-${i}`).join(" "),
    Array.from({ length: 100 }, (_, i) => `p2-${i}`).join(" "),
  ]);
  expect(chunks).toHaveLength(2);
  expect(chunks[0].pageStart).toBe(1);
  expect(chunks[0].pageEnd).toBe(2);
  expect(chunks[1].pageStart).toBe(1);
  expect(chunks[1].pageEnd).toBe(2);
  expect(chunks[0].text).toContain("p1-380");
  expect(chunks[1].text).toContain("p1-380");
});

test("hybrid retrieval rewards a result present in both lists", () => {
  expect(
    reciprocalRankFusion(
      [
        ["keyword-only", "shared"],
        ["shared", "semantic-only"],
      ],
      3,
    ),
  ).toEqual(["shared", "keyword-only", "semantic-only"]);
});

test("planner caps sub-tasks and trims valid tasks", () => {
  expect(parsePlan('{"tasks":[" first task ","second task"]}', 3)).toEqual([
    "first task",
    "second task",
  ]);
  expect(() => parsePlan('{"tasks":["one","two","three","four"]}', 3)).toThrow();
});
