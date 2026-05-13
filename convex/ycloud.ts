import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import { transcribeAudio } from "./lib/transcription";
import { sendCatalogToYcloud, sendTextToYcloud } from "./lib/ycloud/senders";
import { getOrCreateConversationForContact } from "./lib/ycloud/session";
import { processInboundMessageV2 } from "./lib/ycloud/inbound";
import { extractContractDataFromHistory } from "./lib/ycloud/contracts";

export const recordProcessedEvent = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ycloudProcessedEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) return { duplicate: true };
    await ctx.db.insert("ycloudProcessedEvents", { eventId: args.eventId });
    return { duplicate: false };
  },
});

export const getOrCreateContact = internalMutation({
  args: { phone: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    return ctx.db.insert("contacts", {
      phone: args.phone,
      name: args.name || args.phone,
      crmType: "lead",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getOrCreateConversation = internalMutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => getOrCreateConversationForContact(ctx, args.contactId),
});

export const markOutboundAsHuman = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (!contact) return;
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .order("desc")
      .first();
    if (conv && (conv.status === "ai" || conv.status === "human")) {
      await ctx.db.patch(conv._id, { status: "human", attended: false });
    }
  },
});

export const sendWhatsAppMessage = internalAction({
  args: {
    to: v.string(),
    text: v.string(),
    wamid: v.optional(v.string()),
    sendDirectly: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => sendTextToYcloud(args),
});

export const recordCatalogOutboundWamids = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    entries: v.array(
      v.object({
        wamid: v.string(),
        productRetailerId: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const e of args.entries) {
      const w = e.wamid.trim();
      const rid = e.productRetailerId.trim();
      if (w.length < 8 || !rid) continue;
      const existing = await ctx.db
        .query("ycloudCatalogMessageWamids")
        .withIndex("by_wamid", (q) => q.eq("wamid", w))
        .first();
      if (existing) continue;
      await ctx.db.insert("ycloudCatalogMessageWamids", {
        conversationId: args.conversationId,
        wamid: w,
        productRetailerId: rid,
        createdAt: now,
      });
    }
  },
});

export const getCatalogProductByOutboundWamid = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    wamid: v.string(),
  },
  handler: async (ctx, args) => {
    const w = args.wamid.trim();
    if (w.length < 8) return null;
    const row = await ctx.db
      .query("ycloudCatalogMessageWamids")
      .withIndex("by_wamid", (q) => q.eq("wamid", w))
      .first();
    if (!row || row.conversationId !== args.conversationId) return null;
    return { productRetailerId: row.productRetailerId };
  },
});

export const sendWhatsAppCatalogList = internalAction({
  args: {
    to: v.string(),
    productRetailerIds: v.array(v.string()),
    productQuoteLines: v.optional(v.array(v.string())),
    bodyText: v.optional(v.string()),
    catalogId: v.optional(v.string()),
    wamid: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const rows = await sendCatalogToYcloud(args);
    const withWamid = rows.filter((r) => (r.wamid ?? "").length > 8);
    if (args.conversationId && withWamid.length > 0) {
      await ctx.runMutation(internal.ycloud.recordCatalogOutboundWamids, {
        conversationId: args.conversationId,
        entries: withWamid.map((r) => ({
          wamid: r.wamid as string,
          productRetailerId: r.productRetailerId,
        })),
      });
    }
    return rows;
  },
});

export const processInboundMessage = internalAction({
  args: {
    eventId: v.string(),
    phone: v.string(),
    name: v.string(),
    text: v.string(),
    wamid: v.optional(v.string()),
    replyToWamid: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("text"),
        v.literal("image"),
        v.literal("audio"),
        v.literal("video"),
        v.literal("document"),
      ),
    ),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { runBotTurn } = await import("./lib/bot/index");
    await processInboundMessageV2(ctx, args, {
      internal,
      api,
      transcribeAudio,
      runBotTurn,
    });
  },
});

export const extractContractData = action({
  args: {
    conversationId: v.id("conversations"),
    forceFresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    const messages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 30,
    });
    const fullHistory = (messages as Array<{ sender?: string; content?: string }>)
      .map((m) => {
        const role =
          m.sender === "assistant"
            ? "Asesor"
            : m.sender === "system"
              ? "Sistema"
              : "Cliente";
        return `${role}: ${m.content ?? ""}`;
      })
      .join("\n");
    return extractContractDataFromHistory(fullHistory);
  },
});
