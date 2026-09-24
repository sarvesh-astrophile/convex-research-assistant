import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";
import { ai } from "./budget";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);
// The built-in budget dashboard is gated by the AI_BUDGET_DASHBOARD_TOKEN
// deployment variable. Without it, the route returns 401.
ai.registerRoutes(http);

export default http;
