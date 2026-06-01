import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { transcribeAudio } from "./lib/transcription";
import { classifyContractImage } from "./lib/imageClassifier";
import { sendCatalogToYcloud, sendTextToYcloud } from "./lib/ycloud/senders";
import { getOrCreateConversationForContact } from "./lib/ycloud/session";
import { processInboundMessageV2 } from "./lib/ycloud/inbound";
import { extractContractDataFromHistory } from "./lib/ycloud/contracts";
import {
  normalizeWhatsappPhone,
  type YcloudMessageMediaType,
} from "./lib/ycloud/parseMessage";

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

const INBOUND_WEBHOOK_METADATA = { source: "ycloud_inbound_webhook" as const };

/**
 * Guarda el mensaje del cliente en inbox antes del bot (action).
 * Si el action falla o tarda, el mensaje ya queda visible para operadores.
 */
export const persistInboundFromWebhook = internalMutation({
  args: {
    phone: v.string(),
    customerName: v.optional(v.string()),
    content: v.string(),
    messageType: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("audio"),
      v.literal("video"),
      v.literal("document"),
      v.literal("product"),
    ),
    mediaUrl: v.optional(v.string()),
    wamid: v.optional(v.string()),
    replyToWamid: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: false; reason: "empty" }
    | { ok: true; skipped: true; messageId: Id<"messages"> }
    | {
        ok: true;
        messageId: Id<"messages">;
        conversationId: Id<"conversations">;
      }
  > => {
    const phone = normalizeWhatsappPhone(args.phone);
    const content = String(args.content ?? "").trim();
    if (!phone || !content) {
      return { ok: false as const, reason: "empty" as const };
    }

    const wamid = String(args.wamid ?? "").trim();
    if (wamid.length > 6) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
        .first();
      if (existing) {
        return {
          ok: true as const,
          skipped: true as const,
          messageId: existing._id,
        };
      }
    }

    const displayName = displayNameForContact(
      phone,
      String(args.customerName ?? "").trim() || phone,
    );
    const existingContact = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
    const now = Date.now();
    const contactId: Id<"contacts"> = existingContact
      ? existingContact._id
      : await ctx.db.insert("contacts", {
          phone,
          name: displayName,
          crmType: "lead",
          createdAt: now,
          updatedAt: now,
        });
    const { conversationId } = await getOrCreateConversationForContact(
      ctx,
      contactId,
      "whatsapp",
    );

    const replyToWamid = String(args.replyToWamid ?? "").trim();
    const metadata: Record<string, string> = { ...INBOUND_WEBHOOK_METADATA };
    if (replyToWamid) metadata.replyToWamid = replyToWamid;

    const messageId: Id<"messages"> = await ctx.runMutation(
      internal.messages.insertUserMessage,
      {
        conversationId,
        content,
        createdAt: now,
        type: args.messageType,
        mediaUrl: args.mediaUrl,
        metadata,
        wamid: wamid.length > 6 ? wamid : undefined,
      },
    );

    return { ok: true as const, messageId, conversationId };
  },
});

function isGenericWebContactName(name: string): boolean {
  const n = name.trim();
  return (
    !n ||
    n === "Visitante web" ||
    n === "Visitante" ||
    n.startsWith("Chat web ·")
  );
}

function displayNameForContact(phone: string, name: string): string {
  const trimmed = (name || "").trim();
  if (phone.startsWith("web:")) {
    if (trimmed && !isGenericWebContactName(trimmed)) {
      return trimmed;
    }
    const sid = phone.slice(4).trim();
    const short = sid.length > 10 ? `${sid.slice(0, 8)}…` : sid || "web";
    return `Chat web · ${short}`;
  }
  return trimmed || phone;
}

