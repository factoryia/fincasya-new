import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import rag from "./rag";
import { CONSULTANT_SYSTEM_PROMPT } from "./lib/consultantPrompt";

/**
 * Solo afirmación corta (confirmación), sin datos nuevos de búsqueda.
 * Evita enrutar plantillas genéricas de catálogo cuando el usuario confirma "sí" a mostrar opciones.
 */
export function isAffirmativeOnly(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w\s]/g, "");
  if (t.length > 50) return false;
  return /^(s[ií]|si(\s+.*)?|ok|okey|dale|claro|va|yes|listo|bueno|uhum|aja|por\s+supuesto|adelante|confirmo|exacto|eso(\s+mismo)?)$/i.test(t);
}

/**
 * Detecta si el mensaje es una respuesta de seguimiento a preguntas sobre mascotas, personal, 
 * eventos o requerimientos de convivencia, para evitar disparar el catálogo erróneamente.
 */
export function isProvidingFollowUpData(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  // Fechas o capacidad
  if (/\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|para\s+\d+|huespedes|personas)\b/i.test(t)) return true;
  // Mascotas
  if (/\b(mascotas?|perros?|gatos?|llevamos|traemos|2 mascot|sin mascot)\b/i.test(t)) return true;
  // Personal / Servicios
  if (/\b(personal|servicio|empleada|cocinera|aseo)\b/i.test(t)) return true;
  // Intención de reserva / Convivencia
  if (/\b(confirmo|de\s+acuerdo|entendido|leido|requerimientos|convivencia)\b/i.test(t)) return true;
  return false;
}

/**
 * Solo respuesta negativa corta (ej. no, nada, ni idea), sin datos nuevos.
 * Evita enrutar plantillas de mascotas/etc cuando el usuario responde "no".
 */
