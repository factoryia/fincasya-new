import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { transcribeAudio } from "./lib/transcription";
import { classifyContractImage } from "./lib/imageClassifier";
import { processInboundMessageV2 } from "./lib/ycloud/inbound";

function webPhone(sessionId: string): string {
  return `web:${sessionId.trim()}`;
}

export const listMessagesForSession = internalQuery({
  args: {
    sessionId: v.string(),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sid = args.sessionId.trim();
    if (sid.length < 8) {
      return { conversationId: null, messages: [] as Array<Record<string, unknown>> };
    }

    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", webPhone(sid)))
      .unique();
    if (!contact) {
      return { conversationId: null, messages: [] as Array<Record<string, unknown>> };
    }

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .order("desc")
      .collect();

    const conversation =
      conversations.find((c) => c.channel === "web") ?? conversations[0];
    if (!conversation) {
      return { conversationId: null, messages: [] as Array<Record<string, unknown>> };
    }

    const limit = Math.min(Math.max(args.limit ?? 80, 1), 150);
    const since = args.since ?? 0;

    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .take(limit * 3);

    const messages = recent
      .filter(
        (m) =>
          (m.sender === "user" || m.sender === "assistant") &&
          m.createdAt > since,
      )
      .slice(0, limit)
      .reverse()
      .map((m) => ({
        id: m._id,
        sender: m.sender,
        content: m.content,
        type: m.type ?? "text",
        metadata: m.metadata,
        createdAt: m.createdAt,
      }));

    return {
      conversationId: conversation._id,
      status: conversation.status,
      messages,
    };
  },
});

export const processWebInboundMessage = internalAction({
  args: {
    sessionId: v.string(),
    text: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = args.sessionId.trim();
    const text = args.text.trim();
    if (sessionId.length < 8) {
      throw new Error("sessionId inválido");
    }
    if (!text) {
      throw new Error("Mensaje vacío");
    }
    if (text.length > 4000) {
      throw new Error("Mensaje demasiado largo");
    }

    const phone = webPhone(sessionId);
    const name = (args.displayName ?? "").trim();
    if (name.length < 2) {
      throw new Error("Indica tu nombre para iniciar el chat (mínimo 2 caracteres).");
    }
    if (/^visitante(\s+web)?$/i.test(name)) {
      throw new Error("Indica tu nombre real para una atención personalizada.");
    }
    const { runBotTurn } = await import("./lib/bot/index");

    await processInboundMessageV2(
      ctx,
      {
        eventId: `web_${sessionId}_${Date.now()}`,
        phone,
        name,
        text,
        type: "text",
      },
      {
        internal,
        api,
        transcribeAudio,
        classifyImage: classifyContractImage,
        runBotTurn,
        channel: "web",
        deliverText: async () => {},
        deliverCatalog: async (payload) =>
          payload.productRetailerIds.map((productRetailerId) => ({
            productRetailerId,
            ok: true,
          })),
      },
    );

    return { ok: true };
  },
});
