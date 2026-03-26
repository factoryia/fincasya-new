import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { v } from "convex/values";
import { action, internalAction, internalMutation } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import rag from "./rag";
import { CONSULTANT_SYSTEM_PROMPT } from "./lib/consultantPrompt";

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

    // La bienvenida va por plantilla YCloud (elegida del listado), no por texto falso en BD.

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
    type: v.optional(
      v.union(
        v.literal("text"),
        v.literal("image"),
        v.literal("audio"),
        v.literal("video"),
        v.literal("document")
      )
    ),
    mediaUrl: v.optional(v.string()),
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
      type: args.type,
      mediaUrl: args.mediaUrl,
    });

    const conv = await ctx.runQuery(api.conversations.getById, {
      conversationId,
    });
    if (!conv) return;

    const shouldReply = conv.status === "ai";
    if (shouldReply) {
      let singleFincaSent = false;
      let fincaTitle = "";
      let whatsappCatalogSentForSearch = false;
      let catalogIntent: CatalogIntent = { intent: "none" };

      const recentForCatalogIntent = await ctx.runQuery(api.messages.listRecent, {
        conversationId,
        limit: 14,
      });
      const catalogIntentSnippet = recentForCatalogIntent
        .map(
          (m) =>
            `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 320)}`
        )
        .join("\n");

      try {
        catalogIntent = await ctx.runAction(internal.ycloud.detectCatalogIntentWithAI, {
          userMessage: args.text,
          conversationSnippet: catalogIntentSnippet,
        });
      } catch (e) {
        console.error("YCloud detectCatalogIntentWithAI error:", e);
      }

      // Enviar ficha de una finca (IA o regex como respaldo).
      try {
        const result = await ctx.runAction(
          internal.ycloud.maybeSendSingleFincaCatalogForUserMessage,
          {
            phone: args.phone,
            userMessage: args.text,
            wamid: args.wamid,
            extractedFincaName:
              catalogIntent.intent === "single_finca"
                ? catalogIntent.fincaName
                : undefined,
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
        const catalogRes = await ctx.runAction(
          internal.ycloud.maybeSendCatalogForUserMessage,
          {
            conversationId,
            phone: args.phone,
            userMessage: args.text,
            wamid: args.wamid,
            catalogIntent: catalogIntentArg,
          }
        );
        whatsappCatalogSentForSearch = catalogRes?.sent ?? false;
      } catch (e) {
        console.error("YCloud catalog send error:", e);
      }

      // Plantillas: no pisar el flujo cuando ya mandamos catálogo interactivo (evita plantilla + return sin texto útil).
      let templateSent = false;
      if (!whatsappCatalogSentForSearch) {
        try {
          const routed = await ctx.runAction(
            internal.ycloud.maybeSendWhatsappTemplateReply,
            {
              phone: args.phone,
              wamid: args.wamid,
              conversationId,
              userMessage: args.text,
            }
          );
          templateSent = routed?.sent ?? false;
        } catch (e) {
          console.error("YCloud maybeSendWhatsappTemplateReply error:", e);
        }
      }

      if (templateSent) {
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      // Generar respuesta de texto: si ya enviamos la ficha de una finca, que sea corta y no pida fechas.
      const searchOverride =
        catalogIntent.intent === "single_finca"
          ? catalogIntent.fincaName
          : singleFincaSent && fincaTitle
            ? fincaTitle
            : undefined;
      const replyText = await ctx.runAction(
        internal.ycloud.generateReplyWithRagAndFincas,
        {
          conversationId,
          userMessage: args.text,
          singleFincaCatalogSent: singleFincaSent,
          fincaTitle,
          searchQueryOverride: searchOverride,
          whatsappCatalogSentForSearch,
        }
      );

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
    /**
     * True si ya se envió el mensaje interactivo de catálogo WhatsApp (product_list / product).
     * No repetir lista de fincas ni precios en texto.
     */
    whatsappCatalogSentForSearch: v.optional(v.boolean()),
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

    const catalogAlreadyShown = args.whatsappCatalogSentForSearch === true;
    const fincasContext = catalogAlreadyShown
      ? "(Ya se envió el catálogo de WhatsApp con las fincas; el cliente ve nombres, fotos y precios ahí. NO repitas lista numerada ni precios en tu mensaje.)"
      : formatFincasForPrompt(fincasList);

    const recentMessages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 10,
    });

    const systemPrompt = buildSystemPrompt(ragResult.text, fincasContext, {
      singleFincaCatalogSent: args.singleFincaCatalogSent ?? false,
      fincaTitle: args.fincaTitle ?? "",
      whatsappCatalogSentForSearch: catalogAlreadyShown,
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
  opts?: {
    singleFincaCatalogSent?: boolean;
    fincaTitle?: string;
    whatsappCatalogSentForSearch?: boolean;
  }
): string {
  const singleFincaHint =
    opts?.singleFincaCatalogSent && opts?.fincaTitle
      ? `
---
**AHORA MISMO:** El usuario pidió ver una finca y YA SE LE ENVIÓ la ficha por catálogo (WhatsApp). Responde UNA sola frase corta (máximo 1-2 líneas) confirmando que le enviaste la ficha. NO pidas fechas ni número de personas en este mensaje. Ejemplo: "Te envié la ficha de ${opts.fincaTitle}. Cuando quieras reservar, cuéntame fechas y personas. 🏡" o "Listo, ahí va la ficha. Cualquier duda o para reservar, me dices fechas y personas. ✨"
`
      : "";

  const multiCatalogHint = opts?.whatsappCatalogSentForSearch
    ? `
---
**AHORA MISMO:** El sistema YA ENVIÓ el **catálogo interactivo de WhatsApp** (tarjeta con varias fincas: fotos, precios, detalles). Está PROHIBIDO escribir lista numerada (1. 2. 3.), PROHIBIDO copiar nombres de fincas con precios en texto. Responde 1-3 líneas máximo: confirma brevemente (ubicación/fechas/personas si aplica) e invita a elegir en el catálogo o decir el nombre. Ejemplo: "Te compartí el catálogo con las opciones para Melgar y tu fin de semana. Toca la que te guste o dime cuál prefieres. 💎🏡"
`
    : "";

  const variasFincasTextoRule = opts?.whatsappCatalogSentForSearch
    ? "**Catálogo ya enviado:** no aplica listar fincas en texto; el cliente las ve en WhatsApp."
    : "**Si en el contexto hay VARIAS fincas y NO se ha enviado catálogo interactivo:** puedes mencionar 3-5 opciones con nombre y precio. Si el sistema envía catálogo, nunca dupliques eso en texto.";

  return `${CONSULTANT_SYSTEM_PROMPT}

---
## CONTEXTO ACTUAL (usa SOLO esta información para datos concretos)

### 1) Base de conocimiento (normas, políticas, FAQs, respuestas rápidas):
${ragContext || "(No hay fragmentos relevantes para esta consulta. Responde con las reglas generales del consultor.)"}

### 2) Fincas disponibles según la búsqueda del usuario:
${fincasContext || "(No hay fincas que coincidan. Ofrece alternativas de sector o pide más datos.)"}
${singleFincaHint}${multiCatalogHint}
---
**CRÍTICO:** La bienvenida inicial la envía el sistema como **plantilla WhatsApp** (YCloud), no tú como texto largo con listas 📅👥. No repitas ese bloque. Si el usuario ya dio ubicación, fechas, personas o tipo de plan, CONFIRMA y sigue (fincas, mascotas, etc.). Ejemplo: "Perfecto, Restrepo del 20 al 21 para 10 personas… ¿Llevarán mascotas? 🐶".

${variasFincasTextoRule}

**RESERVA:** Si hay varias opciones, NUNCA pidas nombre/cédula/celular/correo hasta que el usuario ELIJA una finca. **Fechas:** "Del 20 al 21" = 1 NOCHE (entrada 20, salida 21). Si la finca pide mínimo 2 noches, di: "Del 20 al 21 es 1 noche; la mínima es 2 noches. ¿Te sirve del 20 al 22?" Cuando tenga finca elegida + todos los datos, incluye el bloque [CONTRACT_PDF:{...}] con los datos del contrato y el mensaje visible con confirmación + métodos de pago (abono 50%, saldo 50%, Nequi/PSE/transferencia); el sistema enviará el contrato en PDF y luego el mensaje.

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

const YCLOUD_TEMPLATES_LIST = "https://api.ycloud.com/v2/whatsapp/templates";
const YCLOUD_SEND_DIRECTLY =
  "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly";

/**
 * Plantillas que no debe elegir el bot automáticamente.
 * bienvenida* ya no van aquí: deben poder elegirse desde YCloud cuando encajen.
 */
const TEMPLATE_ROUTING_DENYLIST = new Set(["chat_center"]);

function templateRoutingDisabled(): boolean {
  const envVal = process.env.YCLOUD_TEMPLATE_ROUTING?.trim().toLowerCase();
  return (
    envVal === "0" ||
    envVal === "false" ||
    envVal === "off" ||
    envVal === "no"
  );
}

type YCloudTemplateListItem = {
  name: string;
  language: string;
  status: string;
  wabaId?: string;
  components?: Array<{
    type?: string;
    text?: string;
    buttons?: unknown[];
  }>;
};

function isTemplateApproved(status: string | undefined): boolean {
  return String(status ?? "").toUpperCase() === "APPROVED";
}

export type RoutableWhatsappTemplate = {
  name: string;
  language: string;
  /** Pistas para el clasificador sin enviar el BODY completo al prompt. */
  hint: string;
};

function bodyHasVariables(
  components: YCloudTemplateListItem["components"]
): boolean {
  if (!components?.length) return false;
  for (const c of components) {
    if (
      c.type === "BODY" &&
      typeof c.text === "string" &&
      c.text.includes("{{")
    ) {
      return true;
    }
  }
  return false;
}

/** Tema legible a partir del nombre interno (snake_case). */
function buildIntentHintFromName(name: string): string {
  return name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function itemsToRoutable(
  items: YCloudTemplateListItem[],
  onlyWabaId?: string
): RoutableWhatsappTemplate[] {
  const extraDeny = new Set(
    (process.env.YCLOUD_TEMPLATE_ROUTING_DENYLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const out: RoutableWhatsappTemplate[] = [];
  const seen = new Set<string>();

  for (const t of items) {
    if (
      onlyWabaId &&
      (!t.wabaId || String(t.wabaId) !== onlyWabaId)
    )
      continue;
    if (!isTemplateApproved(t.status)) continue;
    if (bodyHasVariables(t.components)) continue;
    if (TEMPLATE_ROUTING_DENYLIST.has(t.name) || extraDeny.has(t.name))
      continue;

    const lang = (t.language || "es").trim();
    const key = `${t.name}:${lang}`;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({
      name: t.name,
      language: lang,
      hint: buildIntentHintFromName(t.name),
    });
  }

  return out;
}

async function fetchYCloudTemplateItems(
  apiKey: string,
  withWabaFilter: boolean,
  wabaId?: string
): Promise<YCloudTemplateListItem[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (withWabaFilter && wabaId) params.set("filter.wabaId", wabaId);
  const res = await fetch(`${YCLOUD_TEMPLATES_LIST}?${params.toString()}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("fetchYCloudTemplateItems error:", res.status, txt);
    return [];
  }
  const data = (await res.json()) as { items?: YCloudTemplateListItem[] };
  return data.items ?? [];
}

/**
 * Lista plantillas APPROVED sin variables en el BODY (envío sin parámetros).
 * Si el filtro por WABA devuelve vacío, reintenta sin query y filtra por item.wabaId.
 */
async function fetchRoutableTemplates(): Promise<RoutableWhatsappTemplate[]> {
  const apiKey = process.env.YCLOUD_API_KEY;
  if (!apiKey) return [];

  const wabaId = process.env.YCLOUD_WABA_ID?.trim();

  let items = await fetchYCloudTemplateItems(apiKey, true, wabaId);
  if (items.length === 0 && wabaId) {
    console.warn(
      "[template-routing] listado vacío con filter.wabaId; reintentando sin filtro y filtrando por wabaId en items"
    );
    items = await fetchYCloudTemplateItems(apiKey, false, undefined);
  }

  return itemsToRoutable(items, wabaId || undefined);
}

/**
 * Coincidencia por palabras clave (no depende de la IA). Orden: más específico primero.
 */
function pickTemplateByKeywords(
  userMessage: string,
  routable: RoutableWhatsappTemplate[]
): { name: string; language: string } | null {
  const msg = userMessage.toLowerCase().normalize("NFD");
  const ascii = msg.replace(/\p{M}/gu, "");

  const byName = (n: string) => routable.find((t) => t.name === n);
  const pick = (templateName: string) => {
    const t = byName(templateName);
    return t ? { name: t.name, language: t.language } : null;
  };

  const rules: Array<{ re: RegExp; template: string }> = [
    {
      re: /personal\s+obligatorio|servicio\s+obligatorio|requieren\s+personal|personal\s+de\s+servicio.*oblig/i,
      template: "personal_de_servicio_obligatorio",
    },
    {
      re: /personal\s+de\s+(apoyo|servicio)|emplead[ao]\s+de\s+servicio|contratar\s+personal|muchacha\s+de/i,
      template: "personal_de_servicio_en_caso_de_que_la_propiedad_tenga",
    },
    {
      re: /mascota|perro|perros|gato|gatos|animal|llev(ar|o)\s+(mi\s+)?(perro|gato)/i,
      template: "pregunta_por_mascotas",
    },
    {
      re: /check\s*-?\s*in|check\s*-?\s*out|hora\s+de\s+(entrada|salida)|a\s+que\s+hora\s+(entro|llego|salgo)/i,
      template: "preguntas_check_in_y_check_out",
    },
    {
      re: /cobro\s+por\s+persona|precio\s+por\s+persona|valor\s+por\s+persona|cobran\s+por\s+persona|pagan\s+por\s+persona/i,
      template: "pregunta_sobre_el_cobro_por_persona",
    },
    {
      re: /navidad|fin\s+de\s+a[nñ]o|noche\s+vieja|reyes|a[nñ]o\s+nuevo|fechas\s+especiales|festividades/i,
      template: "tarifas_y_disponibilidad_en_fechas_especiales",
    },
    {
      re: /puente\s+festivo|puentes\s+festivos|fin\s+de\s+semana\s+largo/i,
      template: "fin_de_semana_con_puente",
    },
    {
      re: /contrato(\s+de\s+arrendamiento)?|datos\s+para\s+(el\s+)?contrato|firm(ar|o)\s+(el\s+)?contrato|cedula.*contrato/i,
      template: "contrato_de_arrendamiento",
    },
    {
      re: /como\s+(reservo|pago|hago\s+la\s+reserva)|proceso\s+de\s+(reserva|pago)|formas\s+de\s+pago|abono\s+del\s*50|medios\s+de\s+pago/i,
      template: "proceso_de_reserva",
    },
    {
      re: /dj\b|sonido\s+profesional|grupo\s+musical|iluminaci[oó]n.*(evento|fiesta)|evento\s+en\s+la\s+finca/i,
      template: "detalles_en_caso_de_evento_o_celebracion_especial",
    },
    {
      re: /fiesta|evento\s+familiar|evento\s+empresarial|celebraci[oó]n/i,
      template: "en_caso_de_fiesta",
    },
    {
      re: /sin\s+disponibilidad|no\s+hay\s+disponibilidad|no\s+tienen\s+nada\s+en|agotad[oa]\s+en/i,
      template: "sector_no_disponible",
    },
    {
      re: /entrega\s+(formal\s+)?del\s+inmueble|saldo\s+(pendiente|restante)|recibir\s+la\s+finca/i,
      template: "cobro_y_entrega_formal_del_inmueble",
    },
    {
      re: /descuento|rebaja|mejor\s+precio(\s+por\s+noche)?/i,
      template: "descuentos_en_propiedades",
    },
    {
      re: /video\s+(de\s+)?(la\s+)?finca|conocer\s+(la\s+)?propiedad|m[aá]s\s+(fotos|info|informaci[oó]n).*\bfinca/i,
      template: "conocer_alguna_propiedad",
    },
    {
      re: /rese[nñ]a|google\s+maps|calificar\s+en\s+google|dejar\s+una\s+rese/i,
      template: "fidelizacion_y_comentario_de_google",
    },
    {
      re: /eleg[ií]\s+(una\s+)?finca|seleccion(e|é)\s+(una\s+)?(del\s+)?cat[aá]logo|una\s+de\s+las\s+fincas\s+del\s+cat/i,
      template: "al_momento_de_seleccionar_una_de_las_fincas_del_catalogo",
    },
  ];

  for (const { re, template } of rules) {
    if (re.test(ascii) || re.test(msg)) {
      const p = pick(template);
      if (p) {
        console.log("[template-routing] match por palabras clave:", template);
        return p;
      }
    }
  }

  const trim = ascii.trim();
  const shortMsg = trim.length < 160;
  const looksLikeGreeting =
    /^(hola|holaa|hey|buenos|buenas|buen\s+d[ií]a|qu[eé]\s+tal|saludos|hi)\b/i.test(
      trim
    ) ||
    /^(info|informaci[oó]n|quiero\s+(una\s+)?finca|busco\s+(una\s+)?finca|necesito\s+finca|me\s+ayudas|ayuda)\b/i.test(
      trim
    );
  if (shortMsg && looksLikeGreeting) {
    const preferred =
      process.env.YCLOUD_WELCOME_TEMPLATE_NAME?.trim() || "bienvenida_hernan";
    const order = [preferred, "bienvenida_hernan", "bienvenida"];
    const seenNames = new Set<string>();
    for (const n of order) {
      if (seenNames.has(n)) continue;
      seenNames.add(n);
      const p = pick(n);
      if (p) {
        console.log("[template-routing] saludo o consulta genérica →", n);
        return p;
      }
    }
  }

  return null;
}

/**
 * Envía un mensaje de plantilla HSM (sin componentes variables).
 */
export const sendWhatsAppTemplateMessage = internalAction({
  args: {
    to: v.string(),
    templateName: v.string(),
    language: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error(
        "YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex"
      );
    }
    const baseBody: Record<string, unknown> = {
      from: wabaNumber,
      to: args.to,
      type: "template",
      template: {
        name: args.templateName,
        language: { code: args.language },
      },
    };

    const post = (body: Record<string, unknown>) =>
      fetch(YCLOUD_SEND_DIRECTLY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

    // Muchas integraciones fallan si se mezcla plantilla con context (reply); probamos sin context primero.
    let res = await post(baseBody);
    let textRes = await res.text();
    if (!res.ok && args.wamid) {
      const withCtx = {
        ...baseBody,
        context: { message_id: args.wamid },
      };
      res = await post(withCtx);
      textRes = await res.text();
    }
    if (!res.ok) {
      throw new Error(`YCloud template error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes) as Record<string, unknown>;
  },
});

/**
 * Elige una plantilla YCloud aprobada que encaje con la consulta, o NONE para seguir con RAG.
 */
export const selectWhatsappTemplateWithAI = internalAction({
  args: {
    userMessage: v.string(),
    conversationSnippet: v.string(),
    templatesJson: v.string(),
  },
  handler: async (_ctx, args): Promise<{ name: string; language: string } | null> => {
    const { text: modelText } = await generateText({
      model: openai.chat("gpt-4o-mini"),
      maxTokens: 120,
      system: `Eres un enrutador para WhatsApp.
Decides si el mensaje encaja con UNA plantilla de la lista (preguntas frecuentes con respuesta fija).
Cada ítem tiene "hint": palabras clave del tema (no es el texto de la plantilla).

Responde SOLO JSON válido, sin markdown:

{"choice":"NONE"}

o

{"choice":"TEMPLATE","name":"<nombre_exacto>","language":"<idioma_exacto>"}

Reglas:
- TEMPLATE: cualquier mensaje que encaje con una plantilla de la lista (nombre + hint), incluidas **bienvenida** / **bienvenida_hernan** para saludos genéricos o pedidos muy abiertos de información sin tema específico ya cubierto por otra plantilla.
- TEMPLATE: preguntas de política/FAQ (mascotas, check-in/out, cobro por persona, fechas especiales, puente, personal de servicio, contrato, proceso de pago, etc.).
- NONE: mensaje con ubicación + fechas + personas para buscar catálogo (mejor RAG/catálogo), elige una finca por nombre concreto, envía datos personales para contrato, o ninguna plantilla encaja.
- Si encajan dos plantillas por igual → NONE.
- "name" y "language" deben ser idénticos a un elemento de la lista.`,
      prompt: `Plantillas disponibles (JSON, cada una: name, language, hint):
${args.templatesJson}

Historial breve:
${args.conversationSnippet || "(vacío)"}

Mensaje actual:
${args.userMessage}`,
    });

    try {
      const raw = modelText
        .trim()
        .replace(/^```json\s*|^```\s*|\s*```$/g, "")
        .trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.choice !== "TEMPLATE") return null;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      const language =
        typeof parsed.language === "string" ? parsed.language.trim() : "";
      if (!name || !language) return null;
      return { name, language };
    } catch (err) {
      console.error(
        "selectWhatsappTemplateWithAI parse error:",
        err,
        modelText
      );
      return null;
    }
  },
});

/**
 * Si aplica, envía una plantilla YCloud y guarda el mensaje en la conversación (sin pasar por RAG).
 * Usa api.messages.listRecent (query público); internal.messages.listRecent no existe en este proyecto.
 */
export const maybeSendWhatsappTemplateReply = internalAction({
  args: {
    phone: v.string(),
    wamid: v.optional(v.string()),
    conversationId: v.id("conversations"),
    userMessage: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: boolean; templateName?: string }> => {
    if (templateRoutingDisabled()) {
      console.log("[template-routing] desactivado por YCLOUD_TEMPLATE_ROUTING");
      return { sent: false };
    }

    if (isAffirmativeOnly(args.userMessage)) {
      console.log(
        "[template-routing] solo afirmación (sí/ok/dale); no enviar plantilla"
      );
      return { sent: false };
    }

    let routable: RoutableWhatsappTemplate[] = [];
    try {
      routable = await fetchRoutableTemplates();
    } catch (e) {
      console.error("fetchRoutableTemplates error:", e);
      return { sent: false };
    }
    if (routable.length === 0) {
      console.warn(
        "[template-routing] 0 plantillas enrutables (revisa YCLOUD_API_KEY, YCLOUD_WABA_ID, APPROVED y sin {{}} en BODY)"
      );
      return { sent: false };
    }

    const recent = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 8,
    });
    const snippet = recent
      .map(
        (m) =>
          `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 280)}`
      )
      .join("\n");

    const templatesJson = JSON.stringify(routable);
    let picked: { name: string; language: string } | null =
      pickTemplateByKeywords(args.userMessage, routable);

    if (!picked) {
      try {
        picked = await ctx.runAction(internal.ycloud.selectWhatsappTemplateWithAI, {
          userMessage: args.userMessage,
          conversationSnippet: snippet,
          templatesJson,
        });
      } catch (e) {
        console.error("selectWhatsappTemplateWithAI error:", e);
      }
    }

    if (!picked) {
      console.log(
        "[template-routing] sin match (keywords + IA NONE o error). Plantillas enrutables:",
        routable.length
      );
      return { sent: false };
    }

    const valid = routable.some(
      (t) => t.name === picked!.name && t.language === picked!.language
    );
    if (!valid) {
      console.warn(
        "[template-routing] nombre/idioma inválido respecto a la lista:",
        picked
      );
      return { sent: false };
    }

    console.log("[template-routing] enviando plantilla:", picked.name, picked.language);
    try {
      await ctx.runAction(internal.ycloud.sendWhatsAppTemplateMessage, {
        to: args.phone,
        templateName: picked.name,
        language: picked.language,
        wamid: args.wamid,
      });
    } catch (e) {
      console.error("sendWhatsAppTemplateMessage error:", e);
      return { sent: false };
    }

    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: `[Plantilla WhatsApp: ${picked.name}]`,
      createdAt: Date.now(),
    });

    return { sent: true, templateName: picked.name };
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
  args: {
    userMessage: v.string(),
    conversationSnippet: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CatalogIntent> => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const snippet = (args.conversationSnippet ?? "").trim();

    const { text } = await generateText({
      model: openai.chat("gpt-4o-mini"),
      maxTokens: 300,
      system: `Eres un clasificador. Del mensaje del usuario extrae la intención y datos. Responde SOLO con un JSON válido, sin markdown, sin explicación.

Reglas:
- intent: "single_finca" si pide VER una finca por nombre (ej. "quiero ver villa green", "mostrar la finca X"). En fincaName pon solo el nombre de la finca en minúsculas, sin "finca" ni "la".
- intent: "more_options" si pide otras opciones, más opciones, no le gustan, envía más, otras fincas, dame otras.
- intent: "search_catalog" si pide buscar fincas en una UBICACIÓN y tiene fechas o "fin de semana". Extrae: location (solo nombre del lugar, minúsculas, sin emojis; "mergal" u errores similares a Melgar → location "melgar"), hasWeekend (true si dice fin de semana / este fin / próximo fin / viernes a domingo), dateD1 y dateD2 (números del 1 al 31 si dice "del X al Y"), minCapacity (número si dice "X personas" o "X o más personas"), sortByPrice (true si dice buen precio, económico, barato).
- Si el mensaje ACTUAL es solo confirmación (sí, si, ok, dale, claro, perfecto, va) y en el CONTEXTO del chat ya constan ubicación (ej. melgar, tolima) y además "fin de semana" o fechas o número de personas, devuelve "search_catalog" con location, hasWeekend y minCapacity inferidos de ese contexto (no uses "none" si hay datos claros en el contexto).
- Si pregunta por métodos de pago, datos bancarios, Nequi, PSE, transferencia, firma de contrato o PDF del contrato, devuelve SIEMPRE intent "none" (no catálogo).
- intent: "none" si no aplica ninguna de las anteriores.

Contexto reciente (líneas Cliente/Asistente). Si está vacío, ignóralo:
${snippet || "(vacío)"}

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
        const loc = normalizeCatalogLocation(
          (parsed.location).replace(/[^\wáéíóúñ\s]/gi, "").trim()
        );
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

/** Corrige errores típicos de escritura en ubicaciones (búsqueda / catálogo). */
function normalizeCatalogLocation(location: string): string {
  const t = location.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "mergal" || t === "mergal tolima") return "melgar";
  return location.trim().replace(/\s+/g, " ");
}

/**
 * Solo afirmación corta (confirmación), sin datos nuevos de búsqueda.
 * Evita enrutar plantillas genéricas de catálogo cuando el usuario confirma "sí" a mostrar opciones.
 */
function isAffirmativeOnly(userMessage: string): boolean {
  const t = userMessage
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length > 28) return false;
  return /^(s[ií]|si(\s+se[nñ]or|p)?|ok|okey|dale|claro|va|yes|listo|bueno|uhum|aja|por\s+supuesto|adelante|confirmo|exacto|eso(\s+mismo)?)\.?$/i.test(
    t
  );
}

/** Pregunta por catálogo / opciones (sí debe poder usar contexto fusionado de mensajes anteriores). */
function asksFincasOrCatalogInMessage(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase();
  return /\b(qu[eé]\s+fincas|qu[eé]\s+opciones|fincas\s+tienes|tienen\s+fincas|hay\s+fincas|ver\s+(las\s+)?opciones|m[aá]s\s+opciones|el\s+cat[aá]logo|un\s+cat[aá]logo|mostrar(me)?\s+(las\s+)?opciones)\b/i.test(
    lower
  );
}

/**
 * Mensaje de seguimiento solo con fechas/cupo (sin ubicación en este turno), p.ej. "fin de semana y 12 personas".
 * No usar para fusionar historial si parece pago/contrato (lo filtra el caller).
 */
function messageLooksLikeDateCapacityFollowup(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase();
  const hasWeekend = /\b(fin\s+de\s+semana|este\s+fin|pr[oó]ximo\s+fin|el\s+fin\s+de\s+semana)\b/i.test(
    lower
  );
  const hasPersonas = /\b\d+\s*(?:o\s+mas?\s+)?personas\b/i.test(lower);
  return hasWeekend && hasPersonas;
}

/**
 * No reenviar catálogo de varias fincas: pago, bancos, contrato, etc.
 * Evita que un merge del historial reactive Melgar+finde cuando el usuario ya va por cierre.
 */
function shouldBlockCatalogMultiFincaSearch(userMessage: string): boolean {
  const lower = userMessage
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!lower) return false;
  return (
    /\b(m[eé]todos?\s+de\s+pago|medios?\s+de\s+pago|como\s+pago|c[oó]mo\s+pagar|formas?\s+de\s+pago|aceptan\s+(tarjeta|nequi|pse)|\bpse\b|\bnequi\b|bancari|transferencia|consignaci[oó]n|datos\s+bancar|cuenta(s)?\s+bancar|n[uú]mero\s+de\s+cuenta|abono|saldo\s+(pendiente|restante)|contrato(\s+de)?\s+arrend|firm(ar|e|o)\s+(el\s+)?contrato|pdf\s+del\s+contrato)\b/.test(
      lower
    ) ||
    /\b(qu[eé]\s+metodos|cu[aá]les\s+son\s+los\s+pagos|donde\s+pago|a\s+donde\s+consigno|puedo\s+pagar)\b/.test(
      lower
    )
  );
}

/** Datos tipo formulario de contrato (correo + varios números); no disparar búsqueda de catálogo. */
function looksLikeContractDataSubmission(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!/@\S+\.\S+/.test(t)) return false;
  const digits = (t.match(/\d/g) ?? []).length;
  return digits >= 10;
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
    if (
      shouldBlockCatalogMultiFincaSearch(args.userMessage) ||
      looksLikeContractDataSubmission(args.userMessage)
    ) {
      return { sent: false };
    }

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
  returns: v.object({ sent: v.boolean() }),
  handler: async (ctx, args): Promise<{ sent: boolean }> => {
    const conv = await ctx.runQuery(api.conversations.getById, {
      conversationId: args.conversationId,
    });
    if (!conv) return { sent: false };

    if (
      shouldBlockCatalogMultiFincaSearch(args.userMessage) ||
      looksLikeContractDataSubmission(args.userMessage)
    ) {
      return { sent: false };
    }

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
      let parsed =
        parseLocationAndDates(args.userMessage) ??
        parseSearchFilters(args.userMessage);
      if (!parsed) {
        const allowMergedUserHistory =
          isAffirmativeOnly(args.userMessage) ||
          asksFincasOrCatalogInMessage(args.userMessage) ||
          messageLooksLikeDateCapacityFollowup(args.userMessage);
        if (allowMergedUserHistory) {
          const recent = await ctx.runQuery(api.messages.listRecent, {
            conversationId: args.conversationId,
            limit: 30,
          });
          const merged = recent
            .filter((m) => m.sender === "user")
            .map((m) => m.content)
            .join("\n");
          parsed =
            parseLocationAndDates(merged) ?? parseSearchFilters(merged);
        }
      }
      if (!parsed) return { sent: false };
      location = parsed.location;
      fechaEntrada = parsed.fechaEntrada;
      fechaSalida = parsed.fechaSalida;
      minCapacity = parsed.minCapacity;
      sortByPrice = parsed.sortByPrice;
    }

    location = normalizeCatalogLocation(location);

    const fincas = await ctx.runQuery(api.fincas.searchAvailableByLocationAndDates, {
      location,
      fechaEntrada,
      fechaSalida,
      limit: CATALOG_LIMIT,
      minCapacity,
      excludePropertyIds,
      sortByPrice,
    });

    if (fincas.length === 0) return { sent: false };

    let chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getByLocationKeyword, {
      location,
    });
    if (!chosenCatalog) {
      chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    }
    if (!chosenCatalog) return { sent: false };

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
    if (productRetailerIds.length === 0) return { sent: false };

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

    return { sent: true };
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

/**
 * Extrae datos del cliente y de la reserva analizando el historial de mensajes.
 * Prioriza bloques [CONTRACT_PDF:...] existentes o usa la IA para inferir.
 */
export const extractContractData = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const messages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 30,
    });

    // 1. Intentar encontrar un bloque [CONTRACT_PDF:...] ya generado
    for (const msg of [...messages].reverse()) {
      if (msg.sender === "assistant" && msg.content.includes("[CONTRACT_PDF:")) {
        const tag = "[CONTRACT_PDF:";
        const idx = msg.content.indexOf(tag);
        const jsonStart = msg.content.indexOf("{", idx);
        let jsonEnd = -1;
        if (jsonStart >= 0) {
          let depth = 0;
          for (let i = jsonStart; i < msg.content.length; i++) {
            if (msg.content[i] === "{") depth++;
            else if (msg.content[i] === "}") {
              depth--;
              if (depth === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
        }
        if (jsonEnd > 0) {
          try {
            const parsed = JSON.parse(msg.content.slice(jsonStart, jsonEnd));
            return {
              clientName: String(parsed.nombre || ""),
              clientId: String(parsed.cedula || ""),
              clientPhone: String(parsed.celular || ""),
              clientEmail: String(parsed.correo || ""),
              checkInDate: String(parsed.entrada || ""),
              checkOutDate: String(parsed.salida || ""),
              nightlyPrice: parsed.precioTotal && parsed.noches 
                ? String(Math.round(Number(parsed.precioTotal) / Number(parsed.noches))) 
                : "",
              totalPrice: String(parsed.precioTotal || ""),
              source: "finalized_block",
            };
          } catch (e) {}
        }
      }
    }

    // 2. Usar IA para extraer del historial si no hay bloque final
    const history = messages
      .map((m) => `${m.sender.toUpperCase()}: ${m.content}`)
      .join("\n");

    const { text } = await generateText({
      model: openai.chat("gpt-4o-mini"),
      maxTokens: 500,
      system: `Analiza el historial de chat y extrae los datos del cliente para un contrato de arrendamiento. 
Responde ÚNICAMENTE con un JSON válido. Si no encuentras un valor, pon "".
Campos: 
- nombre (Nombre completo del cliente)
- cedula (Número de identificación)
- celular (Teléfono móvil)
- correo (Email)
- fechaEntrada (YYYY-MM-DD)
- fechaSalida (YYYY-MM-DD)
- noches (Número entero)
- precioTotal (Número entero sin puntos ni comas)`,
      prompt: `Historial de conversación:\n${history}`,
    });

    try {
      const raw = text.trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(raw);
      return {
        clientName: String(parsed.nombre || ""),
        clientId: String(parsed.cedula || ""),
        clientPhone: String(parsed.celular || ""),
        clientEmail: String(parsed.correo || ""),
        checkInDate: String(parsed.fechaEntrada || ""),
        checkOutDate: String(parsed.fechaSalida || ""),
        nightlyPrice: parsed.precioTotal && parsed.noches 
          ? String(Math.round(Number(parsed.precioTotal) / Number(parsed.noches))) 
          : "",
        totalPrice: String(parsed.precioTotal || ""),
        source: "ai_extraction",
      };
    } catch (e) {
      console.error("Error parsing AI extraction:", e);
      return { error: "No se pudieron extraer los datos automáticamente" };
    }
  },
});
