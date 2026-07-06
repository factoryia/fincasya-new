import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const recordLogin = mutation({
  args: {
    userId: v.string(),
    userEmail: v.string(),
    userName: v.optional(v.string()),
    role: v.optional(v.string()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("adminSessionLogs", {
      userId: args.userId,
      userEmail: args.userEmail,
      userName: args.userName,
      role: args.role,
      loginAt: Date.now(),
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });
  },
});

export const recordLogout = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("adminSessionLogs")
      .withIndex("by_user_loginAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);

    const open = sessions.find((s) => s.logoutAt == null);
    if (!open) return null;

    const logoutAt = Date.now();
    await ctx.db.patch(open._id, { logoutAt });
    return { id: open._id, logoutAt, loginAt: open.loginAt };
  },
});

export const list = query({
  args: {
    limit: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);

    const rows = args.userId
      ? await ctx.db
          .query("adminSessionLogs")
          .withIndex("by_user_loginAt", (q) => q.eq("userId", args.userId!))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("adminSessionLogs")
          .withIndex("by_loginAt")
          .order("desc")
          .take(limit);

    return rows.map((row) => ({
      ...row,
      durationMs:
        row.logoutAt != null ? row.logoutAt - row.loginAt : Date.now() - row.loginAt,
      isActive: row.logoutAt == null,
    }));
  },
});
