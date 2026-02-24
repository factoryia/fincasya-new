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
      let catalogIntent: CatalogIntent = { intent: "none" };

      if (!isNew) {
        try {
          catalogIntent = await ctx.runAction(internal.ycloud.detectCatalogIntentWithAI, {
            userMessage: args.text,
          });
        } catch (e) {
          console.error("YCloud detectCatalogIntentWithAI error:", e);
        }

        // Enviar ficha de una finca (IA o regex como respaldo): si la IA detectó single_finca usamos eso; si no, intentamos con regex (respaldo).
        try {
          const result = await ctx.runAction(
            internal.ycloud.maybeSendSingleFincaCatalogForUserMessage,
            {
              phone: args.phone,
              userMessage: args.text,
              wamid: args.wamid,
              extractedFincaName: catalogIntent.intent === "single_finca" ? catalogIntent.fincaName : undefined,
            }
          );
          singleFincaSent = result?.sent ?? false;
          fincaTitle = result?.fincaTitle ?? "";
        } catch (e) {
          console.error("YCloud single-finca catalog error:", e);
        }
        try {
          const catalogIntentArg =
            catalogIntent.intent === "more_options"
              ? catalogIntent
              : catalogIntent.intent === "search_catalog"
                ? catalogIntent
                : undefined;
          await ctx.runAction(internal.ycloud.maybeSendCatalogForUserMessage, {
            conversationId,
            phone: args.phone,
            userMessage: args.text,
            wamid: args.wamid,
            catalogIntent: catalogIntentArg,
          });
        } catch (e) {
          console.error("YCloud catalog send error:", e);
        }
      }

      // Generar respuesta de texto: si ya enviamos la ficha de una finca, que sea corta y no pida fechas.
      const searchOverride =
        catalogIntent.intent === "single_finca"
          ? catalogIntent.fincaName
          : singleFincaSent && fincaTitle
            ? fincaTitle
            : undefined;
      const replyText =
        isNew
          ? CONSULTANT_WELCOME_MESSAGE
          : await ctx.runAction(internal.ycloud.generateReplyWithRagAndFincas, {
              conversationId,
              userMessage: args.text,
              singleFincaCatalogSent: singleFincaSent,
              fincaTitle,
              searchQueryOverride: searchOverride,
            });

      if (replyText) {
        try {
          const tag = "[CONTRACT_PDF:";
          const idx = replyText.indexOf(tag);
          const jsonStart = idx >= 0 ? replyText.indexOf("{", idx) : -1;
          let jsonEnd = -1;
          if (jsonStart >= 0) {
            let depth = 0;
            for (let i = jsonStart; i < replyText.length; i++) {
              const c = replyText[i];
              if (c === "{") depth++;
              else if (c === "}") {
                depth--;
                if (depth === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
          }
          const jsonStr =
            jsonEnd > 0 ? replyText.slice(jsonStart, jsonEnd) : null;
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
              const blockStart = replyText.indexOf(tag);
              const blockEnd =
                jsonEnd > 0
                  ? replyText.indexOf("]", jsonEnd) + 1
                  : replyText.length;
              const paymentMessageText = (
                (blockStart > 0 ? replyText.slice(0, blockStart) : "") +
                (blockEnd < replyText.length ? replyText.slice(blockEnd) : "")
              )
                .replace(/\n\s*\n/g, "\n")
                .trim();
              await ctx.runAction(
                internal.contractPdf.sendContractPdfAndPaymentMethods,
                {
                  to: args.phone,
                  wamid: args.wamid,
                  contractData: {
                    finca: String(parsed.finca ?? ""),
                    ubicacion: String(parsed.ubicacion ?? ""),
                    nombre: String(parsed.nombre ?? ""),
                    cedula: String(parsed.cedula ?? ""),
                    celular: String(parsed.celular ?? ""),
                    correo: String(parsed.correo ?? ""),
                    entrada: String(parsed.entrada ?? ""),
                    salida: String(parsed.salida ?? ""),
                    noches: Number(parsed.noches) || 0,
                    precioTotal: Number(parsed.precioTotal) || 0,
                  },
                  paymentMessageText:
                    paymentMessageText ||
                    "MÉTODOS DE PAGO: Abono 50% para confirmar. Saldo 50% al recibir la finca. Nequi, PSE, transferencia o datos bancarios. ¿Te envío los datos bancarios? 💳✨",
                }
              );
            } catch (parseErr) {
              console.error("CONTRACT_PDF parse/send error:", parseErr);
              await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
                to: args.phone,
                text: replyText,
                wamid: args.wamid,
              });
            }
          } else {
            await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
              to: args.phone,
              text: replyText,
              wamid: args.wamid,
            });
          }
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
    /** Si el usuario pidió ver una finca por nombre, buscar por ese nombre para que el contexto tenga la finca correcta. */
    searchQueryOverride: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const ragResult = await rag.search(ctx, {
      namespace: "fincas",
      query: args.searchQueryOverride ?? args.userMessage,
      limit: 5,
    });

    const searchQuery = (args.searchQueryOverride ?? args.userMessage).trim();
    const fincasList = await ctx.runQuery(api.fincas.search, {
      query: searchQuery,
      limit: 12,
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

**Si en el contexto hay VARIAS fincas para la ubicación que pide el usuario:** menciona 3-5 opciones con nombre y precio (o "consultar"), no solo una. Ejemplo: "En Melgar tengo: Villa Hermosa 20 pax ($500k/noche), Quinta Tramontini ($500k), Casa Chimbi ($500k)... ¿Cuál te interesa?" No digas que "solo hay una" si la lista tiene más.

**RESERVA:** Si ofreciste varias fincas, NUNCA pidas nombre/cédula/celular/correo hasta que el usuario ELIJA una ("¿Cuál te gustaría reservar?"). **Fechas:** "Del 20 al 21" = 1 NOCHE (entrada 20, salida 21). Si la finca pide mínimo 2 noches, di: "Del 20 al 21 es 1 noche; la mínima es 2 noches. ¿Te sirve del 20 al 22?" Cuando tenga finca elegida + todos los datos, incluye el bloque [CONTRACT_PDF:{...}] con los datos del contrato y el mensaje visible con confirmación + métodos de pago (abono 50%, saldo 50%, Nequi/PSE/transferencia); el sistema enviará el contrato en PDF y luego el mensaje.

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

/** Intención y datos extraídos por la IA para decidir envío de catálogo. */
export type CatalogIntent =
  | { intent: "none" }
  | { intent: "single_finca"; fincaName: string }
  | { intent: "more_options" }
  | {
      intent: "search_catalog";
      location: string;
      hasWeekend?: boolean;
      dateD1?: number;
      dateD2?: number;
      minCapacity?: number;
      sortByPrice?: boolean;
    };

/**
 * La IA detecta la intención del usuario: ver una finca, buscar opciones (ubicación + fechas), o pedir más opciones.
 * Devuelve un objeto estructurado para que el backend ejecute la acción correcta sin depender solo de regex.
 */
export const detectCatalogIntentWithAI = internalAction({
  args: { userMessage: v.string() },
  handler: async (ctx, args): Promise<CatalogIntent> => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const { text } = await generateText({
      model: openai.chat("gpt-4o-mini"),
      maxTokens: 300,
      system: `Eres un clasificador. Del mensaje del usuario extrae la intención y datos. Responde SOLO con un JSON válido, sin markdown, sin explicación.

Reglas:
- intent: "single_finca" si pide VER una finca por nombre (ej. "quiero ver villa green", "mostrar la finca X"). En fincaName pon solo el nombre de la finca en minúsculas, sin "finca" ni "la".
- intent: "more_options" si pide otras opciones, más opciones, no le gustan, envía más, otras fincas, dame otras.
- intent: "search_catalog" si pide buscar fincas en una UBICACIÓN y tiene fechas o "fin de semana". Extrae: location (solo nombre del lugar, minúsculas, sin emojis), hasWeekend (true si dice fin de semana / este fin / próximo fin), dateD1 y dateD2 (números del 1 al 31 si dice "del X al Y"), minCapacity (número si dice "X personas" o "X o más personas"), sortByPrice (true si dice buen precio, económico, barato).
- intent: "none" si no aplica ninguna de las anteriores.

Ejemplos de salida:
{"intent":"single_finca","fincaName":"villa green"}
{"intent":"more_options"}
{"intent":"search_catalog","location":"melgar","hasWeekend":true,"minCapacity":5,"sortByPrice":true}
{"intent":"search_catalog","location":"restrepo","dateD1":20,"dateD2":21,"minCapacity":10}
{"intent":"none"}

Mes actual: ${month + 1}, año: ${year}.`,
      prompt: args.userMessage,
    });

    try {
      const raw = text.trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const intent = parsed.intent as string | undefined;
      if (intent === "single_finca" && typeof parsed.fincaName === "string" && parsed.fincaName.trim()) {
        return { intent: "single_finca", fincaName: (parsed.fincaName).trim() };
      }
      if (intent === "more_options") return { intent: "more_options" };
      if (intent === "search_catalog" && typeof parsed.location === "string" && parsed.location.trim()) {
        const loc = (parsed.location).replace(/[^\wáéíóúñ\s]/gi, "").trim();
        if (loc.length >= 2) {
          return {
            intent: "search_catalog",
            location: loc,
            hasWeekend: parsed.hasWeekend === true,
            dateD1: typeof parsed.dateD1 === "number" ? parsed.dateD1 : undefined,
            dateD2: typeof parsed.dateD2 === "number" ? parsed.dateD2 : undefined,
            minCapacity: typeof parsed.minCapacity === "number" ? parsed.minCapacity : undefined,
            sortByPrice: parsed.sortByPrice === true,
          };
        }
      }
    } catch {
      // Si falla el parse, devolver none y el flujo usará regex como respaldo
    }
    return { intent: "none" };
  },
});

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
  minCapacity?: number;
  sortByPrice?: boolean;
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
  const personasMatch = msg.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i);
  const minCapacity = personasMatch ? parseInt(personasMatch[1], 10) : undefined;
  const sortByPrice = /\b(buen\s+precio|económico|económicas|barato|barata)\b/i.test(msg);
  return { location, fechaEntrada, fechaSalida, minCapacity, sortByPrice };
}

