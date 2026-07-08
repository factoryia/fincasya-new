import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

type TemporalMessage = {
  enabled: boolean;
  content: string;
  validUntil?: number;
};

function emptyToUndefined(n: number | null | undefined): number | undefined {
  if (n == null) return undefined;
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function normalizeContent(content: string): string {
  return String(content ?? "").trim();
}

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const row = await ctx.db
      .query("whatsappTemporalMessage")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .unique();

    const enabled = Boolean(row?.enabled);
    const content = normalizeContent(row?.content ?? "");
    const validUntil = row?.validUntil;

    const withinValidity =
      !enabled
        ? false
        : validUntil == null || !Number.isFinite(validUntil)
          ? true
          : now <= validUntil;

    const active = withinValidity && content.length > 0;

    return {
      active,
      enabled,
      content,
      validUntil: validUntil == null ? null : validUntil,
      updatedAt: row?.updatedAt ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
    };
  },
});

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("whatsappTemporalMessage")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .unique();

    return {
      enabled: Boolean(row?.enabled),
      content: normalizeContent(row?.content ?? ""),
      validUntil: row?.validUntil == null ? null : row?.validUntil,
      updatedAt: row?.updatedAt ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
    };
  },
});

export const upsert = mutation({
  args: {
    enabled: v.boolean(),
    content: v.string(),
    validUntil: v.optional(v.number()),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const content = normalizeContent(args.content);
    if (args.enabled && content.length === 0) {
      throw new Error("El contenido del mensaje temporal es obligatorio cuando está habilitado.");
    }

    const validUntil = emptyToUndefined(args.validUntil);

    const existing = await ctx.db
      .query("whatsappTemporalMessage")
      .withIndex("by_scope", (q) => q.eq("scope", "global"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        content,
        ...(validUntil !== undefined ? { validUntil } : { validUntil: undefined }),
        updatedAt: now,
        updatedByUserId: args.updatedByUserId,
      });
      return existing._id;
    }

    const doc: TemporalMessage & {
      scope: "global";
      updatedAt: number;
      updatedByUserId?: string;
    } = {
      scope: "global",
      enabled: args.enabled,
      content,
      ...(validUntil !== undefined ? { validUntil } : {}),
      updatedAt: now,
      updatedByUserId: args.updatedByUserId,
    };

    return await ctx.db.insert("whatsappTemporalMessage", doc as any);
  },
});

