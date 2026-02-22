import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import rag from "./rag";
import {
  CONSULTANT_SYSTEM_PROMPT,
  CONSULTANT_WELCOME_MESSAGE,
} from "./lib/consultantPrompt";

/**
 * Deduplicación de eventos YCloud (reintentos).
 */
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

/**
 * Obtener o crear contacto por teléfono.
 */
export const getOrCreateContact = internalMutation({
  args: { phone: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("contacts", {
      phone: args.phone,
      name: args.name || args.phone,
      createdAt: now,
    });
  },
});

/**
 * Obtener o crear conversación para un contacto.
 * Si hay una activa (ai o human) se reutiliza; si la más reciente está resuelta, se reactiva a "ai".
 */
export const getOrCreateConversation = internalMutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .order("desc")
      .collect();

    const active = all.find((c) => c.status === "ai" || c.status === "human");
    if (active) {
      return { conversationId: active._id, isNew: false };
    }

    const latestResolved = all.find((c) => c.status === "resolved");
    if (latestResolved) {
      await ctx.db.patch(latestResolved._id, { status: "ai" });
      return { conversationId: latestResolved._id, isNew: false };
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      contactId: args.contactId,
      channel: "whatsapp",
      status: "ai",
      lastMessageAt: now,
      createdAt: now,
    });

    await ctx.db.insert("messages", {
      conversationId,
      sender: "assistant",
      content: CONSULTANT_WELCOME_MESSAGE,
      createdAt: now,
    });

    return { conversationId, isNew: true };
  },
});

/**
 * Procesar mensaje entrante: guardar mensaje del usuario y, si status === "ai", generar respuesta con RAG + fincas y enviar por WhatsApp.
 */
export const processInboundMessage = internalAction({
  args: {
    eventId: v.string(),
    phone: v.string(),
    name: v.string(),
    text: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const contactId: Id<"contacts"> = await ctx.runMutation(
      internal.ycloud.getOrCreateContact,
      { phone: args.phone, name: args.name }
    );

    const { conversationId, isNew } = await ctx.runMutation(
      internal.ycloud.getOrCreateConversation,
      { contactId }
    );

    const now = Date.now();
    await ctx.runMutation(internal.messages.insertUserMessage, {
      conversationId,
      content: args.text,
      createdAt: now,
    });

    const conv = await ctx.runQuery(api.conversations.getById, {
      conversationId,
    });
    if (!conv) return;

    const shouldReply = conv.status === "ai";
    if (shouldReply) {
      let singleFincaSent = false;
      let fincaTitle = "";

      if (!isNew) {
        try {
          const result = await ctx.runAction(
            internal.ycloud.maybeSendSingleFincaCatalogForUserMessage,
            { phone: args.phone, userMessage: args.text, wamid: args.wamid }
          );
          singleFincaSent = result?.sent ?? false;
          fincaTitle = result?.fincaTitle ?? "";
        } catch (e) {
          console.error("YCloud single-finca catalog error:", e);
        }
        try {
          await ctx.runAction(internal.ycloud.maybeSendCatalogForUserMessage, {
            phone: args.phone,
            userMessage: args.text,
            wamid: args.wamid,
          });
        } catch (e) {
          console.error("YCloud catalog send error:", e);
        }
      }

      // Generar respuesta de texto: si ya enviamos la ficha de una finca, que sea corta y no pida fechas.
      const replyText =
        isNew
          ? CONSULTANT_WELCOME_MESSAGE
          : await ctx.runAction(internal.ycloud.generateReplyWithRagAndFincas, {
              conversationId,
              userMessage: args.text,
              singleFincaCatalogSent: singleFincaSent,
              fincaTitle,
            });

      if (replyText) {
        try {
          await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: replyText,
            wamid: args.wamid,
          });
        } catch (e) {
          console.error("YCloud send error:", e);
        }
      }
    }

    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId,
    });
  },
});

/**
 * Generar respuesta usando RAG (base de conocimiento) y datos de fincas.
 * Si singleFincaCatalogSent es true, la respuesta debe ser corta y no pedir fechas (ya se envió la ficha).
 */
