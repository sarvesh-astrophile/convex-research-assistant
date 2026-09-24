import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { env } from "./_generated/server";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  chat: {
    kind: "fixed window",
    rate: Number(env.RATE_LIMIT_CHAT_PER_MINUTE || 30),
    period: MINUTE,
  },
  research: {
    kind: "fixed window",
    rate: Number(env.RATE_LIMIT_RESEARCH_PER_HOUR || 10),
    period: HOUR,
  },
});
