import { Agent } from "@convex-dev/agent";
import { convexGateway } from "@convex-dev/ai-sdk-provider";

import { components } from "./_generated/api";
import { env } from "./_generated/server";

export function getAssistantAgent() {
  const modelId = env.GATEWAY_MODEL_ID;
  if (!modelId) {
    throw new Error("GATEWAY_MODEL_ID is not configured for this Convex deployment.");
  }

  return new Agent(components.agent, {
    name: "Research Assistant",
    languageModel: convexGateway(modelId),
    instructions:
      "You are a careful research assistant. Give clear, accurate answers and say when you are uncertain. Do not claim to have searched the web or read documents unless tools supplied that information.",
  });
}
