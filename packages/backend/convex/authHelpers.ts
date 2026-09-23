import type { GenericActionCtx, GenericMutationCtx, GenericQueryCtx } from "convex/server";

import type { DataModel } from "./_generated/dataModel";

type AuthenticatedCtx =
  | GenericQueryCtx<DataModel>
  | GenericMutationCtx<DataModel>
  | GenericActionCtx<DataModel>;

export async function requireUserId(ctx: AuthenticatedCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("You must be signed in to continue.");
  }

  return identity.tokenIdentifier;
}