export const generateReplyWithRagAndFincas = internalAction({
  args: {
    conversationId: v.id("conversations"),
    userMessage: v.string(),
    singleFincaCatalogSent: v.optional(v.boolean()),
    fincaTitle: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const ragResult = await rag.search(ctx, {
      namespace: "fincas",
      query: args.userMessage,
      limit: 5,
    });

    const fincasList = await ctx.runQuery(api.fincas.search, {
      query: args.userMessage,
      limit: 8,
    });

    const fincasContext = formatFincasForPrompt(fincasList);

    const recentMessages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 10,
    });

    const systemPrompt = buildSystemPrompt(ragResult.text, fincasContext, {
      singleFincaCatalogSent: args.singleFincaCatalogSent ?? false,
      fincaTitle: args.fincaTitle ?? "",
    });
    const messages = recentMessages.map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const { text } = await generateText({
      model: openai.chat("gpt-4o-mini"),
      system: systemPrompt,
      messages,
    });

    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: text,
      createdAt: Date.now(),
    });

    return text;
  },
});

function formatFincasForPrompt(
  list: Array<{
    _id: string;
    title: string;
    description?: string;
    location?: string;
    capacity?: number;
    type?: string;
    category?: string;
    priceBase?: number;
    image?: string;
  }>
): string {
  if (!list?.length) return "";
  return list
    .map(
      (p) =>
        `- ${p.title}: ${p.description ?? ""} | Ubicación: ${p.location ?? "N/A"} | Capacidad: ${p.capacity ?? "N/A"} personas | Tipo: ${p.type ?? "N/A"} | Precio base: ${p.priceBase ?? "consultar"}`
    )
    .join("\n");
}

function buildSystemPrompt(
  ragContext: string,
  fincasContext: string,
  opts?: { singleFincaCatalogSent?: boolean; fincaTitle?: string }
): string {
  const singleFincaHint =
    opts?.singleFincaCatalogSent && opts?.fincaTitle
      ? `
---
**AHORA MISMO:** El usuario pidió ver una finca y YA SE LE ENVIÓ la ficha por catálogo (WhatsApp). Responde UNA sola frase corta (máximo 1-2 líneas) confirmando que le enviaste la ficha. NO pidas fechas ni número de personas en este mensaje. Ejemplo: "Te envié la ficha de ${opts.fincaTitle}. Cuando quieras reservar, cuéntame fechas y personas. 🏡" o "Listo, ahí va la ficha. Cualquier duda o para reservar, me dices fechas y personas. ✨"
`
      : "";

  return `${CONSULTANT_SYSTEM_PROMPT}

---
## CONTEXTO ACTUAL (usa SOLO esta información para datos concretos)

### 1) Base de conocimiento (normas, políticas, FAQs, respuestas rápidas):
${ragContext || "(No hay fragmentos relevantes para esta consulta. Responde con las reglas generales del consultor.)"}

### 2) Fincas disponibles según la búsqueda del usuario:
${fincasContext || "(No hay fincas que coincidan. Ofrece alternativas de sector o pide más datos.)"}
${singleFincaHint}
---
**CRÍTICO:** NUNCA vuelvas a enviar el mensaje de bienvenida largo (HERNÁN, lista de preguntas con 📅👥🫂🎉). Ese mensaje ya lo recibió el usuario en el primer mensaje. Si el usuario ya dio ubicación, fechas, personas o tipo de plan, CONFIRMA esos datos en una frase y sigue: muestra oferta de fincas del catálogo o pregunta lo que falte (ej. mascotas). Ejemplo: "Perfecto, Restrepo del 20 al 21 para 10 personas, plan amigos, sin evento. ¿Llevarán mascotas? 🐶" o "Permítame revisar disponibilidad en Restrepo... 🗓️ [mostrar fincas]".

Responde SIEMPRE como Hernán, Consultor de FincasYa.com (nunca escribas FincasYa.cloud ni otra variante), en español. USA EMOJIS. Usa el RAG y el catálogo de fincas para datos; no inventes. Máximo 2-4 líneas por mensaje cuando sea posible.`;
}

/**
 * Cuando el negocio envía un mensaje (humano desde YCloud), marcar la conversación como "human"
 * para que la IA no siga respondiendo hasta que se vuelva a activar "ai".
 */
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
      await ctx.db.patch(conv._id, { status: "human" });
    }
  },
});

/**
 * Enviar mensaje por WhatsApp vía YCloud.
 * Requiere en Convex: YCLOUD_API_KEY, YCLOUD_WABA_NUMBER (número E164 del negocio).
 */