/** Próximo fin de semana: sábado 00:00 a lunes 00:00 (2 noches). */
function getNextWeekendDates(): { fechaEntrada: number; fechaSalida: number } {
  const now = new Date();
  const day = now.getDay(); // 0 = domingo, 6 = sábado
  let daysUntilSaturday = (6 - day + 7) % 7;
  if (daysUntilSaturday === 0 && now.getHours() >= 12) daysUntilSaturday = 7;
  const sat = new Date(now);
  sat.setDate(sat.getDate() + daysUntilSaturday);
  sat.setHours(0, 0, 0, 0);
  const mon = new Date(sat);
  mon.setDate(mon.getDate() + 2);
  return { fechaEntrada: sat.getTime(), fechaSalida: mon.getTime() };
}

/**
 * Parsea búsqueda con "fin de semana", "X personas", "en [ubicación]", "buen precio".
 * Ej: "Estoy buscando en Melgar una Finca para 12 personas ... fin de semana ... buen precio"
 */
function parseSearchFilters(userMessage: string): {
  location: string;
  fechaEntrada: number;
  fechaSalida: number;
  minCapacity?: number;
  sortByPrice?: boolean;
} | null {
  const msg = userMessage.trim().replace(/\s+/g, " ");
  const lower = msg.toLowerCase();
  if (!/\b(fin\s+de\s+semana|este\s+fin|próximo\s+fin|el\s+fin\s+de\s+semana)\b/i.test(lower)) return null;
  const weekend = getNextWeekendDates();
  // Ubicación: "en X" o "buscando en X"; X puede llevar emojis (ej. ✨MELGAR). Limpiamos después.
  const locationMatch = lower.match(/(?:buscando\s+)?en\s+(.+?)(?:\s+una|\s+finca|,|\s+para\s+\d|$)/s)
    || lower.match(/(?:para|en)\s+(.+?)(?:\s+una|\s+finca|,|\s+grupo|$)/s);
  const location = locationMatch
    ? locationMatch[1].replace(/[^\wáéíóúñ\s]/gi, "").trim().replace(/\s+/g, " ")
    : "";
  if (!location || location.length < 2) return null;
  const personasMatch = lower.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i);
  const minCapacity = personasMatch ? parseInt(personasMatch[1], 10) : undefined;
  const sortByPrice = /\b(buen\s+precio|económico|económicas|barato|barata)\b/i.test(lower);
  return {
    location,
    fechaEntrada: weekend.fechaEntrada,
    fechaSalida: weekend.fechaSalida,
    minCapacity,
    sortByPrice,
  };
}

