import type { Id } from "../../_generated/dataModel";
import type { BotEntities } from "../bot/types";
import { inferRetailerIdFromCatalogTitle } from "../bot/entities";
import { INBOUND_DEBOUNCE_MS, MAX_CATALOG_PRODUCTS_PER_SEND } from "./constants";

async function isStillThisTailUserMessage(
  ctx: any,
  deps: { api: any },
  conversationId: Id<"conversations">,
  insertedMsgId: string,
  insertedAt: number,
): Promise<boolean> {
  const conv = await ctx.runQuery(deps.api.conversations.getById, { conversationId });
  if (!conv || (conv.lastMessageAt ?? 0) > insertedAt) return false;
  const latest = (await ctx.runQuery(deps.api.messages.getLatestUserMessage, {
    conversationId,
    scanLimit: 50,
  })) as { _id?: string } | null;
  return !!(latest && String(latest._id) === String(insertedMsgId));
}

/** Texto único para el turno: última ráfaga de mensajes del usuario hasta el último del asistente. */
function mergeTrailingUserBurst(
  msgs: Array<{ sender?: string; content?: string }>,
): string {
  const parts: string[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.sender === "assistant") break;
    if (m.sender === "user") {
      const t = String(m.content ?? "").trim();
      if (t) parts.unshift(t);
    }
  }
  return parts.join("\n");
}