export const sendWhatsAppMessage = internalAction({
  args: {
    to: v.string(),
    text: v.string(),
    wamid: v.optional(v.string()),
    sendDirectly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error(
        "YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex (npx convex env set ...)"
      );
    }
    const endpoint = args.sendDirectly
      ? "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly"
      : "https://api.ycloud.com/v2/whatsapp/messages";
    const body: {
      from: string;
      to: string;
      type: string;
      text: { body: string };
      context?: { message_id: string };
    } = {
      from: wabaNumber,
      to: args.to,
      type: "text",
      text: { body: args.text },
    };
    if (args.wamid) body.context = { message_id: args.wamid };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    const textRes = await res.text();
    if (!res.ok) {
      throw new Error(`YCloud API error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes);
  },
});

/** Ubicaciones que usan catálogo por palabra clave (ej. Tolima) se resuelven desde whatsappCatalogs.locationKeyword en la BD. */

/**
 * Parsea si el usuario pide ver una finca concreta por nombre (ej. "quiero ver la finca de villa green").
 * Devuelve el término de búsqueda o null.
 */
function parseSingleFincaRequest(userMessage: string): string | null {
  const msg = userMessage.trim();
  if (msg.length < 4) return null;
  const lower = msg.toLowerCase();
  const patterns = [
    /(?:quiero\s+)?(?:ver|mostrar)\s+(?:la\s+)?(?:finca\s+)?(?:de\s+)?([a-záéíóúñ0-9\s#]+)/i,
    /(?:la\s+)?finca\s+(?:de\s+)?([a-záéíóúñ0-9\s#]+)/i,
    /(?:ver|mostrar)\s+([a-záéíóúñ0-9\s#]+)/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m) {
      const term = m[1].trim();
      if (term.length >= 2 && !/^(la|el|de|una?)$/i.test(term)) return term;
    }
  }
  return null;
}

/**
 * Parsea ubicación y fechas del mensaje del usuario (ej. "para restrepo del 20 al 21 para 10 personas").
 * Devuelve null si no se puede extraer al menos ubicación y dos días.
 */
function parseLocationAndDates(userMessage: string): {
  location: string;
  fechaEntrada: number;
  fechaSalida: number;
} | null {
  const msg = userMessage.trim().toLowerCase();
  // Ubicación: "para X" o "en X" (X = palabra(s), hasta "del" o "para" o número)
  const locationMatch = msg.match(/(?:para|en)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|$)/i);
  const location = locationMatch ? locationMatch[1].trim().replace(/\s+/g, " ") : "";
  // Fechas: "del 20 al 21" o "20 al 21"
  const dateMatch = msg.match(/(?:del\s+)?(\d{1,2})\s*al\s*(\d{1,2})/i);
  if (!location || !dateMatch) return null;
  const d1 = parseInt(dateMatch[1], 10);
  const d2 = parseInt(dateMatch[2], 10);
  if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const fechaEntrada = new Date(year, month, d1).getTime();
  const fechaSalida = new Date(year, month, d2 + 1).getTime(); // salida = día siguiente 00:00
    return { location, fechaEntrada, fechaSalida };
}

/**
 * Si el usuario pide ver una finca concreta por nombre (ej. "quiero ver la finca de villa green"),
 * busca esa finca, obtiene su product_retailer_id en el catálogo por defecto y envía esa ficha del catálogo.
 * Devuelve { sent: true, fincaTitle } cuando envió la ficha, para que el texto de respuesta sea corto y no pida fechas.
 */
export const maybeSendSingleFincaCatalogForUserMessage = internalAction({
  args: {
    phone: v.string(),
    userMessage: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; fincaTitle?: string }> => {
    const searchTerm = parseSingleFincaRequest(args.userMessage);
    if (!searchTerm) return { sent: false };

    const searchResults = await ctx.runQuery(api.fincas.search, {
      query: searchTerm,
      limit: 5,
    });
    if (searchResults.length === 0) return { sent: false };

    const inCatalogIds = await ctx.runQuery(
      api.propertyWhatsAppCatalog.getPropertyIdsInAnyCatalog,
      {}
    );
    const inCatalogSet = new Set(inCatalogIds);
    const firstInCatalog = searchResults.find((p) => inCatalogSet.has(p._id));
    if (!firstInCatalog) return { sent: false };

    const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    if (!catalog) return { sent: false };

    const productEntries = await ctx.runQuery(
      api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
      { catalogId: catalog._id, propertyIds: [firstInCatalog._id] }
    );
    if (productEntries.length === 0) return { sent: false };

    await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
      to: args.phone,
      productRetailerIds: productEntries.map((e) => e.productRetailerId),
      bodyText: `Aquí está ${firstInCatalog.title} 🏡`,
      catalogId: catalog.whatsappCatalogId,
      wamid: args.wamid,
    });
    return { sent: true, fincaTitle: firstInCatalog.title };
  },
});

/**
 * Si el mensaje del usuario incluye ubicación y fechas, busca fincas disponibles y envía el catálogo (product_list) por WhatsApp.
 * Catálogo y product_retailer_id se leen de la BD (whatsappCatalogs + propertyWhatsAppCatalog); no hay env vars.
 */
export const maybeSendCatalogForUserMessage = internalAction({
  args: {
    phone: v.string(),
    userMessage: v.string(),
    wamid: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const parsed = parseLocationAndDates(args.userMessage);
    if (!parsed) return;

    const fincas = await ctx.runQuery(api.fincas.searchAvailableByLocationAndDates, {
      location: parsed.location,
      fechaEntrada: parsed.fechaEntrada,
      fechaSalida: parsed.fechaSalida,
      limit: args.limit ?? 4,
    });

    if (fincas.length === 0) return;

    let chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getByLocationKeyword, {
      location: parsed.location,
    });
    if (!chosenCatalog) {
      chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    }
    if (!chosenCatalog) return;

    let productEntries = await ctx.runQuery(
      api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
      {
        catalogId: chosenCatalog._id,
        propertyIds: fincas.map((f) => f._id),
      }
    );
    if (productEntries.length === 0) {
      const defaultCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
      if (defaultCatalog && defaultCatalog._id !== chosenCatalog._id) {
        chosenCatalog = defaultCatalog;
        productEntries = await ctx.runQuery(
          api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
          { catalogId: chosenCatalog._id, propertyIds: fincas.map((f) => f._id) }
        );
      }
    }
    const productRetailerIds = productEntries.map((e) => e.productRetailerId);
    if (productRetailerIds.length === 0) return;

    await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
      to: args.phone,
      productRetailerIds,
      bodyText: "Estas son nuestras fincas disponibles para tus fechas:",
      catalogId: chosenCatalog.whatsappCatalogId,
      wamid: args.wamid,
    });
  },
});

/**
 * Enviar lista de productos del catálogo (fincas) por WhatsApp.
 * POST con type: interactive, interactive.type: product_list.
 */
export const sendWhatsAppCatalogList = internalAction({
  args: {
    to: v.string(),
    productRetailerIds: v.array(v.string()),
    bodyText: v.optional(v.string()),
    catalogId: v.optional(v.string()),
    wamid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.productRetailerIds.length === 0) return null;
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    const catalogId = args.catalogId;
    if (!apiKey || !wabaNumber) {
      throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
    }
    if (!catalogId) {
      throw new Error("catalogId es requerido (viene de whatsappCatalogs en la BD)");
    }
    const bodyText = args.bodyText ?? "Estas son nuestras fincas disponibles para tus fechas:";
    const body: Record<string, unknown> =
      args.productRetailerIds.length === 1
        ? {
            from: wabaNumber,
            to: args.to,
            type: "interactive",
            interactive: {
              type: "product",
              body: { text: bodyText },
              footer: { text: "FincasYa" },
              action: {
                catalog_id: catalogId,
                product_retailer_id: args.productRetailerIds[0],
              },
            },
          }
        : {
            from: wabaNumber,
            to: args.to,
            type: "interactive",
            interactive: {
              type: "product_list",
              header: { type: "text", text: "Fincas" },
              body: { text: bodyText },
              footer: { text: "FincasYa" },
              action: {
                catalog_id: catalogId,
                sections: [
                  {
                    title: "Fincas disponibles",
                    product_items: args.productRetailerIds.map((id) => ({ product_retailer_id: id })),
                  },
                ],
              },
            },
          };
    if (args.wamid) (body as Record<string, unknown>).context = { message_id: args.wamid };
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    const textRes = await res.text();
    if (!res.ok) {
      throw new Error(`YCloud API error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes);
  },
});