function detectOtrasOpciones(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase();
  return (
    /\b(otras\s+opciones|más\s+opciones|no\s+me\s+gustan|envía\s+más|otras\s+fincas|dame\s+otras|quiero\s+ver\s+otras)\b/i.test(lower) ||
    /^otras$|^más$|^más\s+opciones$/i.test(lower)
  );
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
    /** Si la IA ya detectó el nombre de la finca, usarlo en lugar de parsear del mensaje. */
    extractedFincaName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; fincaTitle?: string }> => {
    const searchTerm = args.extractedFincaName?.trim() || parseSingleFincaRequest(args.userMessage);
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

const CATALOG_LIMIT = 3;

/**
 * Si el mensaje incluye ubicación + fechas (o "fin de semana") o pide "otras opciones",
 * busca hasta 3 fincas disponibles y envía el catálogo. Guarda en la conversación para poder enviar "otras opciones" después.
 */
export const maybeSendCatalogForUserMessage = internalAction({
  args: {
    conversationId: v.id("conversations"),
    phone: v.string(),
    userMessage: v.string(),
    wamid: v.optional(v.string()),
    /** Si la IA ya detectó intención y datos, usarlos en lugar de regex. */
    catalogIntent: v.optional(
      v.union(
        v.object({ intent: v.literal("more_options") }),
        v.object({
          intent: v.literal("search_catalog"),
          location: v.string(),
          hasWeekend: v.optional(v.boolean()),
          dateD1: v.optional(v.number()),
          dateD2: v.optional(v.number()),
          minCapacity: v.optional(v.number()),
          sortByPrice: v.optional(v.boolean()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.runQuery(api.conversations.getById, {
      conversationId: args.conversationId,
    });
    if (!conv) return;

    let location: string;
    let fechaEntrada: number;
    let fechaSalida: number;
    let minCapacity: number | undefined;
    let sortByPrice: boolean | undefined;
    let excludePropertyIds: Id<"properties">[] | undefined;

    const intent = args.catalogIntent;
    if (intent?.intent === "more_options" && conv.lastCatalogSearch) {
      const last = conv.lastCatalogSearch;
      location = last.location;
      fechaEntrada = last.fechaEntrada;
      fechaSalida = last.fechaSalida;
      minCapacity = last.minCapacity;
      sortByPrice = last.sortByPrice;
      excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
    } else if (intent?.intent === "search_catalog" && intent.location) {
      const weekend = getNextWeekendDates();
      if (intent.hasWeekend) {
        fechaEntrada = weekend.fechaEntrada;
        fechaSalida = weekend.fechaSalida;
      } else if (intent.dateD1 != null && intent.dateD2 != null) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        fechaEntrada = new Date(y, m, intent.dateD1).getTime();
        fechaSalida = new Date(y, m, intent.dateD2 + 1).getTime();
      } else {
        fechaEntrada = weekend.fechaEntrada;
        fechaSalida = weekend.fechaSalida;
      }
      location = intent.location;
      minCapacity = intent.minCapacity;
      sortByPrice = intent.sortByPrice;
    } else if (detectOtrasOpciones(args.userMessage) && conv.lastCatalogSearch) {
      const last = conv.lastCatalogSearch;
      location = last.location;
      fechaEntrada = last.fechaEntrada;
      fechaSalida = last.fechaSalida;
      minCapacity = last.minCapacity;
      sortByPrice = last.sortByPrice;
      excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
    } else {
      const parsedExplicit = parseLocationAndDates(args.userMessage);
      const parsedFilters = parseSearchFilters(args.userMessage);
      const parsed = parsedExplicit ?? parsedFilters;
      if (!parsed) return;
      location = parsed.location;
      fechaEntrada = parsed.fechaEntrada;
      fechaSalida = parsed.fechaSalida;
      minCapacity = parsed.minCapacity;
      sortByPrice = parsed.sortByPrice;
    }

    const fincas = await ctx.runQuery(api.fincas.searchAvailableByLocationAndDates, {
      location,
      fechaEntrada,
      fechaSalida,
      limit: CATALOG_LIMIT,
      minCapacity,
      excludePropertyIds,
      sortByPrice,
    });

    if (fincas.length === 0) return;

    let chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getByLocationKeyword, {
      location,
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

    const bodyText = excludePropertyIds?.length
      ? "Aquí tienes más opciones con los mismos filtros:"
      : "Estas son 3 opciones de fincas disponibles para tus fechas:";

    await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
      to: args.phone,
      productRetailerIds,
      bodyText,
      catalogId: chosenCatalog.whatsappCatalogId,
      wamid: args.wamid,
    });

    await ctx.runMutation(internal.conversations.setLastCatalogSent, {
      conversationId: args.conversationId,
      propertyIds: fincas.map((f) => f._id),
      location,
      fechaEntrada,
      fechaSalida,
      minCapacity,
      sortByPrice,
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
    if (args.wamid) (body).context = { message_id: args.wamid };
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
