import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "settle abandoned budget reservations",
  { minutes: 5 },
  internal.budget.expireStale,
  {},
);
export default crons;
