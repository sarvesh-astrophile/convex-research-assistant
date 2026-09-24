import { WorkflowManager } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";

const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 500, base: 2 },
  },
});

export const run = workflow
  .define({ args: { runId: v.id("researchRuns") } })
  .handler(async (step, { runId }): Promise<void> => {
    await step.runMutation(internal.research.advance, { runId, status: "planning" });
    const tasks = await step.runAction(internal.researchSteps.plan, { runId }, { retry: true });
    await step.runMutation(internal.research.advance, { runId, status: "researching" });
    // Every task performs at most one search and one research-generation call.
    await Promise.all(
      tasks.map((task) =>
        step.runAction(internal.researchSteps.research, { runId, task }, { retry: true }),
      ),
    );
    await step.runMutation(internal.research.advance, { runId, status: "writing" });
    await step.runAction(internal.researchSteps.write, { runId }, { retry: false });
    await step.runMutation(internal.research.advance, { runId, status: "verifying" });
    await step.runAction(internal.researchSteps.verify, { runId }, { retry: true });
  });