export async function processInboundMessageV2(
  ctx: any,
  args: {
    eventId: string;
    phone: string;
    name: string;
    text: string;
    wamid?: string;
    replyToWamid?: string;
    type?: "text" | "image" | "audio" | "video" | "document";
    mediaUrl?: string;
  },
  deps: {
    internal: any;
    api: any;
    transcribeAudio: (url: string, prompt?: string) => Promise<string>;
    runBotTurn: (input: any) => Promise<any>;
  },
) {
  const rawText = String(args.text ?? "").trim();
  if (/^(status|presence)\s*:\s*active$/i.test(rawText)) return;

  const contactId: Id<"contacts"> = await ctx.runMutation(
    deps.internal.ycloud.getOrCreateContact,
    { phone: args.phone, name: args.name },
  );
  const { conversationId } = await ctx.runMutation(
    deps.internal.ycloud.getOrCreateConversation,
    { contactId },
  );

  let finalContent = args.text;
  if (args.type === "audio" && args.mediaUrl) {
    try {
      const transcript = await deps.transcribeAudio(args.mediaUrl, "FincasYa, fincas, reservas, Colombia");
      finalContent = `[Voz] ${transcript}`;
    } catch {
      finalContent = "[Audio] (no se pudo transcribir)";
    }
  }

  const now = Date.now();
  const replyToWamid = String(args.replyToWamid ?? "").trim();
  const insertedMsgId = await ctx.runMutation(deps.internal.messages.insertUserMessage, {
    conversationId,
    content: finalContent,
    createdAt: now,
    type: args.type,
    mediaUrl: args.mediaUrl,
    metadata: replyToWamid ? { replyToWamid } : undefined,
  });

  await new Promise((r) => setTimeout(r, INBOUND_DEBOUNCE_MS));

  const conv = await ctx.runQuery(deps.api.conversations.getById, { conversationId });
  if (!conv || (conv.lastMessageAt ?? 0) > now) return;

  const latestMsg = (await ctx.runQuery(deps.api.messages.getLatestUserMessage, {
    conversationId,
    scanLimit: 50,
  })) as any;
  if (!latestMsg || String(latestMsg._id) !== String(insertedMsgId)) return;
  if (conv.status !== "ai") return;

  const recentForBurst = (await ctx.runQuery(deps.api.messages.listRecent, {
    conversationId,
    limit: 30,
  })) as Array<{ sender?: string; content?: string }>;
  const burstText = mergeTrailingUserBurst(recentForBurst);
  const textForTurn = burstText || String(finalContent ?? "").trim();

  const wantsHuman = /\b(hablar con|llamar|asesor|humano|persona real|agente)\b/i.test(textForTurn);
  if (wantsHuman) {
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId: process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg = "Perfecto, te comunico con un asesor. Un agente te escribirá en breve ✨";
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: Date.now(),
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, { conversationId });
    return;
  }

  const session = await ctx.runQuery(deps.internal.botSessions.getByConversation, { conversationId });
  const currentPhase = session?.phase ?? "welcome";
  let currentEntities = session?.entities ?? {};
  if (replyToWamid) {
    const pick = await ctx.runQuery(deps.internal.ycloud.getCatalogProductByOutboundWamid, {
      conversationId,
      wamid: replyToWamid,
    });
    if (pick?.productRetailerId) {
      const prop = await ctx.runQuery(deps.api.whatsappCatalogs.getPropertyByRetailerId, {
        productRetailerId: pick.productRetailerId,
      });
      currentEntities = {
        ...currentEntities,
        selectedPropertyRetailerId: pick.productRetailerId,
        catalogUserPickedReply: true,
        ...(prop?.propertyName?.trim()
          ? { selectedPropertyName: prop.propertyName.trim() }
          : {}),
      };
    }
  }
  const turnCount = (session?.turnCount ?? 0) + 1;

  const recentMsgs = (await ctx.runQuery(deps.api.messages.listRecent, {
    conversationId,
    limit: 12,
  })) as Array<{ sender?: string; content?: string }>;
  const history = recentMsgs
    .filter((m) => m.sender === "user" || m.sender === "assistant")
    .map((m) => ({
      role: (m.sender === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content ?? ""),
    }));

  const result = await deps.runBotTurn({
    messageText: textForTurn,
    currentPhase,
    currentEntities,
    conversationHistory: history,
    fetchStayQuote: async (e: BotEntities) => {
      const rid =
        e.selectedPropertyRetailerId?.trim() ||
        inferRetailerIdFromCatalogTitle(e.selectedPropertyName) ||
        "";
      const cin = e.checkIn?.trim();
      const cout = e.checkOut?.trim();
      if (!rid || !cin || !cout) return null;
      const data = (await ctx.runQuery(deps.api.whatsappCatalogs.getBotStayQuoteByRetailerId, {
        productRetailerId: rid,
        fechaEntrada: cin,
        fechaSalida: cout,
        cupo: e.cupo,
      })) as { text?: string } | null;
      return data?.text?.trim() ? data.text : null;
    },
  });

  if (
    !(await isStillThisTailUserMessage(ctx, deps, conversationId, String(insertedMsgId), now))
  ) {
    return;
  }

  await ctx.runMutation(deps.internal.botSessions.upsert, {
    conversationId,
    phone: args.phone,
    phase: result.nextPhase,
    entities: result.updatedEntities,
    turnCount,
  });

  if (result.replyText) {
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: result.replyText,
      createdAt: Date.now(),
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: result.replyText,
      wamid: args.wamid,
    });
  }

  const action = result.action;
  if (action.type === "send_catalog") {
    if (
      !(await isStillThisTailUserMessage(ctx, deps, conversationId, String(insertedMsgId), now))
    ) {
      return;
    }
    const catalogPayload = (await ctx.runQuery(
      deps.api.whatsappCatalogs.getPayloadByLocationForN8n,
      {
        location: action.location,
        fechaEntrada: action.checkIn,
        fechaSalida: action.checkOut,
        minCapacity: action.cupo,
        isEvento: action.isEvento,
      },
    )) as {
      catalogId?: string;
      productRetailerIds?: string[];
      productQuoteLines?: string[];
      productTitles?: string[];
    } | null;

    if (catalogPayload?.productRetailerIds?.length) {
      const cap = MAX_CATALOG_PRODUCTS_PER_SEND;
      const ids = catalogPayload.productRetailerIds.slice(0, cap);
      const lines = (catalogPayload.productQuoteLines ?? []).slice(0, cap);
      const titles = (catalogPayload.productTitles ?? []).slice(0, cap);
      const sendRows = (await ctx.runAction(deps.internal.ycloud.sendWhatsAppCatalogList, {
        to: args.phone,
        productRetailerIds: ids,
        productQuoteLines: lines.length ? lines : undefined,
        bodyText: `Fincas disponibles en ${action.location === "RECOMENDADAS" ? "nuestras zonas favoritas" : action.location}:`,
        catalogId: catalogPayload.catalogId,
        wamid: args.wamid,
        conversationId,
      })) as Array<{ productRetailerId: string; wamid?: string }>;

      const tBase = Date.now();
      for (let i = 0; i < ids.length; i++) {
        const quote = lines[i]?.trim();
        const title = titles[i]?.trim() || ids[i];
        const body = quote && quote.length > 0 ? quote : `🏡 ${title}`;
        const wamidOut = sendRows[i]?.wamid;
        await ctx.runMutation(deps.internal.messages.insertAssistantMessageWithMedia, {
          conversationId,
          content: body,
          type: "product",
          metadata: {
            productRetailerId: ids[i],
            wamid: wamidOut,
            productTitle: title,
          },
          createdAt: tBase + i * 25,
        });
      }
    }
  } else if (action.type === "escalate_human") {
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId: process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
  }

  await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, { conversationId });
}