export function isNegativeOnly(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w\s]/g, "");
  if (t.length > 50) return false;
  return /^(no(\s+.*)?|nada|ningun[oa]|tampoco|ni\s+idea|para\s+nada)$/i.test(t);
}

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
      updatedAt: now,
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
      let catalogLocation = "";
      let catalogFincasCount = 0;
      let catalogFoundFincasButFailed = false;
      let catalogIntent: CatalogIntent = { intent: "none" };

      const recentForCatalogIntent = await ctx.runQuery(api.messages.listRecent, {
        conversationId,
        limit: 14,
      });
      const catalogIntentSnippet = recentForCatalogIntent
        .map(
          (m: any) =>
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
      // PERO NO re-enviar si el usuario está dando datos de seguimiento (fechas, personas) SIN mencionar finca
      const followUpData = isProvidingFollowUpData(args.text) 
        && catalogIntent.intent !== "single_finca";
      try {
        if (!followUpData) {
          const result = await ctx.runAction(
            internal.ycloud.maybeSendSingleFincaCatalogForUserMessage,
            {
              phone: args.phone,
              conversationId,
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
        }
      } catch (e) {
        console.error("YCloud single-finca catalog error:", e);
      }

      try {
        if (!singleFincaSent) {
          console.log("[catalog-intent]", JSON.stringify(catalogIntent));
          // Validar que la ubicación de search_catalog no sea una palabra genérica
          const invalidSearchLocations = /\b(dias?|personas?|fincas?|reservar?|noches?|una|los|las|el|la)\b/i;
          const catalogIntentArg =
            catalogIntent.intent === "more_options"
              ? catalogIntent
              : catalogIntent.intent === "search_catalog" && 
                catalogIntent.location &&
                catalogIntent.location.length >= 3 &&
                !invalidSearchLocations.test(catalogIntent.location)
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
          catalogLocation = catalogRes?.location ?? "";
          catalogFincasCount = catalogRes?.fincasCount ?? 0;
          if (!whatsappCatalogSentForSearch && catalogRes?.fincasFoundButNoCatalog) {
            catalogFoundFincasButFailed = true;
            catalogLocation = catalogRes.location ?? "";
            catalogFincasCount = catalogRes.fincasCount ?? 0;
          }
        }
      } catch (e) {
        console.error("YCloud catalog send error:", e);
      }

      // FALLBACK: si el catálogo NO se envió pero el usuario menciona una ciudad conocida,
      // forzar el envío del catálogo con esa ciudad usando fechas del próximo fin de semana.
      // IMPORTANTE: no aplicar este fallback cuando el usuario pidió una finca específica,
      // para no reemplazar la intención "single_finca" por un catálogo general de ciudad.
      if (
        !whatsappCatalogSentForSearch &&
        !singleFincaSent &&
        catalogIntent.intent !== "single_finca"
      ) {
        const dynamicLocationsList_pre = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});
        const msgLower_pre = args.text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        const matchedCity = dynamicLocationsList_pre.find(
          (loc: string) => msgLower_pre.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""))
        );
        if (matchedCity) {
          console.log("[catalog-fallback] Ciudad detectada sin catálogo, forzando envío:", matchedCity);
          try {
            const catalogRes = await ctx.runAction(
              internal.ycloud.maybeSendCatalogForUserMessage,
              {
                conversationId,
                phone: args.phone,
                userMessage: args.text,
                wamid: args.wamid,
                catalogIntent: {
                  intent: "search_catalog" as const,
                  location: matchedCity,
                  hasWeekend: true,
                },
              }
            );
            whatsappCatalogSentForSearch = catalogRes?.sent ?? false;
            catalogLocation = catalogRes?.location ?? matchedCity;
            catalogFincasCount = catalogRes?.fincasCount ?? 0;
            if (!whatsappCatalogSentForSearch && catalogRes?.fincasFoundButNoCatalog) {
              catalogFoundFincasButFailed = true;
            }
          } catch (e) {
            console.error("YCloud catalog fallback error:", e);
          }
        }
      }

      // Plantillas: no pisar el flujo cuando ya mandamos catálogo interactivo, el cliente pide finca específica, o envía datos.
      let templateSent = false;
      const isProvidingData = /\\d{7,}/.test(args.text) || /@\\w+\\.\\w+/.test(args.text);
      const isSpecificFinca = singleFincaSent || catalogIntent.intent === "single_finca";
      
      // Detectar si el usuario menciona una ubicación o datos de reserva (no enviar template genérica)
      const dynamicLocationsList = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});
      const msgLower = args.text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const mentionsCityOrFinca = dynamicLocationsList.some(
        (loc: string) => msgLower.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""))
      );
      const mentionsDatesOrPersonas = /\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|personas?|fin de semana)\b/i.test(args.text);
      // También detectar intención de reserva con ubicación: "finca en X", "reservar en X"
      const mentionsBookingIntent = /\b(reservar|alquilar|arrendar|finca\s+en|fincas\s+en|fincas\s+de|finca\s+de|finca\s+para)\b/i.test(args.text);
      const hasBookingContext = mentionsCityOrFinca || mentionsDatesOrPersonas || mentionsBookingIntent;
      
      console.log("[template-guard]", {
        mentionsCityOrFinca,
        mentionsDatesOrPersonas,
        mentionsBookingIntent,
        hasBookingContext,
        whatsappCatalogSentForSearch,
        isSpecificFinca,
        willBlockTemplate: whatsappCatalogSentForSearch || isSpecificFinca || isProvidingData || hasBookingContext,
      });
      
      if (!whatsappCatalogSentForSearch && !isSpecificFinca && !isProvidingData && !hasBookingContext) {
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
      // Reutilizar dynamicLocationsList ya declarado arriba (template-guard)
      const dynamicLocations = dynamicLocationsList.join(", ");

      const replyText = await ctx.runAction(
        internal.ycloud.generateReplyWithRagAndFincas,
        {
          conversationId,
          userMessage: args.text,
          singleFincaCatalogSent: singleFincaSent,
          fincaTitle,
          searchQueryOverride: searchOverride,
          whatsappCatalogSentForSearch,
          dynamicLocations,
          catalogLocation,
          catalogFincasCount,
          catalogFoundFincasButFailed,
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
              // Extraer datos para el sistema (aunque no enviemos PDF automático, se escalará a humano)
              const ciudad = String(parsed.ciudad ?? "");
              const direccion = String(parsed.direccion ?? "");
              const entradaHora = String(parsed.entradaHora ?? "");
              const salidaHora = String(parsed.salidaHora ?? "");
              
              const cleanReplyText = replyText.split(tag)[0].trim();

              const PAYMENT_PROCESS_TEXT = `👨‍💻 Proceso de reserva:

1. Documentación: Te enviamos el contrato y nuestro respaldo legal para tu revisión 📄.
2. Reserva: Realizas el abono del 50% del valor total para separar la fecha 💰.
3. Confirmación: Validamos tu pago y recibes el soporte oficial junto a la ubicación de la finca ✅.

❗Nuestro RNT es 163658, disponible para consulta y verificación.

En FincasYa.com tu alquiler siempre es seguro, respaldado y con total tranquilidad. ®`;

              // Si el texto limpio ya contiene el mensaje de proceso de pago, enviarlo tal cual.
              // Si no lo contiene (la IA lo olvidó), agregar el mensaje de proceso como segundo mensaje.
              const alreadyHasPaymentInfo = cleanReplyText.includes("RNT") || cleanReplyText.includes("50%") || cleanReplyText.includes("Proceso de reserva");

              const textToSend = cleanReplyText
                ? (alreadyHasPaymentInfo
                    ? cleanReplyText
                    : `${cleanReplyText}\n\n${PAYMENT_PROCESS_TEXT}`)
                : `¡Listo! He recibido todos tus datos para la reserva. ✨\n\n${PAYMENT_PROCESS_TEXT}`;

              // Enviar el mensaje visible del asistente (sin el bloque técnico)
              await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
                to: args.phone,
                text: textToSend,
                wamid: args.wamid,
              });

              // Escalar a humano (la IA ya hizo su trabajo de recolectar datos)
              await ctx.runMutation(internal.conversations.escalate, {
                conversationId,
              });

              /* 
              // DESACTIVADO: Envío automático de PDF por solicitud de QA. 
              // Se deja el código como referencia por si se requiere reactivar.
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
                    ciudad,
                    direccion,
                    entrada: String(parsed.entrada ?? ""),
                    salida: String(parsed.salida ?? ""),
                    noches: Number(parsed.noches) || 0,
                    precioTotal: Number(parsed.precioTotal) || 0,
                  },
                  paymentMessageText:
                    paymentMessageText ||
                    "MÉTODOS DE PAGO: Abono 50% para confirmar. Saldo 50% al recibir la finca. Nequi, PSE, transferencia o datos bancarios. ✨",
                }
              );
              */
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
            // Safety: if the reply contains payment/booking confirmation indicators
            // but the JSON tag was missing, escalate to human anyway.
            const isBookingClosing =
              replyText.includes("RNT") ||
              replyText.includes("Proceso de reserva") ||
              replyText.includes("50% del valor") ||
              replyText.includes("163658");
            if (isBookingClosing) {
              await ctx.runMutation(internal.conversations.escalate, {
                conversationId,
              });
            }
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
    /** Lista de ubicaciones separadas por coma para el prompt. */
    dynamicLocations: v.optional(v.string()),
    /** Ciudad/municipio del catálogo enviado. */
    catalogLocation: v.optional(v.string()),
    /** Número de fincas enviadas en el catálogo. */
    catalogFincasCount: v.optional(v.number()),
    /** True si se encontraron fincas pero no se pudo enviar el catálogo (sin productRetailerIds). En este caso el AI puede listar las fincas en texto. */
    catalogFoundFincasButFailed: v.optional(v.boolean()),
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

    const recentMessages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 14,
    });

    let fincasContext: string;
    const catalogFailed = args.catalogFoundFincasButFailed === true;
    if (catalogAlreadyShown && args.catalogLocation) {
      fincasContext = `(El sistema YA ENVIÓ EXITOSAMENTE el catálogo interactivo de WhatsApp con ${args.catalogFincasCount || "varias"} fincas disponibles en ${args.catalogLocation}. El cliente ya puede ver nombres, fotos y precios directamente en su pantalla. Responde siguiendo EXACTAMENTE el formato del PASO 2: menciona que compartiste el catálogo en ${args.catalogLocation}, y luego pide los datos faltantes con viñetas: ● 🏡 ¿Cuál de estas fincas te llamó la atención? ● 📅 Fechas exactas de tu estadía ● 👨‍👩‍👧‍👦 Número total de personas ● 🐾 ¿Llevarán mascotas? Omite los datos que el cliente ya haya proporcionado, pero SIEMPRE incluye la pregunta de finca y mascotas. NO repitas lista de fincas en texto. Termina con "Quedo atento a tu respuesta. 😊")`;
    } else if (catalogAlreadyShown) {
      fincasContext = "(Ya se envió el catálogo de WhatsApp con las fincas; el cliente ve nombres, fotos y precios ahí. Sigue el PASO 2: pregunta cuál finca le llamó la atención, fechas, personas y mascotas. NO repitas lista de fincas en texto.)";
    } else if (catalogFailed && fincasList.length > 0) {
      // El catálogo interactivo de WhatsApp NO pudo enviarse (las fincas no están registradas en el catálogo de Meta).
      // En este caso excepcional, la IA DEBE describir las fincas disponibles en texto.
      fincasContext = `⚠️ MODO FALLBACK (catálogo interactivo NO disponible para esta ciudad): El sistema intentó enviar el catálogo de WhatsApp pero las fincas no están registradas en el catálogo de Meta. DEBES mencionar en texto las fincas disponibles con sus precios (excepción a la regla de no listar). Fincas encontradas:\n${formatFincasForPrompt(fincasList)}`;
    } else {
      fincasContext = formatFincasForPrompt(fincasList);
    }

    // Enriquecer con reglas de temporada y precios por finca (siempre, no solo cuando hay fechas en el mensaje actual)
    if (fincasList.length > 0 && !catalogAlreadyShown) {
      // Buscar fechas en el mensaje actual Y en los mensajes recientes de la conversación
      const fullConversationText = [
        ...recentMessages.map((m: any) => m.content),
        args.userMessage,
      ].join(" ");

      const monthNames: Record<string, number> = { enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11 };
      const dateMatch = fullConversationText.match(/(?:del\s+)?(\d{1,2})\s*(?:al|hasta el|hasta)\s*(\d{1,2})/i);
      const monthMatch = fullConversationText.match(/(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i);
      const now = new Date();
      let checkDateMMDD: string | null = null;
      if (dateMatch) {
        const d1 = parseInt(dateMatch[1], 10);
        const month = monthMatch ? monthNames[monthMatch[1].toLowerCase()] ?? now.getMonth() : now.getMonth();
        checkDateMMDD = `${String(month + 1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`;
      }

      const pricingBlocks: string[] = [];
      const availabilityBlocks: string[] = [];

      for (const finca of fincasList.slice(0, 8)) {
        // 1. Precios y Temporadas
        try {
          const rules = await ctx.runQuery(api.fincas.getPropertyPricingRules, {
            propertyId: finca._id as any,
          });
          if (rules.length > 0) {
            // Determinar precio aplicable si hay fechas detectadas
            let precioAplicable: string | null = null;
            if (checkDateMMDD) {
              const aplicable = rules.find((r: any) => {
                if (r.fechaDesde && r.fechaHasta) {
                  if (r.fechaDesde <= r.fechaHasta) {
                    return checkDateMMDD! >= r.fechaDesde && checkDateMMDD! <= r.fechaHasta;
                  } else {
                    return checkDateMMDD! >= r.fechaDesde || checkDateMMDD! <= r.fechaHasta;
                  }
                }
                if (r.fechas?.length) return r.fechas.includes(checkDateMMDD);
                return false;
              });
              if (aplicable?.valorUnico) {
                precioAplicable = `$${aplicable.valorUnico.toLocaleString("es-CO")}/noche (Temporada: ${aplicable.nombre})`;
              }
            }

            const reglaLines = rules.map((r: any) => {
              const rango = r.fechaDesde && r.fechaHasta
                ? `${r.fechaDesde} al ${r.fechaHasta}`
                : r.fechas?.length
                  ? `fechas: ${r.fechas.join(", ")}`
                  : "sin rango";
              const precio = r.valorUnico ? `$${r.valorUnico.toLocaleString("es-CO")}/noche` : "precio base";
              const cond = r.condiciones ? ` | Condiciones: ${r.condiciones}` : "";
              return `  - ${r.nombre} (${rango}): ${precio}${cond}`;
            }).join("\n");

            let block = `📋 Temporadas de ${finca.title}:\n${reglaLines}`;
            if (precioAplicable) {
              block += `\n  ⚠️ PRECIO APLICABLE PARA LAS FECHAS DEL CLIENTE: ${precioAplicable}. USA ESTE PRECIO.`;
            }
            pricingBlocks.push(block);
          }
        } catch (e) {
          console.log("[pricing] Error fetching seasonal rules for", finca.title, e);
        }

        // 2. Disponibilidad (Calendario)
        try {
          const availability = await ctx.runQuery(api.fincas.getPropertyAvailability, {
            propertyId: finca._id as any,
            monthsAhead: 3,
          });
          if (availability.length > 0) {
            const busyLines = availability.map((b: any) => {
              const d1 = new Date(b.fechaEntrada).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
              const d2 = new Date(b.fechaSalida).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
              return `  - [${d1} al ${d2}] (${b.reason})`;
            }).join("\n");
            availabilityBlocks.push(`🗓️ CALENDARIO DE OCUPACIÓN (${finca.title}):\n${busyLines}`);
          } else {
            availabilityBlocks.push(`🗓️ CALENDARIO DE OCUPACIÓN (${finca.title}): Totalmente disponible por ahora.`);
          }
        } catch (e) {
          console.log("[availability] Error fetching availability for", finca.title, e);
        }
      }

      if (pricingBlocks.length > 0) {
        fincasContext += `\n\n## 📅 REGLAS DE TEMPORADA Y PRECIOS POR FINCA\n${pricingBlocks.join("\n\n")}\n\nUSA siempre el PRECIO APLICABLE marcado con ⚠️ si existe. Si no, usa el precio Base de la finca. NUNCA inventes precios.`;
      } else {
        fincasContext += `\n\n⚠️ **INSTRUCCIÓN DE PRECIOS:** SIEMPRE usa el precio Base que aparece en cada finca. NUNCA inventes un precio diferente al que está en los datos.`;
      }

      if (availabilityBlocks.length > 0) {
        fincasContext += `\n\n## 🏘️ DISPONIBILIDAD (FECHAS RESERVADAS/OCUPADAS)\n${availabilityBlocks.join("\n\n")}\n\n**IMPORTANTE:** Si el cliente solicita fechas que se solapan con las ocupadas arribas, infórmale que la finca NO está disponible para esos días de forma amable. **PROHIBIDO** dar detalles de quién hizo la reserva.`;
      }
    }

    const currentDate = new Date().toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = buildSystemPrompt(ragResult.text, fincasContext, {
      singleFincaCatalogSent: args.singleFincaCatalogSent ?? false,
      fincaTitle: args.fincaTitle ?? "",
      whatsappCatalogSentForSearch: catalogAlreadyShown,
      catalogFoundFincasButFailed: catalogFailed,
      currentDate,
      dynamicLocations: args.dynamicLocations,
    });
    const messages = recentMessages.map((m: any) => ({
      role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    const { text } = await generateText({
      model: openai.chat("gpt-5-mini"),
      temperature: 1,
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
        `- ${p.title} (ID: ${p._id}): ${p.description ?? ""} | Ubicación: ${p.location ?? "N/A"} | Capacidad: ${p.capacity ?? "N/A"} personas | Precio base/noche: $${(p.priceBase ?? 0).toLocaleString("es-CO")}`
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
    catalogFoundFincasButFailed?: boolean;
    currentDate?: string;
    dynamicLocations?: string;
  }
): string {
  let basePrompt = CONSULTANT_SYSTEM_PROMPT;
  
  // Reemplazo dinámico o limpieza del listado de ciudades
  if (opts?.dynamicLocations) {
    basePrompt = basePrompt.replace(/{DYNAMIC_LOCATIONS_LIST}/g, opts.dynamicLocations);
  } else {
    // Si no se provee la lista (porque ya hay ubicación), reemplazar con algo genérico o vacío para que no use el placeholder literal
    basePrompt = basePrompt.replace(/{DYNAMIC_LOCATIONS_LIST}/g, "nuestros destinos disponibles");
  }

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
## 🚫 PROHIBICIÓN ABSOLUTA: NO LISTAR FINCAS EN TEXTO
**AHORA MISMO:** El sistema YA ENVIÓ el **catálogo interactivo de WhatsApp** con TODAS las fincas disponibles (tarjetas con fotos, precios y detalles). El cliente ya las puede ver en su pantalla.

**ESTÁ TERMINANTEMENTE PROHIBIDO:**
- Escribir listas numeradas (1. 2. 3.) con nombres de fincas
- Escribir listas con viñetas (*Finca X*: descripción)
- Mencionar nombres de fincas específicas con descripciones
- Decir "Aquí tienes algunas opciones:" seguido de una lista
- Copiar o resumir el contenido del catálogo en texto

**LO ÚNICO QUE DEBES HACER:** Responder con 1-2 líneas MÁXIMO confirmando que enviaste el catálogo e invitando a elegir.
**EJEMPLO CORRECTO:** "¡Claro que sí! Te compartí el catálogo con las opciones de fincas disponibles en [Ciudad] para tus fechas. Dime cuál de estas fincas prefieres reservar. 🏡✨"
**EJEMPLO INCORRECTO (NUNCA HAGAS ESTO):** "Aquí tienes algunas opciones: 1. *Finca X*: Capacidad para... 2. *Finca Y*: Ideal para..."
`
    : "";

  const variasFincasTextoRule = opts?.catalogFoundFincasButFailed
    ? "**MODO FALLBACK ACTIVO:** El catálogo interactivo de WhatsApp NO está disponible para esta ciudad (fincas no registradas en Meta). EXCEPCIÓN: DEBES listar en texto las fincas disponibles con nombre, capacidad y precio base. Usa viñetas simples. Después pregunta cuál le interesa."
    : "**REGLA ABSOLUTA: NUNCA listes nombres de fincas en texto, con o sin catálogo enviado. El catálogo interactivo de WhatsApp muestra todas las propiedades con fotos, precios y detalles. Si no fue enviado aún, el sistema lo enviará por separado. Tu respuesta de texto debe ser SOLO confirmación breve + pregunta concreta.**";

  const dynamicLocationsText = opts?.dynamicLocations 
    ? `\n**UBICACIONES DISPONIBLES EN TIEMPO REAL:** ${opts.dynamicLocations}`
    : "";

  const priorityInstructions = `
---
## ⚠️ INSTRUCCIONES DE PRIORIDAD MÁXIMA (OVERRIDE)
1. **PASO 1 (Ubicación Faltante):** Si el usuario te da fechas/personas pero NO ubicación, DEBES preguntar únicamente "¿En qué ciudad o municipio te gustaría reservar? 🏡". PROHIBIDO listar ciudades disponibles.
2. **CATÁLOGO ENVIADO = NO LISTAR EN TEXTO:** Si el CONTEXTO DE FINCAS dice que "YA ENVIÓ EXITOSAMENTE el catálogo", tu mensaje debe ser SOLO 1-2 líneas confirmando el envío. NUNCA listes fincas en texto.
3. **DESTINOS CERCANOS:** Si el cliente pide una ciudad sin fincas, sugiere destinos cercanos usando la lista UBICACIONES DISPONIBLES (mencionando solo 3-5 opciones relevantes geográficamente).
4. **PRECIOS DE TEMPORADA:** Si en el CONTEXTO DE FINCAS aparecen REGLAS DE TEMPORADA para una finca, DEBES usar el valorUnico de la temporada que aplique a las fechas del cliente. Si no aplica ninguna temporada, usa el precio Base.
`;

  return `${basePrompt}${dynamicLocationsText}${priorityInstructions}${singleFincaHint}${multiCatalogHint}

---
## REGLA DE LISTAS DE FINCAS
${variasFincasTextoRule}

---
## CONTEXTO RAG (Base de Conocimiento)
${ragContext}

## CONTEXTO DE FINCAS (Resultados de búsqueda)
${fincasContext}

## FECHA ACTUAL: ${opts?.currentDate ?? "No especificada"}
---
## CONTEXTO ACTUAL (Usa SOLO esta información para datos concretos)
`;
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
      text: { body: args.text.replace(/\[CONTRACT_PDF:.*?\]/g, "").trim() },
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
  body?: string;
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
    const bodyText = t.components?.find((c) => c.type === "BODY")?.text || "";
    out.push({
      name: t.name,
      language: lang,
      hint: buildIntentHintFromName(t.name),
      body: bodyText,
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
      model: openai.chat("gpt-5-mini"),
      temperature: 1,
      system: `Eres un enrutador para WhatsApp.
Decides si el mensaje encaja con UNA plantilla de la lista (preguntas frecuentes con respuesta fija).
Cada ítem tiene "hint": palabras clave del tema (no es el texto de la plantilla).

Responde SOLO JSON válido, sin markdown:

{"choice":"NONE"}

o

{"choice":"TEMPLATE","name":"<nombre_exacto>","language":"<idioma_exacto>"}

Reglas:
- TEMPLATE: cualquier mensaje que encaje con una plantilla de la lista (nombre + hint), incluidas **bienvenida** para saludos genéricos.
- TEMPLATE: preguntas de política/FAQ (mascotas, check-in, cobro por persona, contrato, proceso de pago, etc.).
- NONE: SI EL USUARIO RESPONDE DANDO FECHAS (ej. "del 27 al 30 de marzo", "el próximo fin de semana") o CANTIDAD DE PERSONAS (ej. "para 2 personas", "somos 5 adultos"). El RAG debe encargarse de esto, NO envíes plantillas en respuestas de cotización o recolección de datos de reserva.
- NONE: mensaje con ubicación + fechas + personas para buscar catálogo, elige una finca por nombre concreto, envía datos personales para contrato, o ninguna plantilla encaja.
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

    if (isAffirmativeOnly(args.userMessage) || isNegativeOnly(args.userMessage)) {
      console.log(
        "[template-routing] solo afirmación/negación (sí/no); no enviar plantilla"
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
        (m: any) =>
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

    const pickedTemplate = routable.find(
      (t) => t.name === picked!.name && t.language === picked!.language
    );

    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: pickedTemplate?.body || `[Plantilla WhatsApp: ${picked.name}]`,
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
      model: openai.chat("gpt-5-mini"),
      temperature: 1,
      system: `Eres un clasificador. Del mensaje del usuario extrae la intención y datos. Responde SOLO con un JSON válido, sin markdown, sin explicación.

Reglas:
- intent: "single_finca" si pide VER o RESERVAR una finca específica por nombre (ej. "quiero ver villa green", "me gustaría reservar la finca X", "quinto la finca X", "esta es la finca que elegí"). También si el mensaje es una confirmación de datos (fechas/personas) para una finca mencionada justo antes en el chat. En fincaName pon solo el nombre de la finca en minúsculas, sin "finca" ni "la".
- intent: "more_options" si pide otras opciones, más opciones, no le gustan, envía más, otras fincas, dame otras.
- intent: "search_catalog" SOLO SI MENCIONA EXPLÍCITAMENTE UN MUNICIPIO O CIUDAD (ej. Villeta, Melgar, etc.). Si el usuario pide "una finca" pero NO EXPRESA NINGUNA CIUDAD NI FINCA, DEBES DEVOLVER intent "none". Extrae: location (solo nombre del lugar, minúsculas, sin emojis; "mergal" u errores similares a Melgar → location "melgar"), hasWeekend (true si dice fin de semana / este fin / próximo fin / viernes a domingo), dateD1 y dateD2 (números del 1 al 31 si dice "del X al Y"), minCapacity (número si dice "X personas" o "X o más personas"), sortByPrice (true si dice buen precio, económico, barato).
- Si el mensaje ACTUAL es solo confirmación (sí, si, ok, dale, por favor, procede, claro, listo): Analiza el CONTEXTO para determinar qué confirma el usuario. CASOS: (1) Si el Asistente preguntó "¿Te gustaría ver/mostrar las fincas en [Ciudad]?" o "¿Te gustaría que te muestre opciones en [Ciudad]?" → devuelve search_catalog con esa ciudad inferida del contexto. (2) Si el Asistente preguntó "¿Te gustaría avanzar con la reserva?" o "¿Deseas continuar?" → devuelve "none". (3) Si el Asistente solicitó datos del contrato → devuelve "none". (4) Si hay ubicación en el contexto y el asistente estaba enviando/mostrando catálogo de fincas → devuelve search_catalog con esa ubicación. Si no se puede inferir la ciudad, devuelve "none".
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

Ejemplos con confirmación:
Contexto: "Asistente: Perfecto, ¿te gustaría que te muestre las fincas en Villeta? | Cliente: Si por favor" → {"intent":"search_catalog","location":"villeta"}
Contexto: "Asistente: ¿Te gustaría avanzar con la reserva? | Cliente: Si" → {"intent":"none"}
Contexto: "Asistente: Para elaborar el contrato necesito tus datos... | Cliente: Sí claro" → {"intent":"none"}

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
  // Palabras que NO son ubicaciones válidas (evitar false positives como "los dias", "dos personas", etc.)
  const invalidLocations = new Set([
    "los dias", "los días", "el dia", "el día", "dos personas", "las personas",
    "una finca", "la finca", "los dias", "este fin", "el fin",
    "mi", "tu", "su", "un", "una", "el", "la", "los", "las",
  ]);
  // Ubicación: "en X" (preferido) o "para X" (solo si X parece una ciudad)
  const locationMatchEn = msg.match(/(?:en|de)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|\s+una|\s+la|,|$)/i);
  const locationMatchPara = msg.match(/(?:para)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|$)/i);
  const locationMatch = locationMatchEn || locationMatchPara;
  const location = locationMatch ? locationMatch[1].trim().replace(/\s+/g, " ") : "";
  // Fechas: "del 20 al 21" o "20 al 21"
  const dateMatch = msg.match(/(?:del\s+)?(\d{1,2})\s*(?:al|hasta el|hasta)\s*(\d{1,2})/i);
  if (!location || !dateMatch) return null;
  // Validar que la ubicación no sea una palabra genérica
  if (invalidLocations.has(location) || location.length < 3) return null;
  // Rechazar si la "ubicación" contiene palabras claramente no-geográficas
  if (/\b(dias?|personas?|fincas?|reservar?|noches?)\b/i.test(location)) return null;
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
    ) ||
    // Bloquear si responde a preguntas de seguimiento (mascotas/servicio)
    /\b(mascotas?|perros?|personal|servicio|empleada|convivencia|requerimientos|sonido|decoracion)\b/i.test(lower)
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
    conversationId: v.id("conversations"),
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

    const searchTerm = args.extractedFincaName?.trim();
    if (!searchTerm) return { sent: false };
    console.log("[single-finca] buscando:", searchTerm);

    const fincaToSend = await ctx.runQuery(api.fincas.findBySearchTerm, {
      term: searchTerm,
    });
    if (!fincaToSend) {
      console.log("[single-finca] sin resultados para:", searchTerm, "abortando");
      return { sent: false };
    }

    const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    if (!catalog) {
      console.log("[single-finca] sin catálogo por defecto, abortando");
      return { sent: false };
    }

    console.log("[single-finca] finca seleccionada:", fincaToSend.title);

    const productEntries = await ctx.runQuery(
      api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
      { catalogId: catalog._id, propertyIds: [fincaToSend._id] }
    );

    let productRetailerIdToUse: string;
    if (productEntries.length > 0) {
      productRetailerIdToUse = productEntries[0].productRetailerId;
    } else {
      // Fallback: use Convex ID directly — works when the finca was synced to Meta with its Convex ID.
      console.log("[single-finca] sin product entries para", fincaToSend.title, "usando ID directo como fallback");
      productRetailerIdToUse = fincaToSend._id;
    }

    await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
      to: args.phone,
      productRetailerIds: [productRetailerIdToUse],
      bodyText: `Aquí está ${fincaToSend.title} 🏡`,
      catalogId: catalog.whatsappCatalogId,
      wamid: args.wamid,
    });

    // Obtener la primera imagen para los metadatos
    const firstImage = await ctx.runQuery(api.fincas.getPropertyImage, { 
      propertyId: fincaToSend._id 
    });

    await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
      conversationId: args.conversationId,
      content: `Catálogo enviado: ${fincaToSend.title}`,
      type: "product",
      metadata: {
        product: {
          title: fincaToSend.title,
          image: firstImage?.url || "",
          price: fincaToSend.priceBase,
          slug: fincaToSend.slug || fincaToSend.code || fincaToSend._id,
        }
      },
      createdAt: Date.now(),
    });
    return { sent: true, fincaTitle: fincaToSend.title };
  },
});

const CATALOG_LIMIT = 30;

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
  returns: v.object({ sent: v.boolean(), location: v.optional(v.string()), fincasCount: v.optional(v.number()), fincasFoundButNoCatalog: v.optional(v.boolean()) }),
  handler: async (ctx, args): Promise<{ sent: boolean; location?: string; fincasCount?: number; fincasFoundButNoCatalog?: boolean }> => {
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
        // NUNCA re-disparar catálogo con "sí" / confirmación. Solo con preguntas explícitas.
        const allowMergedUserHistory =
          asksFincasOrCatalogInMessage(args.userMessage) ||
          messageLooksLikeDateCapacityFollowup(args.userMessage);
        if (allowMergedUserHistory) {
          // Verificar que NO estamos en flujo de cierre (cotización/contrato)
          const recentMsgs = await ctx.runQuery(api.messages.listRecent, {
            conversationId: args.conversationId,
            limit: 5,
          });
          const lastAssistant = recentMsgs.find((m: any) => m.sender === "assistant");
          const isInClosingFlow = lastAssistant && (
            /avancemos con la reserva|elaborar tu contrato|datos de la persona/i.test(lastAssistant.content)
          );
          if (!isInClosingFlow) {
            const recent = await ctx.runQuery(api.messages.listRecent, {
              conversationId: args.conversationId,
              limit: 30,
            });
            const merged = recent
              .filter((m: any) => m.sender === "user")
              .map((m: any) => m.content)
              .join("\n");
            parsed =
              parseLocationAndDates(merged) ?? parseSearchFilters(merged);
          }
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
    console.log("[catalog-search] location:", location, "fincas encontradas (antes de catálogo):", fincas.length);

    if (fincas.length === 0) return { sent: false, location };

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
        propertyIds: fincas.map((f: any) => f._id),
      }
    );
    if (productEntries.length === 0) {
      const defaultCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
      if (defaultCatalog && defaultCatalog._id !== chosenCatalog._id) {
        chosenCatalog = defaultCatalog;
        productEntries = await ctx.runQuery(
          api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
          { catalogId: chosenCatalog._id, propertyIds: fincas.map((f: any) => f._id) }
        );
      }
    }
    // Per-finca fallback: use catalog productRetailerId if registered, else use the Convex ID.
    // This ensures ALL found fincas appear in the catalog, not just those with catalog entries.
    const catalogEntryMap = new Map(productEntries.map((e: any) => [e.propertyId as string, e.productRetailerId]));
    const productRetailerIds = fincas.map((f: any) => catalogEntryMap.get(f._id) ?? (f._id as string));
    if (catalogEntryMap.size === 0) {
      console.log("[catalog-search] sin entries en propertyWhatsAppCatalog, usando IDs de Convex como fallback:", productRetailerIds.length);
    } else if (catalogEntryMap.size < fincas.length) {
      console.log("[catalog-search] fallback parcial: ", catalogEntryMap.size, "con entrada,", fincas.length - catalogEntryMap.size, "con ID Convex");
    }

    const bodyText = excludePropertyIds?.length
      ? "Aquí tienes más opciones con los mismos filtros:"
      : "Estas son las fincas disponibles para tus fechas:";

    await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
      to: args.phone,
      productRetailerIds,
      bodyText,
      catalogId: chosenCatalog.whatsappCatalogId,
      wamid: args.wamid,
    });

    await ctx.runMutation(internal.conversations.setLastCatalogSent, {
      conversationId: args.conversationId,
      propertyIds: fincas.map((f: any) => f._id),
      location,
      fechaEntrada,
      fechaSalida,
      minCapacity,
      sortByPrice,
    });

    await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
      conversationId: args.conversationId,
      content: bodyText,
      type: "product",
      metadata: {
        catalog: fincas.slice(0, 3).map((f: any) => ({
          title: f.title,
          image: f.image,
          price: f.priceBase,
          slug: f.slug || f.code || f._id,
        }))
      },
      createdAt: Date.now(),
    });

    return { sent: true, location, fincasCount: productRetailerIds.length };
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
  handler: async (ctx, args): Promise<any> => {
    const messages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 30,
    });

    // Helper para normalizar los datos extraídos
    const normalizeData = async (parsed: any, historyMessages: any[]): Promise<any> => {
      const currentYear = new Date().getFullYear();
      const fixYear = (d: string) => {
        if (!d) return d;
        const match = d.match(/^(\d{4})-(.*)/);
        if (match && Number(match[1]) < currentYear) {
          return `${currentYear}-${match[2]}`;
        }
        return d;
      };

      // Resolución de propiedad
      let resolvedPropertyId = String(parsed.propertyId || "");
      if (!resolvedPropertyId || !resolvedPropertyId.includes(":")) {
        const fincaName = String(parsed.finca || parsed.fincaName || "");
        const searchTerms = [resolvedPropertyId, fincaName].filter(
          (t) => t && t.length > 2,
        );
        for (const term of searchTerms) {
          const found = await ctx.runQuery(api.fincas.findBySearchTerm, {
            term,
          });
          if (found) {
            resolvedPropertyId = found._id;
            break;
          }
        }
      }

      // Datos de contacto existentes
      const conv: any = await ctx.runQuery(api.conversations.getById, {
        conversationId: args.conversationId,
      });
      const contact: any = conv
        ? await ctx.runQuery(api.contacts.getById, {
            contactId: conv.contactId,
          })
        : null;

      // Intentar extraer numeroPersonas de la historia si falta en el JSON
      let numeroPersonas = Number(parsed.numeroPersonas || parsed.personas || 0);
      if (numeroPersonas === 0 && historyMessages.length > 0) {
        // Buscar en los últimos mensajes (orden cronológico)
        for (const msg of [...historyMessages].reverse()) {
          const text = msg.content.toLowerCase();
          // Regex para: "Huéspedes: 10", "10 personas", "pax: 8", "para 5 personas"
          const match = text.match(/(?:huéspedes|personas|pax|cupo)(?:\s*[:\-]\s*|\s+)(\d{1,2})/i) 
                     || text.match(/(\d{1,2})\s+(?:personas|adultos|huéspedes)/i);
          if (match) {
            numeroPersonas = parseInt(match[1], 10);
            break;
          }
        }
      }

      return {
        clientName: String(
          parsed.nombre || parsed.clientName || contact?.name || "",
        ),
        clientId: String(
          parsed.cedula || parsed.clientId || contact?.cedula || "",
        ),
        clientPhone: String(
          parsed.celular || parsed.clientPhone || contact?.phone || "",
        ),
        clientEmail: String(
          parsed.correo || parsed.clientEmail || contact?.email || "",
        ),
        clientCity: String(
          parsed.ciudad || parsed.clientCity || contact?.city || "",
        ),
        clientAddress: String(parsed.direccion || parsed.clientAddress || ""),
        checkInDate: fixYear(
          String(parsed.entrada || parsed.checkInDate || ""),
        ),
        checkOutDate: fixYear(
          String(parsed.salida || parsed.checkOutDate || ""),
        ),
        checkInTime: formatTimeTo24h(
          String(parsed.entradaHora || parsed.checkInTime || ""),
        ),
        checkOutTime: formatTimeTo24h(
          String(parsed.salidaHora || parsed.checkOutTime || ""),
        ),
        nightlyPrice: String(
          parsed.nightlyPrice ||
            (parsed.precioTotal && parsed.noches
              ? String(
                  Math.round(Number(parsed.precioTotal) / Number(parsed.noches)),
                )
              : ""),
        ),
        totalPrice: String(parsed.totalPrice || parsed.precioTotal || ""),
        numeroPersonas,
        propertyId: resolvedPropertyId,
      };
    };

    // 1. Intentar encontrar un bloque [CONTRACT_PDF:...] ya generado
    for (const msg of [...messages].reverse()) {
      if (
        msg.sender === "assistant" &&
        msg.content.includes("[CONTRACT_PDF:")
      ) {
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
            const normalized = await normalizeData(parsed, messages);
            return {
              ...normalized,
              source: "finalized_block",
            };
          } catch (e) {
            console.error("Error parsing CONTRACT_PDF block:", e);
          }
        }
      }
    }

    // 2. Usar IA para extraer del historial si no hay bloque final
    const history = messages
      .map((m: any) => `${m.sender.toUpperCase()}: ${m.content}`)
      .join("\n");

    const currentDate = new Date().toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const prompt = `Analiza los siguientes mensajes de una conversación de WhatsApp y extrae los datos necesarios para un contrato de alquiler de finca.
FECHA ACTUAL: ${currentDate}. Usa este año para fechas ambiguas.
Responde ÚNICAMENTE con un objeto JSON válido con estas llaves (si no conoces un dato, usa null o ""):
- clientName: nombre completo
- clientId: cédula o ID
- clientEmail: correo electrónico
- clientPhone: celular principal
- ciudad: ciudad de residencia
- direccion: dirección completa
- checkInDate: fecha de entrada (YYYY-MM-DD)
- checkOutDate: fecha de salida (YYYY-MM-DD)
- entradaHora: hora de entrada aproximada en formato 24h (HH:mm, ej. 10:00, 15:30)
- salidaHora: hora de salida aproximada en formato 24h (HH:mm, ej. 09:00, 16:00)
- nightlyPrice: precio por noche/día (solo números)
- totalPrice: precio total (solo números)
- numeroPersonas: cantidad TOTAL de personas/huéspedes (solo el número, ej. 10)
- fincaName: nombre de la finca que quiere reservar (si se menciona por nombre)
- propertyId: ID de la finca (si se menciona explícitamente el ID)

Mensajes:\n${history}`;

    const { text } = await generateText({
      model: openai.chat("gpt-5-mini"),
      temperature: 1,
      prompt,
    });

    try {
      const raw = text.trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(raw);
      const normalized = await normalizeData(parsed, messages);
      return {
        ...normalized,
        source: "ai_extraction",
      };
    } catch (e) {
      console.error("Error parsing AI extraction:", e);
      return { error: "No se pudieron extraer los datos automáticamente" };
    }
  },
});

function formatTimeTo24h(timeStr: string): string {
  if (!timeStr) return "";
  const t = timeStr.trim().toUpperCase();
  const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) {
    // Si ya parece HH:mm (24h)
    if (/^\d{2}:\d{2}$/.test(t)) return t;
    return timeStr;
  }
  let [_, hours, minutes, ampm] = match;
  let h = parseInt(hours, 10);
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === AmPM.AM && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${minutes}`;
}

enum AmPM {
  AM = "AM",
  PM = "PM"
}

/**
 * Busca mensajes del asistente que solo tengan el marcador [Plantilla WhatsApp: ...]
 * y los actualiza con el cuerpo real de YCloud para mejorar la visibilidad en el admin.
 */
export const backfillTemplateMessages = internalAction({
  args: {},
  handler: async (ctx) => {
    const routable = await fetchRoutableTemplates();
    if (routable.length === 0) return { updated: 0 };

    const messages = await ctx.runQuery(internal.ycloud.listAllAssistantMessages);
    let updatedCount = 0;

    for (const msg of messages) {
      if (msg.content.startsWith("[Plantilla WhatsApp:")) {
        const match = msg.content.match(/\[Plantilla WhatsApp:\s*(.+?)\]/);
        if (match) {
          const templateName = match[1].trim();
          const template = routable.find((t) => t.name === templateName);
          if (template && template.body) {
            await ctx.runMutation(internal.messages.updateMessageContent, {
              messageId: msg._id,
              content: template.body,
            });
            updatedCount++;
          }
        }
      }
    }

    return { updated: updatedCount };
  },
});

export const listAllAssistantMessages = internalQuery({
  args: {},
  handler: async (ctx: any) => {
    return await ctx.db
      .query("messages")
      .filter((q: any) => q.eq(q.field("sender"), "assistant"))
      .collect();
  },
});
