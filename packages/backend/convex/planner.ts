import { z } from "zod";

export function parsePlan(text: string, maxTasks: number) {
  const schema = z.object({
    tasks: z.array(z.string().trim().min(2).max(500)).min(1).max(maxTasks),
  });
  return schema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""))).tasks;
}