export const getOrCreateContact = internalMutation({
  args: { phone: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const displayName = displayNameForContact(args.phone, args.name);
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    const now = Date.now();
    if (existing) {
      if (args.phone.startsWith("web:")) {
        const current = String(existing.name ?? "");
        const nextIsReal = !isGenericWebContactName(displayName);
        if (
          nextIsReal &&
          (isGenericWebContactName(current) || current !== displayName)
        ) {
          await ctx.db.patch(existing._id, {
            name: displayName,
            updatedAt: now,
          });
        }
      }
      return existing._id;
    }
    return ctx.db.insert("contacts", {
      phone: args.phone,
      name: displayName,
      crmType: "lead",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getOrCreateConversation = internalMutation({
  args: {
    contactId: v.id("contacts"),
    channel: v.optional(v.union(v.literal("whatsapp"), v.literal("web"))),
  },
  handler: async (ctx, args) =>
    getOrCreateConversationForContact(
      ctx,
      args.contactId,
      args.channel ?? "whatsapp",
    ),
});

export const markOutboundAsHuman = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const phone = normalizeWhatsappPhone(args.phone);
    if (!phone) return;
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
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

const OUTBOUND_WEBHOOK_METADATA = { source: "ycloud_outbound_webhook" as const };

/**
 * Persiste en inbox mensajes enviados desde WhatsApp Business / YCloud dashboard
 * (no pasan por `inbox.sendMessage`). Dedupe por `wamid`.
 */
export const recordOutboundFromWebhook = internalMutation({
  args: {
    phone: v.string(),
    customerName: v.optional(v.string()),
    content: v.string(),
    messageType: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("audio"),
      v.literal("video"),
      v.literal("document"),
    ),
    mediaUrl: v.optional(v.string()),
    wamid: v.optional(v.string()),
    whatsappStatus: v.optional(
      v.union(
        v.literal("failed"),
        v.literal("accepted"),
        v.literal("sent"),
        v.literal("delivered"),
        v.literal("read"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const phone = normalizeWhatsappPhone(args.phone);
    const content = String(args.content ?? "").trim();
    if (!phone || !content) return { ok: false as const, reason: "empty" };

    const wamid = String(args.wamid ?? "").trim();
    if (wamid.length > 6) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_wamid", (q) => q.eq("wamid", wamid))
        .first();
      if (existing) {
        await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
        return { ok: true as const, skipped: true as const };
      }
    }

    const contactId = await ctx.runMutation(internal.ycloud.getOrCreateContact, {
      phone,
      name: String(args.customerName ?? "").trim() || phone,
    });
    const { conversationId } = await ctx.runMutation(
      internal.ycloud.getOrCreateConversation,
      { contactId },
    );
    const now = Date.now();
    const mt = args.messageType as YcloudMessageMediaType;
    const metadata = { ...OUTBOUND_WEBHOOK_METADATA };

    if (mt === "text") {
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId,
        content,
        createdAt: now,
        metadata,
        wamid: wamid.length > 6 ? wamid : undefined,
        whatsappStatus: args.whatsappStatus,
      });
    } else {
      await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
        conversationId,
        content,
        type: mt,
        mediaUrl: args.mediaUrl,
        createdAt: now,
        metadata,
        wamid: wamid.length > 6 ? wamid : undefined,
        whatsappStatus: args.whatsappStatus,
      });
    }

    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
    return { ok: true as const };
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

/**
 * Devuelve TODOS los `productRetailerId` únicos enviados a esta conversación,
 * para excluirlos en la siguiente página del catálogo cuando el cliente pide
 * "ver más". Sin esto, el segundo envío repetiría las mismas fincas.
 */
export const getAllCatalogRetailerIdsForConversation = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ycloudCatalogMessageWamids")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(200);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const rid = r.productRetailerId.trim();
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);
      out.push(rid);
    }
    return out;
  },
});

/**
 * Devuelve los `productRetailerId` del ÚLTIMO batch de catálogo enviado en
 * esta conversación. Definimos "batch" como las entradas con `createdAt`
 * dentro de una ventana de 5 segundos respecto a la más reciente — el envío
 * de un catálogo crea N entradas con timestamps casi idénticos.
 *
 * Se usa para resolver picks ambiguos del cliente: cuando dice "Quiero esta"
 * sin más contexto y el último catálogo contenía exactamente UNA finca,
 * podemos asumir que se refiere a ella y setear `selectedPropertyRetailerId`
 * automáticamente. Sin esto, `fetchStayQuote` no podía resolver el retailerId
 * y el resumen caía al fallback "No pude calcular el valor automático...".
 *
 * Devuelve `[]` si no hay catálogos enviados o si la conversación no tiene
 * entradas en `ycloudCatalogMessageWamids`.
 */
export const getLatestCatalogRetailerIds = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ycloudCatalogMessageWamids")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(20);
    if (rows.length === 0) return [] as string[];
    const latestTs = rows[0].createdAt;
    const BATCH_WINDOW_MS = 5000;
    const batch = rows.filter(
      (r) => Math.abs(r.createdAt - latestTs) <= BATCH_WINDOW_MS,
    );
    // Dedup (defensivo) preservando orden.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of batch) {
      const rid = r.productRetailerId.trim();
      if (!rid || seen.has(rid)) continue;
      seen.add(rid);
      out.push(rid);
    }
    return out;
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
      classifyImage: classifyContractImage,
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
      limit: 120,
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
