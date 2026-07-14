import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

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
    const now = Date.now();

    // Cierra sesiones abiertas anteriores del mismo usuario (evita varios "En línea").
    const openPrev = await ctx.db
      .query("adminSessionLogs")
      .withIndex("by_user_loginAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
    for (const s of openPrev) {
      if (s.logoutAt == null) {
        await ctx.db.patch(s._id, { logoutAt: now });
      }
    }

    return ctx.db.insert("adminSessionLogs", {
      userId: args.userId,
      userEmail: args.userEmail,
      userName: args.userName,
      role: args.role,
      loginAt: now,
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

/**
 * Borra registros del historial de accesos por email (case-insensitive).
 *
 *   bunx convex run adminSessionLogs:deleteByEmails '{"emails":["jamesrgal@gmail.com","codecraft.2005@gmail.com"]}'
 */
export const deleteByEmails = internalMutation({
  args: {
    emails: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const wanted = new Set(
      args.emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    );
    if (wanted.size === 0) return { deleted: 0, byEmail: {} as Record<string, number> };

    const rows = await ctx.db.query("adminSessionLogs").collect();
    const byEmail: Record<string, number> = {};
    let deleted = 0;

    for (const row of rows) {
      const email = (row.userEmail ?? "").trim().toLowerCase();
      if (!wanted.has(email)) continue;
      await ctx.db.delete(row._id);
      deleted += 1;
      byEmail[email] = (byEmail[email] ?? 0) + 1;
    }

    return { deleted, byEmail };
  },
});
