import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_/-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("quickReplyTemplates").collect();
    return rows.sort((a, b) => {
      const byOrder = (a.order ?? 9999) - (b.order ?? 9999);
      if (byOrder !== 0) return byOrder;
      return a.title.localeCompare(b.title);
    });
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("quickReplyTemplates")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return rows.sort((a, b) => {
      const byOrder = (a.order ?? 9999) - (b.order ?? 9999);
      if (byOrder !== 0) return byOrder;
      return a.title.localeCompare(b.title);
    });
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    slashCommand: v.string(),
    intentKey: v.string(),
    content: v.optional(v.string()),
    mediaType: v.union(v.literal("text"), v.literal("audio")),
    mediaUrl: v.optional(v.string()),
    language: v.optional(v.string()),
    active: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const slashCommand = normalizeKey(args.slashCommand).replace(/^\//, "");
    const intentKey = normalizeKey(args.intentKey);
    if (!slashCommand) throw new Error("slashCommand es obligatorio");
    if (!intentKey) throw new Error("intentKey es obligatorio");
    if (args.mediaType === "text" && !args.content?.trim()) {
      throw new Error("content es obligatorio para plantillas de texto");
    }
    if (args.mediaType === "audio" && !args.mediaUrl?.trim()) {
      throw new Error("mediaUrl es obligatorio para plantillas de audio");
    }
    return await ctx.db.insert("quickReplyTemplates", {
      title: args.title.trim(),
      slashCommand,
      intentKey,
      content: args.content?.trim(),
      mediaType: args.mediaType,
      mediaUrl: args.mediaUrl?.trim(),
      language: args.language?.trim() || "es",
      active: args.active ?? true,
      order: args.order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("quickReplyTemplates"),
    title: v.optional(v.string()),
    slashCommand: v.optional(v.string()),
    intentKey: v.optional(v.string()),
    content: v.optional(v.string()),
    mediaType: v.optional(v.union(v.literal("text"), v.literal("audio"))),
    mediaUrl: v.optional(v.string()),
    language: v.optional(v.string()),
    active: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Plantilla no encontrada");
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.slashCommand !== undefined) {
      patch.slashCommand = normalizeKey(args.slashCommand).replace(/^\//, "");
    }
    if (args.intentKey !== undefined) patch.intentKey = normalizeKey(args.intentKey);
    if (args.content !== undefined) patch.content = args.content.trim();
    if (args.mediaType !== undefined) patch.mediaType = args.mediaType;
    if (args.mediaUrl !== undefined) patch.mediaUrl = args.mediaUrl.trim();
    if (args.language !== undefined) patch.language = args.language.trim();
    if (args.active !== undefined) patch.active = args.active;
    if (args.order !== undefined) patch.order = args.order;
    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const remove = mutation({
  args: { id: v.id("quickReplyTemplates") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  },
});
