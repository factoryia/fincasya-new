
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getFirstOwner = query({
  args: {},
  handler: async (ctx) => {
    const owner = await ctx.db
      .query("user")
      .filter((q) => q.eq(q.field("role"), "propietario"))
      .first();
    return owner;
  },
});
