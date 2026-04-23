import { openai } from "@ai-sdk/openai";
import { generateText, type CoreMessage } from "ai";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import rag from "./rag";
import { CONSULTANT_SYSTEM_PROMPT } from "./lib/consultantPrompt";
import { CONVEX_OPENAI_CHAT_MODEL } from "./lib/openaiModel";
import { transcribeAudio } from "./lib/transcription";

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

function parseCatalogSelectionPayload(userMessage: string): {
  productRetailerId?: string;
  catalogId?: string;
} | null {
  const text = String(userMessage ?? "");
  if (!text) return null;
  const retailerMatch = text.match(/product_retailer_id\s*:\s*([a-zA-Z0-9_-]+)/i);
  const catalogMatch = text.match(/catalog_id\s*:\s*([a-zA-Z0-9_-]+)/i);
  if (!retailerMatch && !catalogMatch) return null;
  return {
    productRetailerId: retailerMatch?.[1]?.trim(),
    catalogId: catalogMatch?.[1]?.trim(),
  };
}

/**
 * Elimina frases del bot que preguntan por fechas cuando el cliente ya las dio (fin de semana).
 * También limpia artefactos de puntuación como ".?" que quedan tras el strip.
 */
function stripDateQuestions(text: string): string {
  return text
    // "fechas exactas de tu estadía", "fecha exacta de entrada/salida", etc.
    .replace(/[^.!?\n]*fechas?\s+exactas?[^.!?\n]*/gi, "")
    // "día/mes/año", "día, mes"
    .replace(/[^.!?\n]*d[ií]a[/,]\s*mes[^.!?\n]*/gi, "")
    // "¿Qué fechas serían?", "¿Qué fechas tienes?"
    .replace(/[^.!?\n]*qu[eé]\s+fechas?[^.!?\n]*/gi, "")
    // "fechas de entrada y salida", "fecha de ingreso y salida"
    .replace(/[^.!?\n]*fecha[^.!?\n]*(entrada|ingreso|salida|estad[ií]a)[^.!?\n]*/gi, "")
    // "📅 Fechas:", "📅 fecha:" con bullets
    .replace(/[^.!?\n]*📅[^.!?\n]*fecha[^.!?\n]*/gi, "")
    // "¿Para cuándo sería?", "¿Cuándo serían las fechas?"
    .replace(/[^.!?\n]*para\s+cu[aá]ndo\s+ser[ií]a[^.!?\n]*/gi, "")
    // Artefactos de puntuación: ".?" → ".", "?." → "?", "!?" → "!", ".." → "."
    .replace(/([.!?])\s*[?]/g, "$1")
    .replace(/([?!])\s*\./g, "$1")
    .replace(/\.{2,}/g, ".")
    // Limpiar líneas vacías múltiples
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detecta mensajes fuera del alcance del bot (ej. operaciones matemáticas o trivia).
 * Busca ahorrar tokens evitando llamadas al LLM cuando no hay intención de reserva.
 */
export function isOutOfDomainMessage(userMessage: string): boolean {
  const normalized = userMessage
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!normalized) return false;

  // Si menciona contexto de negocio, no bloquear.
  const domainSignals =
    /\b(finca|fincas|reserva|reservar|alquiler|hospedaje|estad[ií]a|check[-\s]?in|check[-\s]?out|fecha|personas|huesped|hu[eé]sped|mascota|contrato|cotiza|cotizacion|precio|disponibilidad|noche|noches|catalogo|cat[aá]logo|ubicaci[oó]n|ciudad)\b/i;
  if (domainSignals.test(normalized)) return false;

  // Operaciones aritméticas típicas: "4x4", "2+2", "10/5", etc.
  const mathExpression =
    /(^|\s)\d{1,5}\s*([x×*+\-\/]|por)\s*\d{1,5}(\s|$)/i;
  // Preguntas de calculadora / trivia no relacionadas al servicio.
  const offTopicQuestion =
    /\b(cu[aá]nto\s+es|resuelve|calcula|capital\s+de|quien\s+es|que\s+hora\s+es)\b/i;

  return mathExpression.test(normalized) || offTopicQuestion.test(normalized);
}

/** Retraso breve y aleatorio antes de enviar respuesta de texto (ritmo más humano; complementa el debounce). */
function humanReplyPacingMs(visibleText: string): number {
  const len = (visibleText ?? "").trim().length;
  if (len < 72) return 30 + Math.floor(Math.random() * 50);
  return 60 + Math.floor(Math.random() * 80);
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
    // Ignorar ruido técnico que no viene del cliente (presencia/estado del canal).
    const rawInboundText = String(args.text ?? "").trim();
    if (
      /^status\s*:\s*active$/i.test(rawInboundText) ||
      /^presence\s*:\s*active$/i.test(rawInboundText)
    ) {
      console.log("[inbound-filter] Mensaje técnico ignorado:", rawInboundText, {
        phone: args.phone,
        eventId: args.eventId,
      });
      return;
    }

    const contactId: Id<"contacts"> = await ctx.runMutation(
      internal.ycloud.getOrCreateContact,
      { phone: args.phone, name: args.name }
    );

    const { conversationId, isNew } = await ctx.runMutation(
      internal.ycloud.getOrCreateConversation,
      { contactId }
    );

    const now = Date.now();
    let finalContent = args.text;

    // ── TRANSCRIPCIÓN: Si es audio, intentar transcribir antes de guardar ──
    if (args.type === "audio" && args.mediaUrl) {
      try {
        console.log("[transcription] Iniciando transcripción...");
        // Obtener nombres de fincas para el prompt de Whisper
        const allFincas = await ctx.runQuery(api.fincas.search, { query: " ", limit: 1000 });
        const fincaNames = allFincas.map(p => p.title).join(", ");
        
        const contextualPrompt = `FincasYa, reservación de fincas, hospedaje, fin de semana. Fincas: ${fincaNames}. Palabras clave: mascotas, adultos, niños, personas, depósito, reserva, entrada, salida, disponibilidad.`;
        
        const transcription = await transcribeAudio(args.mediaUrl, contextualPrompt);
        console.log("[transcription] Resultado:", transcription);
        finalContent = `[Voz] ${transcription}`;
      } catch (err) {
        console.error("[voice] Error transcribiendo audio:", err);
        // Fallback a [Audio] si falla la transcripción
        finalContent = "[Audio] (Transcripción fallida)";
      }
    }

    const insertedUserMessageId = await ctx.runMutation(internal.messages.insertUserMessage, {
      conversationId,
      content: finalContent,
      createdAt: now,
      type: args.type,
      mediaUrl: args.mediaUrl,
    });

    // ── Debounce dinámico para balancear rapidez y agrupación de mensajes ──
    // Casos simples (saludo corto) responden casi inmediato.
    // Mensajes normales esperan un poco para agrupar ráfagas ("hola" + detalle).
    const rawText = (args.text ?? "").trim().toLowerCase();
    const isShortGreeting =
      /^(hola|buenas|buenos dias|buen día|buen dia|hi|hey)\??!?$/i.test(rawText);
    const isTinyFollowUpFragment =
      /^(\?|!|ok|oka+y?|dale|listo|si|sí|no|aja|ajá|mmm|hmm|👍|🙏|👀)\??!?$/i.test(
        rawText
      );
    // Para fragmentos cortos esperamos más para permitir "burst-merge" y evitar doble respuesta.
    const DEBOUNCE_MS = isTinyFollowUpFragment ? 700 : isShortGreeting ? 250 : 700;
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));

    // Releer la conversación para obtener el lastMessageAt más actualizado
    const convAfterDebounce = await ctx.runQuery(api.conversations.getById, {
      conversationId,
    });
    if (!convAfterDebounce) return;

    // Si llegó un mensaje más nuevo durante la espera, este handler cede el turno
    if ((convAfterDebounce.lastMessageAt ?? 0) > now) {
      console.log("[debounce] Mensaje más nuevo detectado, cediendo turno al handler posterior", {
        phone: args.phone,
        theirMessageAt: now,
        newerMessageAt: convAfterDebounce.lastMessageAt,
      });
      return;
    }

    // Guardia anti-duplicados: solo el handler del último mensaje de usuario responde.
    const latestMessage = await ctx.runQuery(api.messages.getLatestUserMessage, {
      conversationId,
      scanLimit: 50,
    });
    const latest = latestMessage as any;
    if (!latest || String(latest._id) !== String(insertedUserMessageId)) {
      console.log("[debounce] Handler no es el último mensaje de usuario, se omite respuesta", {
        phone: args.phone,
        insertedUserMessageId,
        latestUserMessageId: latest?._id,
      });
      return;
    }
    const shouldAbortIfNotLatestUser = async (stage: string) => {
      const latestUser = (await ctx.runQuery(api.messages.getLatestUserMessage, {
        conversationId,
        scanLimit: 50,
      })) as any;
      if (!latestUser || String(latestUser._id) !== String(insertedUserMessageId)) {
        console.log("[debounce] Handler desfasado, se cancela", {
          stage,
          phone: args.phone,
          insertedUserMessageId,
          latestUserMessageId: latestUser?._id,
        });
        return true;
      }
      return false;
    };

    const conv = convAfterDebounce;
    const shouldReply = conv.status === "ai";
    if (shouldReply) {
      // Contexto para la IA
      let currentMessageText = (args.type === "audio" && finalContent.startsWith("[Voz]")) 
        ? finalContent 
        : (args.text || "");
      let singleFincaSent = false;
      let fincaTitle = "";
      let confirmedFincaTitle: string | undefined; // Título oficial encontrado en DB
      let selectedCatalogPropertyTitle: string | undefined;
      let whatsappCatalogSentForSearch = false;
      let catalogLocation = "";
      let catalogFincasCount = 0;
      let catalogFoundFincasButFailed = false;
      let catalogIntent: CatalogIntent = { intent: "none" };

      const recentForCatalogIntent = await ctx.runQuery(api.messages.listRecent, {
        conversationId,
        limit: 14,
      });
      // Si ya estamos recolectando datos para contrato/reserva, NO reabrir catálogo.
      const contractPromptInHistory = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "").toLowerCase();
        return (
          /elaborar\s+tu\s+contrato|datos\s+de\s+la\s+persona|documento\s+de\s+identidad|lugar\s+de\s+expedici[oó]n|correo\s+electr[oó]nico|direcci[oó]n|hora\s+aproximada\s+de\s+ingreso|formalizar\s+la\s+reserva/.test(
            t
          )
        );
      });
      const currentLooksLikeContractData =
        /\b\d{6,}\b/.test(currentMessageText) ||
        /@\w+\.\w+/.test(currentMessageText) ||
        /#\d+/.test(currentMessageText) ||
        /(calle|carrera|cra\.?|cl\.?|avenida|av\.?|mz|manzana|barrio)\s*[\w\d]/i.test(currentMessageText);
      const shouldBlockCatalogByContractFlow =
        contractPromptInHistory && currentLooksLikeContractData;
      if (shouldBlockCatalogByContractFlow) {
        console.log("[catalog-guard] Bloqueado por flujo de contrato/datos personales");
      }

      // Detectar si el cliente YA está entregando los datos personales requeridos (PASO 5).
      // Combina el mensaje actual + mensajes recientes del cliente (pudo haberlos mandado en ráfaga).
      const userTextsAfterContractPrompt: string[] = (() => {
        if (!contractPromptInHistory) return [];
        const out: string[] = [];
        // Tomar user messages posteriores al último mensaje assistant con la plantilla.
        let foundAssistantPrompt = false;
        for (let i = recentForCatalogIntent.length - 1; i >= 0; i--) {
          const m: any = recentForCatalogIntent[i];
          if (m.sender === "assistant") {
            const t = String(m.content ?? "").toLowerCase();
            if (/elaborar\s+tu\s+contrato|datos\s+de\s+la\s+persona/.test(t)) {
              foundAssistantPrompt = true;
              break;
            }
          }
        }
        if (!foundAssistantPrompt) return [];
        let seenPrompt = false;
        for (const m of recentForCatalogIntent) {
          if (!seenPrompt) {
            if (
              m.sender === "assistant" &&
              /elaborar\s+tu\s+contrato|datos\s+de\s+la\s+persona/i.test(String(m.content ?? ""))
            ) {
              seenPrompt = true;
            }
            continue;
          }
          if (m.sender === "user") out.push(String(m.content ?? ""));
        }
        out.push(currentMessageText);
        return out;
      })();
      const contractDataBlob = userTextsAfterContractPrompt.join("\n");
      const clientDataFlags = {
        hasFullName: /\b[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,})*/.test(
          contractDataBlob
        ),
        hasIdNumber: /\b\d{7,12}\b/.test(contractDataBlob),
        hasPhone: /\b3\d{9}\b/.test(contractDataBlob),
        hasEmail: /@\w+\.\w+/.test(contractDataBlob),
        hasAddress: /(calle|carrera|cra\.?|cl\.?|avenida|av\.?|mz|manzana|barrio)\s*[\w\d]/i.test(
          contractDataBlob
        ),
      };
      const providedDataCount =
        Number(clientDataFlags.hasFullName) +
        Number(clientDataFlags.hasIdNumber) +
        Number(clientDataFlags.hasPhone) +
        Number(clientDataFlags.hasEmail || clientDataFlags.hasAddress);
      const clientDeliveredPersonalData =
        contractPromptInHistory && providedDataCount >= 3;
      if (clientDeliveredPersonalData) {
        console.log("[contract-stage] cliente entregó sus datos →", clientDataFlags);
      }

      // Detectar si el asistente ya confirmó una finca específica en mensajes recientes
      // (evitar re-enviar catálogo en mensajes de seguimiento: "si", "dale", "quiero reservar", etc.)
      const fincaConfirmedInHistory = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "");
        return /aqu[ií]\s+est[áa]\s+\w|confirmo\s+recepci[oó]n\s+de|excelente\s+elecci[oó]n|recib[ií]\s+tu\s+selecci[oó]n/i.test(t);
      });
      // Extraer el nombre de la finca confirmada del historial para reutilizarlo
      const confirmedFincaInHistoryTitle = (() => {
        for (const m of recentForCatalogIntent) {
          if (m.sender !== "assistant") continue;
          const t = String(m.content ?? "");
          const match = t.match(/(?:confirmo\s+recepci[oó]n\s+de|recib[ií]\s+tu\s+selecci[oó]n:\s*|excelente\s+elecci[oó]n[^*]*\*)\s*\*?([A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s]{2,40})\*?/i);
          if (match?.[1]) return match[1].trim();
        }
        return undefined;
      })();
      // Bloquear catálogos si finca ya está confirmada y el usuario NO está pidiendo explícitamente otras opciones
      const userExplicitlyWantsOtherOptions =
        /\b(otras\s+opciones?|otra\s+finca|diferente|cambiar\s+finca|ver\s+m[aá]s|m[aá]s\s+opciones?)\b/i.test(
          currentMessageText
        );
      const shouldBlockCatalogFincaConfirmed =
        fincaConfirmedInHistory && !userExplicitlyWantsOtherOptions;
      if (shouldBlockCatalogFincaConfirmed) {
        console.log("[catalog-guard] Bloqueado — finca ya confirmada en historial, usuario en flujo de reserva:", confirmedFincaInHistoryTitle);
        // Si no tenemos fincaTitle del run actual, usar el del historial
        if (!fincaTitle && confirmedFincaInHistoryTitle) {
          fincaTitle = confirmedFincaInHistoryTitle;
          confirmedFincaTitle = confirmedFincaInHistoryTitle;
        }
      }
      // Si hay varios mensajes consecutivos del cliente sin respuesta del asistente,
      // fusionarlos en una sola entrada para evitar respuestas fragmentadas/robóticas.
      if (args.type === "text") {
        const burst: string[] = [];
        for (let i = recentForCatalogIntent.length - 1; i >= 0; i--) {
          const m: any = recentForCatalogIntent[i];
          if (m.sender === "assistant") break;
          if (m.sender === "user" && (m.type === "text" || !m.type)) {
            const content = String(m.content ?? "").trim();
            if (content) burst.push(content);
          }
        }
        if (burst.length > 1) {
          burst.reverse();
          currentMessageText = burst.join("\n");
          console.log("[burst-merge] mensajes de cliente fusionados:", burst.length);
        }
      }

      // Si el usuario selecciona un ítem de catálogo (payload order), resolver retailer_id a nombre real.
      const catalogSelection = parseCatalogSelectionPayload(currentMessageText);
      if (catalogSelection?.productRetailerId) {
        // Marcar que hubo selección aunque no se pueda resolver el nombre
        selectedCatalogPropertyTitle = "finca seleccionada";
        try {
          const selectedProperty = await ctx.runQuery(
            api.propertyWhatsAppCatalog.getPropertyByRetailerId,
            {
              productRetailerId: catalogSelection.productRetailerId,
              whatsappCatalogId: catalogSelection.catalogId,
            }
          );
          if (selectedProperty?.title) {
            selectedCatalogPropertyTitle = selectedProperty.title;
            confirmedFincaTitle = selectedProperty.title;
            fincaTitle = selectedProperty.title;
            currentMessageText = `${currentMessageText}\nFinca seleccionada del catálogo: ${selectedProperty.title}`;
            // Actualizar el mensaje en la BD para que el frontend pueda mostrar el nombre
            if (insertedUserMessageId) {
              await ctx.runMutation(internal.messages.updateMessageContent, {
                messageId: insertedUserMessageId,
                content: currentMessageText,
              });
            }
            console.log("[catalog-selection] retailer_id resuelto a finca:", {
              retailerId: catalogSelection.productRetailerId,
              fincaTitle: selectedProperty.title,
            });
          } else {
            console.log("[catalog-selection] retailer_id no resuelto, usando placeholder:", catalogSelection.productRetailerId);
          }
        } catch (e) {
          console.error("[catalog-selection] Error resolviendo retailer_id:", e);
        }
      }

      // Guardrail: evitar gastar tokens en consultas fuera del propósito del bot.
      if (args.type === "text" && isOutOfDomainMessage(currentMessageText)) {
        const outOfDomainReply =
          "Estoy para ayudarte con reservas de fincas (disponibilidad, precios y contrato). 🏡 Compárteme por favor ciudad, fechas y número de personas para asistirte de inmediato.";
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: outOfDomainReply,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: outOfDomainReply,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      const catalogIntentSnippet = recentForCatalogIntent
        .map(
          (m: any) =>
            `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 320)}`
        )
        .join("\n");

      // ── VISIÓN: Si el usuario envió una imagen, analizar primero para identificar la finca ──
      let imageIdentifiedFincaName: string | undefined;
      if (args.type === "image" && args.mediaUrl) {
        try {
          console.log("[vision] Analizando imagen del usuario...");
          const allFincas = await ctx.runQuery(api.fincas.search, {
            query: " ", // traer todas
            limit: 50,
          });
          const fincaNames = allFincas.map((f: any) => f.title).join(", ");

          const { text: visionResult } = await generateText({
            model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
            // Familia GPT-5.x suele exigir temperature por defecto (1); 0 puede rechazarse en la API.
            temperature: 1,
            system: `Eres un asistente que identifica propiedades (fincas) a partir de imágenes.
Se te dará una imagen y la lista de fincas disponibles. Tu ÚNICA tarea es responder con el NOMBRE EXACTO de la finca que aparece en la imagen.
Si ves el nombre de la finca escrito en la imagen (en un letrero, banner, overlay del catálogo, etc.), úsalo.
Si no puedes identificar la finca con certeza, responde SOLO: "NO_IDENTIFICADA".
NO expliques nada, NO agregues texto extra. Solo el nombre exacto o "NO_IDENTIFICADA".

Fincas disponibles: ${fincaNames}`,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: currentMessageText === "[Imagen]" ? "¿Qué finca es esta?" : currentMessageText },
                  { type: "image", image: new URL(args.mediaUrl) },
                ],
              },
            ],
          });

          const trimmed = visionResult.trim();
          if (trimmed && trimmed !== "NO_IDENTIFICADA") {
            imageIdentifiedFincaName = trimmed;
            console.log("[vision] Finca identificada:", imageIdentifiedFincaName);
            // Override catalog intent para que se envíe la ficha
            catalogIntent = { intent: "single_finca", fincaName: imageIdentifiedFincaName };
          } else {
            console.log("[vision] No se pudo identificar la finca de la imagen");
          }
        } catch (e) {
          console.error("[vision] Error analizando imagen:", e);
        }
      }

      try {
        catalogIntent = await ctx.runAction(internal.ycloud.detectCatalogIntentWithAI, {
          userMessage: imageIdentifiedFincaName
            ? `Quiero reservar la finca ${imageIdentifiedFincaName}`
            : currentMessageText,
          conversationSnippet: catalogIntentSnippet,
        });
      } catch (e) {
        console.error("YCloud detectCatalogIntentWithAI error:", e);
      }

      // Si la visión ya identificó la finca, forzar el intent
      if (imageIdentifiedFincaName) {
        catalogIntent = { intent: "single_finca", fincaName: imageIdentifiedFincaName };
      }
      // Si llegó selección desde catálogo, forzar intent de finca específica usando nombre oficial.
      if (selectedCatalogPropertyTitle) {
        catalogIntent = { intent: "single_finca", fincaName: selectedCatalogPropertyTitle };
      }

      // Enviar ficha de una finca (IA o regex como respaldo).
      // PERO NO re-enviar si el usuario está dando datos de seguimiento (fechas, personas) SIN mencionar finca
      const followUpData = isProvidingFollowUpData(currentMessageText) 
        && catalogIntent.intent !== "single_finca";

      // Si ya se envió un catálogo múltiple antes (lastSentCatalogPropertyIds >= 1) y el usuario
      // ahora selecciona una finca específica (ya sea por nombre plano "villas privadas" o con
      // intención explícita "quiero reservar villas privadas"), NO re-enviar la ficha individual:
      // el cliente ya la vio dentro del catálogo anterior. Avanzar directo a la confirmación de
      // reserva + datos de contrato.
      const multipleCatalogAlreadySentInHistory =
        Array.isArray((conv as any).lastSentCatalogPropertyIds) &&
        ((conv as any).lastSentCatalogPropertyIds as unknown[]).length >= 1;
      // Cualquier catálogo WhatsApp enviado recientemente por el asistente también cuenta como
      // "ya le mostramos la ficha" (por si lastSentCatalogPropertyIds aún no se actualizó).
      const assistantSentCatalogRecently = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "").toLowerCase();
        return (
          /estas\s+son\s+las\s+fincas\s+disponibles|te\s+compart[íi]\s+el\s+cat[aá]logo|cat[aá]logo\s+con\s+las\s+opciones|dime\s+cu[aá]l\s+de\s+estas\s+fincas|cu[aá]l\s+finca\s+te\s+llam[oó]\s+la\s+atenci[oó]n/.test(
            t
          ) || m.type === "whatsapp_catalog" || m.type === "catalog"
        );
      });
      const skipSingleFincaCardResend =
        (multipleCatalogAlreadySentInHistory || assistantSentCatalogRecently) &&
        catalogIntent.intent === "single_finca";
      if (skipSingleFincaCardResend) {
        console.log(
          "[single-finca-guard] Omitiendo reenvío de ficha individual — catálogo múltiple ya mostrado y usuario eligió finca:",
          (catalogIntent as any).fincaName
        );
        // NO asignar fincaTitle aquí: si lo hacemos, el bloque de resolución en BD no corre
        // (usa `!fincaTitle`) y el nombre queda en minúsculas tipo "villas privadas".
      }

      try {
        const singleFincaCandidate = parseSingleFincaRequest(currentMessageText);
        const shouldTrySingleFinca =
          catalogIntent.intent === "single_finca" ||
          !!imageIdentifiedFincaName ||
          !!singleFincaCandidate;

        if (
          !followUpData &&
          shouldTrySingleFinca &&
          !shouldBlockCatalogFincaConfirmed &&
          !skipSingleFincaCardResend
        ) {
          const result = await ctx.runAction(
            internal.ycloud.maybeSendSingleFincaCatalogForUserMessage,
            {
              phone: args.phone,
              conversationId,
              userMessage: imageIdentifiedFincaName
                ? `Quiero reservar la finca ${imageIdentifiedFincaName}`
                : currentMessageText,
              wamid: args.wamid,
              extractedFincaName:
                catalogIntent.intent === "single_finca"
                  ? catalogIntent.fincaName
                  : undefined,
            }
          );
          if (result && result.sent && result.fincaTitle) {
            singleFincaSent = true;
            fincaTitle = result.fincaTitle;
            confirmedFincaTitle = result.fincaTitle;
          }
        }
      } catch (e) {
        console.error("YCloud single-finca catalog error:", e);
      }

      try {
        if (
          !singleFincaSent &&
          !shouldBlockCatalogByContractFlow &&
          !shouldBlockCatalogFincaConfirmed &&
          !skipSingleFincaCardResend
        ) {
          console.log("[catalog-intent]", JSON.stringify(catalogIntent));
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
          if (!catalogIntentArg && catalogIntent.intent === "search_catalog") {
            console.warn("[catalog-guard] intent search_catalog descartado — ubicación inválida o muy corta:", (catalogIntent as any).location);
          }
          const catalogRes = await ctx.runAction(
            internal.ycloud.maybeSendCatalogForUserMessage,
            {
              conversationId,
              phone: args.phone,
              userMessage: currentMessageText,
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
          if (!whatsappCatalogSentForSearch && !catalogFoundFincasButFailed) {
            console.log("[catalog-debug] catálogo NO enviado y NO fallback.", {
              intentArg: catalogIntentArg ? catalogIntentArg.intent : "none/undefined",
              resLocation: catalogRes?.location,
              resFincasCount: catalogRes?.fincasCount,
            });
          }
        } else if (shouldBlockCatalogByContractFlow) {
          console.log("[catalog-debug] catálogo bloqueado por flujo de contrato");
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
        catalogIntent.intent !== "single_finca" &&
        !shouldBlockCatalogByContractFlow &&
        !shouldBlockCatalogFincaConfirmed
      ) {
        const dynamicLocationsList_pre = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});
        const msgLower_pre = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        const matchedCity = dynamicLocationsList_pre.find(
          (loc: string) => msgLower_pre.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""))
        );
        if (matchedCity) {
          console.log("[catalog-fallback] Ciudad detectada sin catálogo, forzando envío:", matchedCity);
          const _fbMsgLower = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
          const _fbPersonasMatch = _fbMsgLower.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i);
          const _fbHasPets = /\b(mascota|mascotas|perro|perros|gato|gatos)\b/i.test(_fbMsgLower);
          const _fbCapacity = _fbPersonasMatch ? parseInt(_fbPersonasMatch[1], 10) : undefined;
          try {
            const catalogRes = await ctx.runAction(
              internal.ycloud.maybeSendCatalogForUserMessage,
              {
                conversationId,
                phone: args.phone,
                userMessage: currentMessageText,
                wamid: args.wamid,
                catalogIntent: {
                  intent: "search_catalog" as const,
                  location: matchedCity,
                  hasWeekend: true,
                  minCapacity: _fbCapacity,
                  hasPets: _fbHasPets || undefined,
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
      let quickReplySent = false;
      let templateSent = false;
      const isProvidingData = /\d{7,}/.test(currentMessageText) || /@\w+\.\w+/.test(currentMessageText);
      const isSpecificFinca = singleFincaSent || catalogIntent.intent === "single_finca";
      
      // Detectar si el usuario menciona una ubicación o datos de reserva (no enviar template genérica)
      const dynamicLocationsList = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});
      const msgLower = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const mentionsCityOrFinca = dynamicLocationsList.some(
        (loc: string) => msgLower.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""))
      );
      const mentionsDatesOrPersonas = /\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|personas?|fin de semana)\b/i.test(currentMessageText);
      // También detectar intención de reserva con ubicación: "finca en X", "reservar en X"
      const mentionsBookingIntent = /\b(reservar|alquilar|arrendar|finca\s+en|fincas\s+en|fincas\s+de|finca\s+de|finca\s+para)\b/i.test(currentMessageText);
      const hasBookingContext = mentionsCityOrFinca || mentionsDatesOrPersonas || mentionsBookingIntent || !!selectedCatalogPropertyTitle;
      const normalizedCurrentText = msgLower.trim();
      const isShortBookingFollowUp =
        /^(amigos|familia|empresarial|empresa|si|sí|confirmo|ok|dale|listo)$/i.test(
          normalizedCurrentText
        );
      const hasActiveReservationContext = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "").toLowerCase();
        return /\b(cotiz|disponibil|finca|cat[aá]logo|entrada|salida|personas?|mascotas?|tipo de grupo|evento)\b/.test(
          t
        );
      });
      const shouldBlockGenericTemplates =
        (hasActiveReservationContext && isShortBookingFollowUp) ||
        !!selectedCatalogPropertyTitle;
      
      console.log("[template-guard]", {
        mentionsCityOrFinca,
        mentionsDatesOrPersonas,
        mentionsBookingIntent,
        hasBookingContext,
        hasActiveReservationContext,
        isShortBookingFollowUp,
        selectedCatalogPropertyTitle,
        shouldBlockGenericTemplates,
        whatsappCatalogSentForSearch,
        isSpecificFinca,
        willBlockTemplate:
          whatsappCatalogSentForSearch ||
          isSpecificFinca ||
          isProvidingData ||
          hasBookingContext ||
          shouldBlockGenericTemplates,
      });
      
      if (
        isQuickReplyDbRoutingEnabled() &&
        !whatsappCatalogSentForSearch &&
        !isSpecificFinca &&
        !hasBookingContext &&
        !hasActiveReservationContext &&
        !shouldBlockGenericTemplates
      ) {
        try {
          const quickReply = await ctx.runAction(
            internal.ycloud.maybeSendQuickReplyTemplateByIntent,
            {
              phone: args.phone,
              wamid: args.wamid,
              conversationId,
              userMessage: currentMessageText,
            }
          );
          quickReplySent = quickReply?.sent ?? false;
        } catch (e) {
          console.error("YCloud maybeSendQuickReplyTemplateByIntent error:", e);
        }
      }

      if (
        isAutomaticTemplateRoutingEnabled() &&
        !quickReplySent &&
        !whatsappCatalogSentForSearch &&
        !isSpecificFinca &&
        !isProvidingData &&
        !hasBookingContext &&
        !hasActiveReservationContext &&
        !shouldBlockGenericTemplates
      ) {
        try {
          const routed = await ctx.runAction(
            internal.ycloud.maybeSendWhatsappTemplateReply,
            {
              phone: args.phone,
              wamid: args.wamid,
              conversationId,
              userMessage: currentMessageText,
            }
          );
          templateSent = routed?.sent ?? false;
        } catch (e) {
          console.error("YCloud maybeSendWhatsappTemplateReply error:", e);
        }
      }

      if (await shouldAbortIfNotLatestUser("before_generate_reply")) {
        return;
      }

      if (quickReplySent || templateSent) {
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

      // Calcular si el usuario ya proporcionó info de fechas (fin de semana) para NO volver a pedirla
      const _weekendRegexEarly = /\b(sabado|sábado|domingo|fin\s+de\s+semana|este\s+fin|proximo\s+fin|pr[oó]ximo\s+fin)\b/i;
      const hasKnownWeekend =
        _weekendRegexEarly.test(currentMessageText) ||
        (catalogIntent.intent === "search_catalog" && (catalogIntent as any).hasWeekend === true) ||
        recentForCatalogIntent.some((m: any) =>
          m.sender === "user" && _weekendRegexEarly.test(String(m.content ?? ""))
        );
      // Extraer datos ya conocidos para que el prompt no los vuelva a pedir
      const _allUserTextsEarly = [
        currentMessageText,
        ...recentForCatalogIntent.filter((m: any) => m.sender === "user").map((m: any) => String(m.content ?? "")),
      ].join("\n");
      const _knownCapacityMatch = _allUserTextsEarly.match(/(?:m[aá]ximo\s+)?(\d+)\s*(?:o\s+m[aá]s\s+)?personas/i) || _allUserTextsEarly.match(/para\s+(\d+)\b/i);
      const _knownPetsMatch = _allUserTextsEarly.match(/(\d+)\s*(?:mascotas?|perros?|gatos?)/i) || _allUserTextsEarly.match(/(un[oa]?|dos|tres|cuatro|cinco|seis)\s+(?:mascotas?|perros?|gatos?)/i);
      const _knownHasPets = _knownPetsMatch != null || /\b(mascotas?|perros?|gatos?)\b/i.test(_allUserTextsEarly);
      const knownDataSummary = [
        hasKnownWeekend ? "fechas: este fin de semana (sábado y domingo)" : null,
        _knownCapacityMatch ? `personas: ${_knownCapacityMatch[1]}` : null,
        _knownHasPets ? `mascotas: sí` : null,
      ].filter(Boolean).join(", ");

      // Si saltamos el reenvío de ficha, resolver el nombre oficial en BD para la IA y el contexto.
      if (skipSingleFincaCardResend) {
        const rawName = (catalogIntent as any).fincaName as string | undefined;
        if (rawName) {
          try {
            const hits = (await ctx.runQuery(api.fincas.search, { query: rawName, limit: 8 })) as any[];
            const rawLower = rawName.toLowerCase().trim();
            let match = hits.find((f: any) =>
              String(f.title || "").toLowerCase().includes(rawLower)
            );
            if (!match && hits.length > 0) {
              const tokens = rawLower.split(/\s+/).filter((w) => w.length > 2);
              match =
                hits.find((f: any) => {
                  const t = String(f.title || "").toLowerCase();
                  return tokens.length > 0 && tokens.every((tok) => t.includes(tok));
                }) ?? hits[0];
            }
            if (match?.title) {
              confirmedFincaTitle = match.title;
              fincaTitle = match.title;
            } else {
              confirmedFincaTitle = rawName;
              fincaTitle = rawName;
            }
          } catch {
            confirmedFincaTitle = rawName;
            fincaTitle = rawName;
          }
        }
        console.log("[single-finca-guard] ficha bloqueada, nombre para IA:", fincaTitle);
      }

      // La IA siempre genera la respuesta; lo que cambia es el contexto que recibe.
      let replyText = await ctx.runAction(
        internal.ycloud.generateReplyWithRagAndFincas,
        {
          conversationId,
          userMessage: currentMessageText,
          singleFincaCatalogSent: singleFincaSent,
          fincaTitle: fincaTitle || confirmedFincaInHistoryTitle,
          searchQueryOverride: searchOverride,
          whatsappCatalogSentForSearch,
          dynamicLocations,
          catalogLocation,
          catalogFincasCount,
          catalogFoundFincasButFailed,
          hasKnownWeekend,
          knownDataSummary: knownDataSummary || undefined,
          fincaAlreadyConfirmed:
            shouldBlockCatalogFincaConfirmed ||
            !!selectedCatalogPropertyTitle ||
            skipSingleFincaCardResend,
          confirmedFincaName:
            fincaTitle ||
            confirmedFincaInHistoryTitle ||
            selectedCatalogPropertyTitle ||
            (skipSingleFincaCardResend ? ((catalogIntent as any).fincaName as string | undefined) : undefined),
          clientDeliveredPersonalData,
          contractDataBlob: clientDeliveredPersonalData ? contractDataBlob : undefined,
          imageUrl: args.type === "image" && args.mediaUrl ? args.mediaUrl : undefined,
        }
      );

      // Guard anti-loop: si el cliente ya entregó datos y la IA intenta reenviar la plantilla del PASO 4,
      // forzamos el mensaje de cierre del PASO 5. Evita loops "Para elaborar tu contrato..." repetidos.
      if (replyText && clientDeliveredPersonalData) {
        const looksLikePaso4Template =
          /para\s+elaborar\s+tu\s+contrato\s+de\s+arrendamiento/i.test(replyText) &&
          /✅\s*nombre\s+completo/i.test(replyText) &&
          /documento\s+de\s+identidad/i.test(replyText);
        if (looksLikePaso4Template) {
          console.warn(
            "[paso5-guard] La IA intentó repetir la plantilla del PASO 4 — reemplazando por cierre del PASO 5."
          );
          const fincaName =
            fincaTitle ||
            confirmedFincaInHistoryTitle ||
            selectedCatalogPropertyTitle ||
            "la finca seleccionada";
          // Primera línea: intentar saludar por el nombre detectado en los datos.
          const nameMatch =
            contractDataBlob.match(
              /\b([A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}){1,3})\b/
            );
          const firstName = nameMatch ? nameMatch[1].split(/\s+/)[0] : "";
          const greeting = firstName
            ? `¡Perfecto, ${firstName}!`
            : "¡Perfecto!";
          replyText = `${greeting} Confirmo que recibí todos tus datos para la reserva en ${fincaName}. ✨

👨‍💻 Proceso de reserva:

1. Documentación: Te enviamos el contrato y nuestro respaldo legal para tu revisión 📄.
2. Reserva: Realizas el abono del 50% del valor total para separar la fecha 💰.
3. Confirmación: Validamos tu pago y recibes el soporte oficial junto a la ubicación de la finca ✅.

❗Nuestro RNT es 163658, disponible para consulta y verificación.

En FincasYa.com tu alquiler siempre es seguro, respaldado y con total tranquilidad. ®`;
        }
      }

      // Guardrail de cierre: no anunciar contrato si el usuario no esta en flujo real de reserva.
      if (replyText) {
        const replyMentionsContractAdvance =
          /\b(en\s+breve|pronto).*(contrato)|compartir(?:emos)?\s+el\s+contrato|enviar(?:emos)?\s+el\s+contrato|formalizar\s+la\s+reserva|elaborar\s+tu\s+contrato\b/i.test(
            replyText
          );
        const userExplicitContractIntent =
          /\b(contrato|reservar|reserva|procede|proceder|adelante|confirmo|continuar)\b/i.test(
            currentMessageText
          );
        const assistantAskedToAdvanceReservation = recentForCatalogIntent.some((m: any) => {
          if (m.sender !== "assistant") return false;
          const t = String(m.content ?? "").toLowerCase();
          return (
            /te gustaria avanzar con la reserva|te gustaría avanzar con la reserva|deseas continuar|avancemos con la reserva|confirmar la reserva|deseas que proceda|proceda con la reserva|asegurar tus fechas|quieres reservarla|quiero reservarla/.test(
              t
            )
          );
        });
        // Cierre de reserva: el asistente pidió confirmación explícita o avanzó a datos; "sí" debe permitir el contrato.
        const assistantAskedReservationOrDataStep = recentForCatalogIntent.some((m: any) => {
          if (m.sender !== "assistant") return false;
          const t = String(m.content ?? "").toLowerCase();
          return (
            /confirmas?\s+(la\s+)?reserva|¿\s*confirmas|la\s+confirmamos|avanzamos\s+con|excelente\s+elecci[oó]n|formalizar(la)?\s+reserva|necesito\s+(tus\s+)?datos|nombre\s+completo|documento\s+de\s+identidad|c[eé]dula|¿\s*procedemos|listo.*reserv/.test(
              t
            )
          );
        });
        const userIsAffirmingAfterReservationPrompt =
          isAffirmativeOnly(currentMessageText) && assistantAskedToAdvanceReservation;
        const userIsAffirmingAfterCloseStep =
          isAffirmativeOnly(currentMessageText) && assistantAskedReservationOrDataStep;
        const canTalkAboutContractNow =
          userExplicitContractIntent ||
          currentLooksLikeContractData ||
          assistantAskedToAdvanceReservation ||
          userIsAffirmingAfterReservationPrompt ||
          userIsAffirmingAfterCloseStep;

        if (replyMentionsContractAdvance && !canTalkAboutContractNow) {
          console.warn(
            "[contract-guard] bloqueada respuesta de contrato fuera de flujo",
            {
              userMessage: currentMessageText.slice(0, 200),
              replyPreview: replyText.slice(0, 200),
            }
          );
          replyText =
            "Con mucho gusto te ayudo. Para avanzar correctamente, compárteme por favor ciudad o finca, fechas de entrada y salida, y número de personas. 🏡📅";
        }

        // Si el cliente ya dio datos clave (fechas/personas/grupo/mascota) y la IA pregunta
        // "¿Deseas que solicite...?", saltamos esa confirmación y avanzamos directo a contrato/pago.
        const asksPermissionToRequestContractData =
          /deseas\s+que\s+solicite\s+ahora\s+los\s+datos\s+para\s+el\s+contrato/i.test(
            replyText
          );
        const hasReservationSummarySignals =
          /\b(confirmo|s[aá]bado|domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|personas?|grupo|mascota|noches?)\b/i.test(
            currentMessageText
          );
        // MODO PLANTILLAS: guardrails de sobreescritura desactivados.
        // La IA responde directamente usando consultantPrompt.ts.
        // Solo se aplica stripDateQuestions si la IA pide fechas que el cliente ya dio.
        const _weekendRegex = /\b(sabado|sábado|domingo|fin\s+de\s+semana|este\s+fin|proximo\s+fin|pr[oó]ximo\s+fin)\b/i;
        const hasWeekendInHistory = recentForCatalogIntent.some((m: any) =>
          m.sender === "user" && _weekendRegex.test(String(m.content ?? ""))
        );
        const asksExactDateAgain =
          /\b(fechas?\s+exactas?|fecha\s+exacta|d[ií]a\/mes\/a[nñ]o|dia\/mes\/a[nñ]o|fecha.*entrada.*salida|qu[eé]\s+fechas)\b/i.test(
            replyText
          );
        if (asksExactDateAgain && hasWeekendInHistory) {
          replyText = stripDateQuestions(replyText);
        }

        // Evita repetir "¿Cuál finca te llamó la atención?" si el asistente
        // ya lo preguntó en su último turno o si acabamos de enviar la ficha
        // individual (ya eligió la finca).
        const WHICH_FINCA_Q = /¿?\s*cu[aá]l\s+finca\s+te\s+llam[oó]\s+la\s+atenci[oó]n\s*[?]?[^\n.!]*[🏡✨✅]*\s*/gi;
        const lastAssistantMsg = [...recentForCatalogIntent].reverse().find(
          (m: any) => m.sender === "assistant"
        );
        const assistantJustAskedWhichFinca =
          !!lastAssistantMsg &&
          /cu[aá]l\s+finca\s+te\s+llam[oó]\s+la\s+atenci[oó]n/i.test(
            String(lastAssistantMsg.content ?? "")
          );
        const alreadySentSingleFinca = !!(singleFincaSent || isSpecificFinca);
        if (
          (assistantJustAskedWhichFinca || alreadySentSingleFinca) &&
          WHICH_FINCA_Q.test(replyText)
        ) {
          const cleaned = replyText
            .replace(WHICH_FINCA_Q, "")
            .replace(/\s{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          if (cleaned.length >= 20) {
            replyText = cleaned;
          } else if (singleFincaSent && fincaTitle) {
            replyText = `Te envié la ficha de ${fincaTitle}. ¿Confirmas la reserva? ✅`;
          } else if (fincaTitle) {
            // Catálogo múltiple ya mostrado antes; finca elegida por nombre: confirmamos directo.
            replyText = `¡Excelente elección, ${fincaTitle}! 🏡 ¿Confirmas la reserva? Para formalizarla necesito nombre completo, cédula, teléfono y correo. 📝`;
          } else {
            replyText = "Cuéntame fechas y número de personas para continuar. 📅👥";
          }
        }
      }

      if (replyText) {
        if (await shouldAbortIfNotLatestUser("before_send_reply")) {
          return;
        }
        const pacingTarget =
          replyText.indexOf("[CONTRACT_PDF:") >= 0
            ? replyText.split("[CONTRACT_PDF:")[0]
            : replyText;
        await new Promise((resolve) =>
          setTimeout(resolve, humanReplyPacingMs(pacingTarget))
        );
        if (await shouldAbortIfNotLatestUser("after_pacing_before_send")) {
          return;
        }
        let sentAssistantText: string | null = null;
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
              sentAssistantText = textToSend;

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
              sentAssistantText = replyText;
            }
          } else {
            await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
              to: args.phone,
              text: replyText,
              wamid: args.wamid,
            });
            sentAssistantText = replyText;
            // Escalamos a humano SOLO cuando la IA ya tiene TODOS los datos del cliente
            // y está confirmando el cierre final del contrato. Antes bastaba con que el
            // texto mencionara "Proceso de reserva" / "RNT" / "50% del valor" (escalaba
            // al pedir datos o al explicar métodos de pago). Ahora exigimos:
            //  1) Señal clara de cierre de contrato (envío de documento / validación de pago).
            //  2) Historial con datos completos del cliente (nombre + cédula + teléfono + correo o dirección).
            const closingSignals = [
              /te\s+envi(?:amos|o)\s+el\s+contrato/i,
              /enviar(?:emos|é)\s+el\s+contrato/i,
              /env[ií]o\s+el\s+contrato/i,
              /contrato\s+(?:listo|adjunto|de\s+arrendamiento\s+(?:listo|adjunto|firmado))/i,
              /valid(?:amos|aremos)\s+tu\s+pago/i,
              /soporte\s+oficial\s+de\s+pago/i,
              /confirmaci[oó]n\s+de\s+pago/i,
            ].some((re) => re.test(replyText));
            // ¿El cliente ya dio la info personal necesaria?
            const historyText = [
              ...recentForCatalogIntent.map((m: any) => String(m.content ?? "")),
              currentMessageText,
            ].join("\n");
            const hasName = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+/.test(historyText);
            const hasIdNumber = /\b\d{7,12}\b/.test(historyText);
            const hasPhone = /\b3\d{9}\b/.test(historyText);
            const hasEmail = /@\S+\.\S+/.test(historyText);
            const hasAddress = /(calle|carrera|cra\.?|cl\.?|avenida|av\.?|mz|manzana|barrio)\s*[\w\d]/i.test(historyText);
            const personalDataScore =
              (hasName ? 1 : 0) +
              (hasIdNumber ? 1 : 0) +
              (hasPhone ? 1 : 0) +
              ((hasEmail || hasAddress) ? 1 : 0);
            const hasFullClientData = personalDataScore >= 3;
            if (closingSignals && hasFullClientData) {
              console.log("[escalate] Cierre de contrato detectado con datos completos → humano");
              await ctx.runMutation(internal.conversations.escalate, {
                conversationId,
              });
            } else if (closingSignals && !hasFullClientData) {
              console.log("[escalate] Se detectó cierre pero faltan datos del cliente — NO escalar aún");
            }
          }
        } catch (e) {
          console.error("YCloud send error:", e);
        }
        if (sentAssistantText) {
          await ctx.runMutation(internal.messages.insertAssistantMessage, {
            conversationId,
            content: sentAssistantText,
            createdAt: Date.now(),
          });
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
    /** True si el usuario ya mencionó "sábado y domingo" / "fin de semana" en la conversación — no volver a pedir fechas. */
    hasKnownWeekend: v.optional(v.boolean()),
    /** Resumen de datos ya conocidos del cliente (fechas, personas, mascotas) para omitirlos en el prompt. */
    knownDataSummary: v.optional(v.string()),
    /** True si el cliente ya eligió y confirmó una finca específica → la IA debe avanzar al flujo de reserva, no al catálogo. */
    fincaAlreadyConfirmed: v.optional(v.boolean()),
    /** Nombre de la finca ya confirmada, para que la IA pueda referenciarla correctamente. */
    confirmedFincaName: v.optional(v.string()),
    /** True si el cliente ya entregó sus datos personales (nombre, cédula, etc.) — está en PASO 5, no PASO 4. */
    clientDeliveredPersonalData: v.optional(v.boolean()),
    /** Concat de los mensajes recientes del cliente con los datos personales, para que la IA pueda citarlos. */
    contractDataBlob: v.optional(v.string()),
    /** URL de la imagen enviada por el usuario (para análisis visual). */
    imageUrl: v.optional(v.string()),
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
    if (args.clientDeliveredPersonalData) {
      // El cliente YA entregó los datos para el contrato (PASO 5).
      // PROHIBIDO repetir la plantilla del PASO 4. La IA debe emitir cierre + [CONTRACT_PDF:{...}].
      const fincaName = args.confirmedFincaName || "la finca seleccionada";
      const dataNote = args.contractDataBlob
        ? `\n\nDatos recibidos del cliente (textual, úsalos para el resumen y extraerlos al [CONTRACT_PDF:{...}]):\n---\n${args.contractDataBlob}\n---`
        : "";
      fincasContext = `🚨 PASO 5 — CLIENTE YA ENTREGÓ SUS DATOS PERSONALES.
Finca confirmada: *${fincaName}*. El cliente ya dio: ${args.knownDataSummary || "fechas, personas, mascotas"}. Los datos personales (nombre, cédula, teléfono, dirección, correo si aplica) ya aparecen en los mensajes recientes del cliente.

⛔ PROHIBIDO: Volver a enviar "Para elaborar tu contrato de arrendamiento y formalizar la reserva, necesitamos los datos...". Esa plantilla YA FUE ENVIADA y el cliente YA RESPONDIÓ. Reenviarla es un ERROR GRAVE.

✅ OBLIGATORIO: Responde AHORA con la ESTRUCTURA del PASO 5 en UN SOLO mensaje:
  PARTE 1 — Confirmación breve: "¡Perfecto [Nombre]! Confirmo que recibí todos tus datos para la reserva en ${fincaName}. ✨"
  PARTE 2 — Texto exacto del proceso de reserva (👨‍💻 Proceso de reserva: ... RNT 163658 ... ®).
  PARTE 3 — Bloque técnico al final con los datos extraídos: [CONTRACT_PDF:{"nombreCompleto":"...","cedula":"...","telefono":"...","direccion":"...","correo":"...","ciudad":"...","personas":N,"mascotas":N,"entradaHora":"15:00","salidaHora":"13:00","finca":"${fincaName}"}]

Si falta algún dato puntual (p.ej. correo o ciudad de residencia), PIDE SOLO ese dato faltante en 1-2 líneas — NO re-envíes la lista completa del PASO 4.${dataNote}`;
    } else if (args.fincaAlreadyConfirmed && args.confirmedFincaName) {
      // El cliente ya eligió una finca específica — la IA debe avanzar al PASO 3 (cotización) o PASO 4 (datos personales).
      // NO mencionar catálogo, NO pedir que elija finca, NO enviar opciones.
      const fincaCtxData = fincasList.find((f: any) =>
        f.title?.toLowerCase().includes(args.confirmedFincaName!.toLowerCase().trim())
      );
      // Construir ficha detallada de la finca confirmada (precio base + temporadas + reglas) para que la IA
      // pueda cotizar correctamente con depósito mascotas, personal de servicio y restricciones.
      const fincaDetail = fincaCtxData
        ? "\n\n## 📋 DATOS DE LA FINCA CONFIRMADA\n" + formatFincasForPrompt([fincaCtxData as any])
        : "";
      fincasContext = `⚠️ FINCA YA SELECCIONADA Y CONFIRMADA: El cliente eligió *${args.confirmedFincaName}*. El cliente ya dio: ${args.knownDataSummary || "fechas, personas, mascotas"}. NO menciones el catálogo ni otras fincas. Sigue el PASO 3: entrega el DESGLOSE COMPLETO de la cotización (alojamiento + depósito de mascotas si aplica + personal de servicio si la finca lo exige) usando el precio exacto de la ficha, menciona las REGLAS propias de la finca que apliquen al grupo del cliente (mascotas, sonido, solo familiar, etc.) y pide la aprobación. Una vez el cliente aprueba, pasa al PASO 4 (datos personales). NUNCA vuelvas al catálogo.${fincaDetail}`;
    } else if (catalogAlreadyShown && args.catalogLocation) {
      // Construir lista de datos pendientes excluyendo los que el cliente YA dio
      const pendingBullets: string[] = ["● 🏡 ¿Cuál de estas fincas te llamó la atención?"];
      if (!args.hasKnownWeekend) pendingBullets.push("● 📅 Fechas exactas de tu estadía (día de entrada y salida)");
      pendingBullets.push("● 🐾 ¿Llevarán mascotas?");
      const knownNote = args.knownDataSummary
        ? ` El cliente ya proporcionó: ${args.knownDataSummary}. NO vuelvas a pedir estos datos.`
        : "";
      fincasContext = `(El sistema YA ENVIÓ EXITOSAMENTE el catálogo interactivo de WhatsApp con ${args.catalogFincasCount || "varias"} fincas disponibles en ${args.catalogLocation}. El cliente ya puede ver nombres, fotos y precios directamente en su pantalla.${knownNote} Responde siguiendo EXACTAMENTE el formato del PASO 2: menciona brevemente que compartiste el catálogo en ${args.catalogLocation}, y luego pide SOLO los datos faltantes: ${pendingBullets.join(" ")} NO repitas lista de fincas en texto. Termina con "Quedo atento a tu respuesta. 😊")`;
    } else if (catalogAlreadyShown) {
      const knownNote2 = args.knownDataSummary
        ? ` El cliente ya proporcionó: ${args.knownDataSummary}. NO vuelvas a pedir estos datos.`
        : "";
      fincasContext = `(Ya se envió el catálogo de WhatsApp con las fincas; el cliente ve nombres, fotos y precios ahí.${knownNote2} Sigue el PASO 2: pregunta cuál finca le llamó la atención${args.hasKnownWeekend ? "" : " y las fechas"}. NO repitas lista de fincas en texto.)`;
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
      // Regex más robusta para fechas: "20 al 25 de abril", "del 20 al 25", "20 hasta el 25 de mayo"
      const dateRangeMatch = fullConversationText.match(/(?:del\s+|desde el\s+|desde\s+)?(\d{1,2})\s*(?:al|hasta el|hasta|a)\s*(\d{1,2})/i);
      const monthMatch = fullConversationText.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i);
      
      let parsedDates: { start: string, end: string } | null = null;
      if (dateRangeMatch) {
        const d1 = parseInt(dateRangeMatch[1], 10);
        const d2 = parseInt(dateRangeMatch[2], 10);
        const now = new Date();
        const monthIndex = monthMatch ? monthNames[monthMatch[1].toLowerCase()] ?? now.getMonth() : now.getMonth();
        const year = now.getFullYear();
        
        const monthNum = String(monthIndex + 1).padStart(2, '0');
        
        // Formato YYYY-MM-DD manual para evitar desfases de zona horaria
        parsedDates = {
          start: `${year}-${monthNum}-${String(d1).padStart(2, '0')}`,
          end: `${year}-${monthNum}-${String(d2).padStart(2, '0')}`
        };
      }

      const pricingBlocks: string[] = [];
      const availabilityBlocks: string[] = [];

      for (const finca of fincasList.slice(0, 8)) {
        // 1. Precios y Temporadas (Usando la lógica oficial)
        try {
          if (parsedDates) {
            const pricingRes = await ctx.runQuery(api.fincas.calculateStayPrice, {
              propertyId: finca._id as any,
              fechaEntrada: parsedDates.start,
              fechaSalida: parsedDates.end,
            });

            if (pricingRes && pricingRes.total > 0) {
              const breakdown = pricingRes.nights.map((n: any) => 
                `    - ${n.date} (${n.ruleName}): $${n.price.toLocaleString("es-CO")}`
              ).join("\n");

              pricingBlocks.push(`📋 DESGLOSE DE PRECIOS PARA ${finca.title} (${parsedDates.start} al ${parsedDates.end}):
    Total: $${pricingRes.total.toLocaleString("es-CO")} (${pricingRes.nightsCount} noches)
    Desglose:
${breakdown}
  ⚠️ INSTRUCCIÓN: Informa al cliente este TOTAL EXACTO de $${pricingRes.total.toLocaleString("es-CO")} y menciona brevemente por qué varía el precio (ej. noches de fin de semana o temporada).`);
            }
          }

          // Mostrar reglas generales de todos modos si no hay fechas o como contexto extra
          const rules = await ctx.runQuery(api.fincas.getPropertyPricingRules, {
            propertyId: finca._id as any,
          });
          if (rules.length > 0 && (!parsedDates || pricingBlocks.length === 0)) {
            const reglaLines = rules.map((r: any) => {
              const rango = r.fechaDesde && r.fechaHasta ? `${r.fechaDesde} al ${r.fechaHasta}` : "general";
              return `  - ${r.nombre} (${rango}): $${(r.valorUnico || 0).toLocaleString("es-CO")}/noche`;
            }).join("\n");
            pricingBlocks.push(`📋 Tarifas generales de ${finca.title}:\n${reglaLines}`);
          }
        } catch (e) {
          console.log("[pricing] Error calculating price for", finca.title, e);
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

    // ── INYECTAR PLANTILLAS ─────────────────────────────────────────
    // Cargar todas las plantillas disponibles (quick-reply de BD + WhatsApp oficiales)
    // y pasarlas al system prompt para que la IA elija la correcta y la copie VERBATIM.
    let templatesSection = "";
    try {
      const dbTemplates = await ctx.runQuery(api.quickReplyTemplates.listActive, {});
      const dbBlocks: string[] = [];
      for (const t of dbTemplates as any[]) {
        if (t.mediaType === "audio") continue; // plantillas de audio no se copian como texto
        const content = String(t.content || "").trim();
        if (!content) continue;
        dbBlocks.push(
          `### intentKey: ${t.intentKey}\n### title: ${t.title}\n### slashCommand: /${t.slashCommand}\n--- TEXTO VERBATIM (copiar tal cual) ---\n${content}\n--- FIN ---`
        );
      }

      let waTemplates: RoutableWhatsappTemplate[] = [];
      try {
        waTemplates = await fetchRoutableTemplates();
      } catch {
        waTemplates = [];
      }
      const waBlocks: string[] = [];
      for (const t of waTemplates) {
        const body = String(t.body || "").trim();
        if (!body) continue;
        waBlocks.push(
          `### intentKey: ${t.name}\n### title: ${t.hint}\n### origen: WhatsApp oficial (${t.language})\n--- TEXTO VERBATIM (copiar tal cual) ---\n${body}\n--- FIN ---`
        );
      }

      const allBlocks = [...dbBlocks, ...waBlocks];
      if (allBlocks.length > 0) {
        templatesSection = allBlocks.join("\n\n");
      }
    } catch (e) {
      console.error("[prompt-templates] error cargando plantillas:", e);
    }

    const systemPrompt = buildSystemPrompt(ragResult.text, fincasContext, {
      singleFincaCatalogSent: args.singleFincaCatalogSent ?? false,
      fincaTitle: args.fincaTitle ?? "",
      whatsappCatalogSentForSearch: catalogAlreadyShown,
      catalogFoundFincasButFailed: catalogFailed,
      currentDate,
      dynamicLocations: args.dynamicLocations,
      hasImage: !!args.imageUrl,
      templatesSection,
    });
    // ── TTL de historial: solo incluir mensajes de las últimas 12 horas ──
    // Si han pasado más de 12h desde el último mensaje, el agente arranca
    // sin contexto previo (como una conversación nueva).
    const HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
    const historyCutoff = Date.now() - HISTORY_TTL_MS;
    const freshMessages = recentMessages.filter((m: any) => m.createdAt >= historyCutoff);
    console.log("[history-ttl] mensajes en contexto:", freshMessages.length, "/", recentMessages.length);
    const messages: CoreMessage[] = [];

    for (let idx = 0; idx < freshMessages.length; idx++) {
      const m = freshMessages[idx] as any;
      const isUser = m.sender === "user";
      const isLastUserMsg = isUser && idx === freshMessages.length - 1;

      // Only attach image to the LAST user message (current message) to save costs
      if (isLastUserMsg && args.imageUrl) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: m.content || "El usuario envió esta imagen." },
            { type: "image", image: new URL(args.imageUrl) },
          ],
        });
      } else if (isUser) {
        messages.push({ role: "user", content: m.content as string });
      } else {
        messages.push({ role: "assistant", content: m.content as string });
      }
    }

    const { text } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: systemPrompt,
      messages,
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
    priceBaja?: number;
    priceMedia?: number;
    priceAlta?: number;
    priceEspeciales?: number;
    image?: string;
    allowsPets?: boolean;
    allowsEventsContent?: boolean;
    familyOnly?: boolean;
    serviceStaffMandatory?: boolean;
    serviceStaffPrice?: number;
  }>
): string {
  if (!list?.length) return "";
  const money = (n?: number) =>
    n && n > 0 ? `$${n.toLocaleString("es-CO")}` : "N/A";
  return list
    .map((p) => {
      const base = `- ${p.title} (ID: ${p._id}): ${p.description ?? ""} | Ubicación: ${p.location ?? "N/A"} | Capacidad: ${p.capacity ?? "N/A"} personas | Precio base/noche: ${money(p.priceBase)}`;
      const seasons: string[] = [];
      if (p.priceBaja && p.priceBaja > 0) seasons.push(`baja ${money(p.priceBaja)}`);
      if (p.priceMedia && p.priceMedia > 0) seasons.push(`media ${money(p.priceMedia)}`);
      if (p.priceAlta && p.priceAlta > 0) seasons.push(`alta ${money(p.priceAlta)}`);
      if (p.priceEspeciales && p.priceEspeciales > 0)
        seasons.push(`especial ${money(p.priceEspeciales)}`);
      const seasonLine = seasons.length
        ? ` | Precios por temporada: ${seasons.join(", ")}`
        : "";
      const rules: string[] = [];
      if (p.allowsPets === true) rules.push("✅ Permite mascotas (aplica depósito estándar $100k c/u)");
      if (p.allowsPets === false) rules.push("❌ NO permite mascotas");
      if (p.allowsEventsContent === true) rules.push("✅ Permite sonido/eventos");
      if (p.allowsEventsContent === false) rules.push("❌ NO permite bafles ni sonido profesional");
      if (p.familyOnly === true) rules.push("⚠️ Solo descanso familiar (no grupos de amigos/eventos)");
      if (p.serviceStaffMandatory === true)
        rules.push(
          `⚠️ Personal de servicio OBLIGATORIO${p.serviceStaffPrice ? ` (${money(p.serviceStaffPrice)}/día)` : ""}`
        );
      else if (p.serviceStaffPrice && p.serviceStaffPrice > 0)
        rules.push(`Personal de servicio opcional: ${money(p.serviceStaffPrice)}/día`);
      const rulesLine = rules.length ? `\n    · Reglas: ${rules.join(" | ")}` : "";
      return `${base}${seasonLine}${rulesLine}`;
    })
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
    hasImage?: boolean;
    templatesSection?: string;
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
**AHORA MISMO:** El usuario te pidió ver una finca específica y el sistema YA LE ENVIÓ la ficha individual por catálogo de WhatsApp. Responde UNA sola frase corta confirmando y avanzando al siguiente paso. **NO** vuelvas a pedir fechas ni personas: ya las tienes del historial. Ejemplo: "Ahí te envié la ficha de ${opts.fincaTitle}. ¿La confirmamos? 🏡✅" o "Listo, revisa la ficha de ${opts.fincaTitle}. ¿Avanzamos con la reserva? 🏡"
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

  const visionHint = opts?.hasImage
    ? `
---
## 📷 ANÁLISIS DE IMAGEN
El usuario te ha enviado una imagen. DEBES analizarla visualmente:
- Si parece una finca/propiedad, compara sus características (piscina, jardín, estilo, ubicación, paisaje) con las fincas listadas en tu CONTEXTO DE FINCAS para intentar identificarla.
- Si logras identificar la finca, respóndele con entusiasmo mencionando el nombre de la finca y ofreciendo enviar la ficha o más información.
- Si no logras identificarla con certeza, describe lo que ves en la imagen y pregunta si es alguna de tus fincas disponibles o si busca algo similar.
- Si la imagen no es una finca (ej: comprobante de pago, documento, selfie), responde acorde al contexto de la conversación.
`
    : "";

  const voiceHint = `
---
## 🎙️ MENSAJES DE VOZ (Transcripción)
Si el mensaje del usuario empieza con "[Voz]", significa que fue transcrito automáticamente desde un audio de WhatsApp. 
- Sé natural y amigable. 
- Si la transcripción parece tener errores fonéticos (ej: nombres de fincas mal escritos), intenta inferir lo que el cliente quiso decir basándote en el catálogo.
`;

  const officialNameHint = opts?.fincaTitle
    ? `\n**REGLA DE NOMBRE:** Has identificado que el usuario se refiere a la finca "${opts.fincaTitle}". USA SIEMPRE este nombre exacto en tu respuesta, ignorando errores ortográficos o de transcripción que el usuario pueda tener en su mensaje original.`
    : "";

  const templatesBlock = opts?.templatesSection
    ? `

---
## 📚 BIBLIOTECA DE PLANTILLAS (COPIA VERBATIM)

⚠️ **REGLA SUPREMA — NO NEGOCIABLE:**
Cuando el mensaje del cliente encaje con el **intent** o la **temática** de UNA de las plantillas listadas abajo, DEBES responder copiando su texto COMPLETAMENTE VERBATIM, palabra por palabra, emoji por emoji, salto de línea por salto de línea. **PROHIBIDO:**
- Cambiar ni una sola palabra, emoji o signo de puntuación.
- Añadir saludos, despedidas, aclaraciones o frases introductorias antes o después del texto de la plantilla.
- Resumir, parafrasear, adaptar el tono ni "mejorar" la redacción.
- Combinar fragmentos de varias plantillas en una sola respuesta (elige UNA sola plantilla por turno).

**CÓMO ELEGIR:**
1. Lee el \`intentKey\` y el \`title\` / \`hint\` de cada plantilla — ahí te dice cuándo usarla.
2. Si más de una calza, escoge la más específica al contexto real del cliente.
3. Si **NINGUNA** plantilla calza claramente con lo que el cliente está pidiendo, responde de forma natural siguiendo las reglas del PROMPT DEL CONSULTOR. En ese caso NO inventes ni uses una plantilla "parecida".
4. Cuando uses una plantilla, responde SOLO con su texto — nada más.

${opts.templatesSection}

---
`
    : "";

  return `${basePrompt}${dynamicLocationsText}${priorityInstructions}${singleFincaHint}${multiCatalogHint}${visionHint}${voiceHint}${officialNameHint}${templatesBlock}

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
      await ctx.db.patch(conv._id, { status: "human", attended: false });
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

/**
 * Plantillas quick-reply guardadas en Convex (tabla quickReplyTemplates).
 * Por defecto ACTIVADO: saludos y aperturas deben ir con texto exacto de BD, no improvisado por la IA.
 * Desactivar solo si hace falta depurar: YCLOUD_QUICK_REPLY_ROUTING=off
 */
function isQuickReplyDbRoutingEnabled(): boolean {
  const envVal = process.env.YCLOUD_QUICK_REPLY_ROUTING?.trim().toLowerCase();
  if (!envVal) return true;
  return !(
    envVal === "0" ||
    envVal === "false" ||
    envVal === "off" ||
    envVal === "no"
  );
}

function quickReplyRoutingDisabled(): boolean {
  return !isQuickReplyDbRoutingEnabled();
}

/**
 * Enrutamiento a plantillas oficiales de WhatsApp vía YCloud (APPROVED, sin variables).
 * Por defecto DESACTIVADO. Activar con: YCLOUD_TEMPLATE_ROUTING=on (o true, 1, yes)
 */
function isAutomaticTemplateRoutingEnabled(): boolean {
  const envVal = process.env.YCLOUD_TEMPLATE_ROUTING?.trim().toLowerCase();
  if (!envVal) return false;
  return (
    envVal === "1" ||
    envVal === "true" ||
    envVal === "on" ||
    envVal === "yes"
  );
}

function templateRoutingDisabled(): boolean {
  return !isAutomaticTemplateRoutingEnabled();
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
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
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
 * Clasifica la intención del mensaje para resolver plantillas rápidas guardadas en BD.
 */
export const selectQuickReplyIntentWithAI = internalAction({
  args: {
    userMessage: v.string(),
    conversationSnippet: v.string(),
    intentsJson: v.string(),
  },
  handler: async (_ctx, args): Promise<{ intentKey: string } | null> => {
    const { text: modelText } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: `Eres un clasificador que escoge UNA plantilla de WhatsApp (quick-reply) para responder VERBATIM al cliente.
Responde SOLO JSON válido:
{"intentKey":"<intent_key_exacto>"} o {"intentKey":"NONE"}.

Reglas de selección:
- Lee el "content" completo de cada plantilla en la lista; no inventes intentKeys.
- Elige la plantilla cuyo texto completo responda correctamente a la última intención del cliente.
- Si el cliente solo saluda o abre conversación (ej. "hola", "buen día", "info", "me ayudas"):
   → Prefiere la plantilla de **bienvenida/saludo genérica** (suele mencionar "comunicarte con FincasYa", "horario de atención", "brevedad"). Evita las plantillas que empiezan con "Te saluda HERNÁN" o que son de cotización específica, salvo que sea la única opción.
- Si en el historial el asistente YA respondió con una plantilla de bienvenida en sus últimos 2 turnos, NO elijas otra vez bienvenida; responde NONE.
- Si el cliente pide cotizar / ver fincas / reservar y YA dio ciudad y fechas, responde NONE (el flujo continúa por otra vía, no plantilla).
- Si hay ambigüedad entre dos plantillas, responde NONE.
- Si el mensaje no encaja claramente con NINGUNA plantilla, responde NONE.`,
      prompt: `Intenciones disponibles:
${args.intentsJson}

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
      const intentKey =
        typeof parsed.intentKey === "string" ? parsed.intentKey.trim() : "NONE";
      if (!intentKey || intentKey.toUpperCase() === "NONE") return null;
      return { intentKey };
    } catch (err) {
      console.error("selectQuickReplyIntentWithAI parse error:", err, modelText);
      return null;
    }
  },
});

export const sendWhatsAppAudioByUrl = internalAction({
  args: {
    to: v.string(),
    mediaUrl: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
    }
    const body: Record<string, unknown> = {
      from: wabaNumber,
      to: args.to,
      type: "audio",
      audio: { link: args.mediaUrl },
    };
    if (args.wamid) body.context = { message_id: args.wamid };
    const res = await fetch(YCLOUD_SEND_DIRECTLY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    const textRes = await res.text();
    if (!res.ok) {
      throw new Error(`YCloud audio error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes) as Record<string, unknown>;
  },
});

export const maybeSendQuickReplyTemplateByIntent = internalAction({
  args: {
    phone: v.string(),
    wamid: v.optional(v.string()),
    conversationId: v.id("conversations"),
    userMessage: v.string(),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; templateId?: string }> => {
    if (quickReplyRoutingDisabled()) {
      return { sent: false };
    }
    const templates = await ctx.runQuery(api.quickReplyTemplates.listActive, {});
    if (!templates.length) return { sent: false };

    const sendTemplate = async (template: any): Promise<{ sent: boolean; templateId?: string }> => {
      if (template.mediaType === "audio") {
        if (!template.mediaUrl) return { sent: false };
        await ctx.runAction(internal.ycloud.sendWhatsAppAudioByUrl, {
          to: args.phone,
          mediaUrl: template.mediaUrl,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
          conversationId: args.conversationId,
          content: template.content ?? "",
          type: "audio",
          mediaUrl: template.mediaUrl,
          metadata: { quickTemplateId: template._id, intentKey: template.intentKey },
          createdAt: Date.now(),
        });
        return { sent: true, templateId: template._id };
      }

      const textToSend = String(template.content || "").trim();
      if (!textToSend) return { sent: false };
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: textToSend,
        wamid: args.wamid,
      });
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: textToSend,
        createdAt: Date.now(),
      });
      return { sent: true, templateId: template._id };
    };

    const recent = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 8,
    });
    const snippet = recent
      .map(
        (m: any) =>
          `${m.sender === "user" ? "Cliente" : "Asistente"}: ${String(m.content || "").slice(0, 220)}`
      )
      .join("\n");

    const intentMap = new Map<string, any>();
    for (const t of templates) {
      if (!intentMap.has(t.intentKey)) intentMap.set(t.intentKey, t);
    }
    const intentsPayload = JSON.stringify(
      Array.from(intentMap.values()).map((t) => ({
        intentKey: t.intentKey,
        title: t.title,
        slashCommand: t.slashCommand,
        content: String(t.content || "").slice(0, 900),
        mediaType: t.mediaType,
      }))
    );

    let selectedIntent: string | null = null;
    try {
      const selected = await ctx.runAction(internal.ycloud.selectQuickReplyIntentWithAI, {
        userMessage: args.userMessage,
        conversationSnippet: snippet,
        intentsJson: intentsPayload,
      });
      selectedIntent = selected?.intentKey ?? null;
    } catch (error) {
      console.error("selectQuickReplyIntentWithAI error:", error);
      return { sent: false };
    }

    const normalizeText = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Selecciona la plantilla más apropiada para un saludo/apertura.
    // Orden de preferencia:
    //   1) intentKey/title que CLARAMENTE indica saludo/bienvenida (comunicarte, hernan-style NO cuenta como "saludo" genérico).
    //   2) contenido con indicios de bienvenida genérica: "comunicarte", "atencion" + "horario".
    //   3) plantillas con múltiples campos (fechas + personas + grupo + evento).
    //   4) la más larga.
    // NOTA: evitamos seleccionar plantillas de "cotizacion" específica que empiecen con "Hola, gracias por escribir..." cuando existe una más genérica "gracias por comunicarte".
    const pickRichOpeningTemplate = () => {
      const byPriority = [...templates].sort(
        (a: any, b: any) => (a.order ?? 9999) - (b.order ?? 9999)
      );

      const textTemplates = byPriority.filter(
        (t: any) =>
          t.mediaType === "text" && String(t.content || "").trim().length >= 60
      );
      if (!textTemplates.length) return null;

      const hasWelcomeMetaOnly = (t: any) => {
        const ik = normalizeText(String(t.intentKey || ""));
        const title = normalizeText(String(t.title || ""));
        const blob = `${ik} ${title}`;
        return /\b(bienvenid|saludo|inicio|welcome|apertura|atencion|informacion\s+inicial|comunicarte)\b/.test(
          blob
        );
      };

      const welcomeOnly = textTemplates.find(hasWelcomeMetaOnly);
      if (welcomeOnly) return welcomeOnly;

      const genericWelcomeByContent = textTemplates.find((t: any) => {
        const c = String(t.content || "").toLowerCase();
        return (
          (c.includes("comunicarte") || c.includes("gracias por comunicarte")) &&
          (c.includes("horario") || c.includes("brevedad"))
        );
      });
      if (genericWelcomeByContent) return genericWelcomeByContent;

      const rich = textTemplates.find((t: any) => {
        const content = String(t.content || "");
        const fieldHits = [
          /\bfecha|fechas|ingreso|salida\b/i,
          /\bpersona|personas|cupo|huesped\b/i,
          /\bgrupo|familiar|amigos|empresarial\b/i,
          /\bevento|celebracion|cumpleanos|boda\b/i,
        ].filter((re) => re.test(content)).length;
        return fieldHits >= 3;
      });
      if (rich) return rich;

      let best: any = null;
      let bestLen = 0;
      for (const t of textTemplates) {
        const c = String(t.content || "").trim();
        if (c.length > bestLen) {
          bestLen = c.length;
          best = t;
        }
      }
      return best;
    };

    if (!selectedIntent) {
      const normalizedUser = normalizeText(args.userMessage || "");
      const isOpeningGreeting =
        /^(hola|holaa|hi|hello|hey|buenos|buenas|buen dia|que tal|saludos|informacion|info|me ayudas)\b/i.test(
          normalizedUser
        ) && normalizedUser.length <= 90;
      const hasAssistantHistory = recent.some((m: any) => m.sender === "assistant");

      if (isOpeningGreeting && !hasAssistantHistory) {
        const fallbackTemplate = pickRichOpeningTemplate();

        if (fallbackTemplate) {
          console.log(
            "[quick-template] fallback dinámico de bienvenida por contenido:",
            fallbackTemplate.intentKey || fallbackTemplate.title
          );
          return await sendTemplate(fallbackTemplate);
        }
      }
      return { sent: false };
    }
    const selectedTemplate = templates.find((t: any) => t.intentKey === selectedIntent);
    if (!selectedTemplate) return { sent: false };

    // Para saludo inicial, evita escoger una plantilla demasiado corta (ej. /ho).
    const normalizedUser = normalizeText(args.userMessage || "");
    const isOpeningGreeting =
      /^(hola|holaa|hi|hello|hey|buenos|buenas|buen dia|que tal|saludos|informacion|info|me ayudas)\b/i.test(
        normalizedUser
      ) && normalizedUser.length <= 90;
    const hasAssistantHistory = recent.some((m: any) => m.sender === "assistant");
    const selectedIsTooShort =
      selectedTemplate.mediaType === "text" &&
      normalizeText(String(selectedTemplate.content || "")).length < 80;
    if (isOpeningGreeting && !hasAssistantHistory && selectedIsTooShort) {
      const richer = pickRichOpeningTemplate();
      if (richer) {
        console.log(
          "[quick-template] override saludo corto por plantilla completa:",
          richer.intentKey || richer.title
        );
        return await sendTemplate(richer);
      }
    }
    return await sendTemplate(selectedTemplate);
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
      hasPets?: boolean;
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
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: `Eres un clasificador. Del mensaje del usuario extrae la intención y datos. Responde SOLO con un JSON válido, sin markdown, sin explicación.

Reglas:
- intent: "single_finca" si pide VER o RESERVAR una finca específica por nombre (ej. "quiero ver villa green", "me gustaría reservar la finca X", "quinto la finca X", "esta es la finca que elegí"). **CRÍTICO:** Aunque el mensaje incluya fechas, personas u otros datos de reserva, si menciona un nombre de finca específico, DEBES marcarlo como "single_finca". También si es una confirmación para una finca mencionada justo antes. En fincaName pon solo el nombre de la finca en minúsculas.
- intent: "more_options" si pide otras opciones, más opciones, no le gustan, envía más, otras fincas, dame otras, "enviame las fincas", "muéstrame las fincas", "cuáles fincas".
- intent: "search_catalog" SOLO SI MENCIONA EXPLÍCITAMENTE UN MUNICIPIO O CIUDAD (ej. Villeta, Melgar, etc.) Y NO MENCIONA UNA FINCA CONCRETA. Si menciona una finca, prioriza "single_finca". También aplica cuando el mensaje es un pedido inicial con ciudad, fechas y personas (ej. "quiero reservar en villavicencio para 10 personas el sábado").
- Si el mensaje ACTUAL es solo confirmación (sí, si, ok, dale, por favor, procede, claro, listo): Analiza el CONTEXTO para determinar qué confirma el usuario. CASOS: (1) Si el Asistente preguntó "¿Te gustaría ver/mostrar las fincas en [Ciudad]?" o "¿Te gustaría que te muestre opciones en [Ciudad]?" → devuelve search_catalog con esa ciudad inferida del contexto. (2) Si el Asistente preguntó "¿Te gustaría avanzar con la reserva?" o "¿Deseas continuar?" → devuelve "none". (3) Si el Asistente solicitó datos del contrato → devuelve "none". (4) Si hay ubicación en el contexto y el asistente estaba enviando/mostrando catálogo de fincas → devuelve search_catalog con esa ubicación. Si no se puede inferir la ciudad, devuelve "none".
- Si pregunta por métodos de pago, datos bancarios, Nequi, PSE, transferencia, firma de contrato o PDF del contrato, devuelve SIEMPRE intent "none" (no catálogo).
- intent: "none" si no aplica ninguna de las anteriores.
- hasWeekend: true si menciona "fin de semana", "sábado y domingo", "sábado", "domingo" sin fechas específicas.
- hasPets: true si menciona mascotas, perros, gatos, animales o cualquier animal de compañía.
- minCapacity: número de personas si lo menciona (ej. "10 personas", "máximo 10", "para 8").

Contexto reciente (líneas Cliente/Asistente). Si está vacío, ignóralo:
${snippet || "(vacío)"}

Ejemplos de salida:
{"intent":"single_finca","fincaName":"villa green"}
{"intent":"more_options"}
{"intent":"search_catalog","location":"melgar","hasWeekend":true,"minCapacity":5,"sortByPrice":true,"hasPets":false}
{"intent":"search_catalog","location":"villavicencio","hasWeekend":true,"minCapacity":10,"hasPets":true}
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
            hasPets: parsed.hasPets === true,
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
  // Frases genéricas por destino: deben seguir flujo de catálogo múltiple.
  if (
    /\bver\s+las\s+fincas\b/i.test(lower) ||
    /\bmostrar\s+las\s+fincas\b/i.test(lower) ||
    /\bfincas\s+de\s+[a-záéíóúñ]/i.test(lower) ||
    /\bquiero\s+ver\s+fincas\b/i.test(lower)
  ) {
    return null;
  }
  const patterns = [
    /(?:quiero\s+)?(?:ver|mostrar)\s+(?:la\s+)?(?:finca\s+)?(?:de\s+)?([a-záéíóúñ0-9\s#]+)/i,
    /(?:la\s+)?finca\s+(?:de\s+)?([a-záéíóúñ0-9\s#]+)/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m) {
      const term = m[1].trim();
      if (term.length < 2 || /^(la|el|de|una?)$/i.test(term)) continue;
      if (/\bfincas?\b/i.test(term) || /\bopciones?\b/i.test(term)) continue;
      return term;
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
  hasPets?: boolean;
} | null {
  const msg = userMessage.trim().toLowerCase();
  const STOP_WORDS_LD = /^(una?|unas?|unos?|la|el|las|los|esa?|ese|eso|esta?|esto|mi|tu|su|que|como|donde|aqui|alli|alla|dos|tres|mas|maximo|minimo|amigos|familia|reunion|evento)$/i;
  // Intentar múltiples patrones de ubicación, priorizando más específicos
  const locCandidatesLD = [
    msg.match(/para\s+([a-záéíóúñ]{4,})(?:\s+del\s|\s+para\s|\s+\d|,|$)/i),
    msg.match(/(?:en|de)\s+([a-záéíóúñ]{4,})(?:\s+del\s|\s+para\s|\s+\d|,|$)/i),
    msg.match(/(?:en|de)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|\s+una|\s+la|,|$)/i),
    msg.match(/(?:para)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|$)/i),
  ];
  let location = "";
  for (const m of locCandidatesLD) {
    if (!m) continue;
    const candidate = m[1].trim().replace(/\s+/g, " ");
    if (candidate.length < 3) continue;
    if (STOP_WORDS_LD.test(candidate)) continue;
    if (/\b(dias?|personas?|fincas?|reservar?|noches?)\b/i.test(candidate)) continue;
    location = candidate;
    break;
  }
  // Fechas: "del 20 al 21" o "20 al 21"
  const dateMatch = msg.match(/(?:del\s+)?(\d{1,2})\s*(?:al|hasta el|hasta)\s*(\d{1,2})/i);
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
  const hasPets = /\b(mascota|mascotas|perro|perros|gato|gatos|animal|llev[oa]\s+(mi\s+)?(perro|gato|mascota))\b/i.test(msg);
  return { location, fechaEntrada, fechaSalida, minCapacity, sortByPrice, hasPets };
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
 * Parsea búsqueda con "fin de semana"/"sábado y domingo", "X personas", "en [ubicación]", "buen precio".
 * Ej: "Estoy buscando en Melgar una Finca para 12 personas ... fin de semana ... buen precio"
 * Ej: "quiero reservar en villavicencio para 10 personas el sábado y domingo"
 */
function parseSearchFilters(userMessage: string): {
  location: string;
  fechaEntrada: number;
  fechaSalida: number;
  minCapacity?: number;
  sortByPrice?: boolean;
  hasPets?: boolean;
} | null {
  const msg = userMessage.trim().replace(/\s+/g, " ");
  const lower = msg.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const hasWeekendRef = /\b(fin\s+de\s+semana|este\s+fin|proximo\s+fin|el\s+fin\s+de\s+semana|sabado\s+y\s+domingo|sabado|domingo)\b/i.test(lower);
  if (!hasWeekendRef) return null;
  const weekend = getNextWeekendDates();
  // Ubicación: "en X" o "buscando en X"; X puede llevar emojis (ej. ✨MELGAR). Limpiamos después.
  // Intentar múltiples patrones de ubicación, priorizando "para [city]" que es más fiable
  const locCandidates = [
    lower.match(/para\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{4,})(?:\s+para\s|\s+del\s|\s+\d|,|\s+este|\s+el\s|$)/i),
    lower.match(/en\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{4,})(?:\s+para\s|\s+del\s|\s+\d|,|\s+este|\s+el\s|$)/i),
    lower.match(/(?:buscando\s+)?en\s+(.+?)(?:\s+una|\s+finca|,|\s+para\s+\d|$)/s),
    lower.match(/(?:para|en)\s+(.+?)(?:\s+una|\s+finca|,|\s+grupo|$)/s),
  ];
  const STOP_WORDS = /^(una?|unas?|unos?|la|el|las|los|esa?|ese|eso|esta?|esto|mi|tu|su|que|como|donde|aqui|alli|alla|dos|tres|mas|maximo|minimo|amigos|familia|reunion|evento)$/i;
  let location = "";
  for (const m of locCandidates) {
    if (!m) continue;
    const candidate = m[1].replace(/[^\w\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\s]/gi, "").trim().replace(/\s+/g, " ");
    if (candidate.length < 3) continue;
    if (STOP_WORDS.test(candidate)) continue;
    if (/\b(dias?|personas?|fincas?|reservar?|noches?|sabado|domingo|fin)\b/i.test(candidate)) continue;
    location = candidate;
    break;
  }
  if (!location) return null;
  const personasMatch = lower.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i);
  const minCapacity = personasMatch ? parseInt(personasMatch[1], 10) : undefined;
  const sortByPrice = /\b(buen\s+precio|economico|economicas|barato|barata)\b/i.test(lower);
  const hasPets = /\b(mascota|mascotas|perro|perros|gato|gatos|animal|llev[oa]\s+(mi\s+)?(perro|gato|mascota))\b/i.test(lower);
  return {
    location,
    fechaEntrada: weekend.fechaEntrada,
    fechaSalida: weekend.fechaSalida,
    minCapacity,
    sortByPrice,
    hasPets,
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
  const lower = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return /\b(qu[eé]\s+fincas|qu[eé]\s+opciones|fincas\s+tienes|tienen\s+fincas|hay\s+fincas|ver\s+(las\s+)?opciones|m[aá]s\s+opciones|el\s+cat[aá]logo|un\s+cat[aá]logo|mostrar(me)?\s+(las\s+)?opciones|envi[aá](me)?\s+(las\s+)?fincas|fincas\s+disponibles|mu[eé]stra(me)?\s+(las\s+)?fincas|ver\s+(las\s+)?fincas|quiero\s+ver\s+(las\s+)?opciones|todas\s+las\s+(opciones|fincas)\s+disponibles)\b/i.test(
    lower
  );
}

/**
 * Mensaje de seguimiento solo con fechas/cupo (sin ubicación en este turno), p.ej. "fin de semana y 12 personas".
 * No usar para fusionar historial si parece pago/contrato (lo filtra el caller).
 */
function messageLooksLikeDateCapacityFollowup(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const hasWeekend = /\b(fin\s+de\s+semana|este\s+fin|pr[oó]ximo\s+fin|el\s+fin\s+de\s+semana|sabado\s+y\s+domingo|sabado|domingo)\b/i.test(
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

  // 1) Mensajes claros de pago / contrato / firma -> bloquear búsqueda.
  const paymentOrContract =
    /\b(m[eé]todos?\s+de\s+pago|medios?\s+de\s+pago|como\s+pago|c[oó]mo\s+pagar|formas?\s+de\s+pago|aceptan\s+(tarjeta|nequi|pse)|\bpse\b|\bnequi\b|bancari|transferencia|consignaci[oó]n|datos\s+bancar|cuenta(s)?\s+bancar|n[uú]mero\s+de\s+cuenta|abono|saldo\s+(pendiente|restante)|contrato(\s+de)?\s+arrend|firm(ar|e|o)\s+(el\s+)?contrato|pdf\s+del\s+contrato)\b/.test(
      lower
    ) ||
    /\b(qu[eé]\s+metodos|cu[aá]les\s+son\s+los\s+pagos|donde\s+pago|a\s+donde\s+consigno|puedo\s+pagar)\b/.test(
      lower
    );
  if (paymentOrContract) return true;

  // 2) Respuestas de seguimiento a preguntas sobre mascotas/servicio: SOLO si el mensaje
  //    es corto y NO trae intención clara de reserva/búsqueda. Un mensaje como
  //    "quiero reservar una finca para villavicencio para 10 personas va a llevar dos perros"
  //    debe seguir disparando catálogo aunque mencione "perros".
  const followUpKeyword =
    /\b(mascotas?|perros?|personal|servicio|empleada|convivencia|requerimientos|sonido|decoracion)\b/i.test(
      lower
    );
  if (!followUpKeyword) return false;

  const bookingIntent =
    /\b(reservar|reserva|alquilar|alquilo|arrendar|cotizar|cotizaci[oó]n|opciones|fincas?|quiero\s+una\s+finca|busco|necesito)\b/i.test(
      lower
    );
  const hasDates =
    /\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|fin\s+de\s+semana|s[aá]bado|domingo|semana\s+santa|puente)\b/i.test(
      lower
    );
  const hasPersons = /\b(\d+)\s*personas|para\s+\d+/i.test(lower);
  const hasLocation = /\b(para|en)\s+[a-záéíóúñ]{3,}/i.test(lower);

  const looksLikeFollowUpOnly = lower.length < 60 && !bookingIntent && !hasDates && !hasPersons && !hasLocation;
  return looksLikeFollowUpOnly;
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

    const searchTerm = args.extractedFincaName?.trim() || parseSingleFincaRequest(args.userMessage);
    if (!searchTerm) {
      console.log("[single-finca] no se encontró término de búsqueda en mensaje ni extracción IA");
      return { sent: false };
    }
    console.log("[single-finca] buscando:", searchTerm);

    const fincaToSend = await ctx.runQuery(api.fincas.findBySearchTerm, {
      term: searchTerm,
    });
    if (!fincaToSend) {
      console.log("[single-finca] sin resultados para:", searchTerm, "abortando");
      return { sent: false };
    }

    // Evitar reenvío de la misma ficha cuando el usuario solo confirma "esa misma".
    const recent = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 14,
    });
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const targetTitle = normalize(fincaToSend.title);
    const targetSlug = (fincaToSend.slug || fincaToSend.code || fincaToSend._id) as string;
    const alreadySentSameFinca = recent.some((m: any) => {
      if (m.sender !== "assistant" || m.type !== "product") return false;
      const metaProduct = m.metadata?.product;
      if (!metaProduct) return false;
      const sameSlug = String(metaProduct.slug || "").trim() === String(targetSlug).trim();
      const sameTitle = normalize(String(metaProduct.title || "")) === targetTitle;
      return sameSlug || sameTitle;
    });
    const isReservationConfirmation =
      isAffirmativeOnly(args.userMessage) ||
      /\b(esa\s+misma|la\s+misma|quiero\s+reservarla?|reservarla|confirmo|si\s+esa)\b/i.test(
        args.userMessage
      );
    if (alreadySentSameFinca && isReservationConfirmation) {
      console.log("[single-finca] misma finca ya enviada; no se reenvía ficha", {
        finca: fincaToSend.title,
      });
      return { sent: false, fincaTitle: fincaToSend.title };
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
          hasPets: v.optional(v.boolean()),
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
    let hasPets: boolean | undefined;
    let excludePropertyIds: Id<"properties">[] | undefined;
    let usedInferredDates = false;

    const intent = args.catalogIntent;
    if (intent?.intent === "more_options" && conv.lastCatalogSearch) {
      const last = conv.lastCatalogSearch;
      location = last.location;
      fechaEntrada = last.fechaEntrada;
      fechaSalida = last.fechaSalida;
      minCapacity = last.minCapacity;
      sortByPrice = last.sortByPrice;
      excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
      // Conservar preferencia de mascotas del último catálogo si aplica
      hasPets = (last as any).hasPets === true ? true : undefined;
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
        usedInferredDates = true;
      }
      location = intent.location;
      minCapacity = intent.minCapacity;
      sortByPrice = intent.sortByPrice;
      hasPets = intent.hasPets === true ? true : undefined;
    } else if (detectOtrasOpciones(args.userMessage) && conv.lastCatalogSearch) {
      const last = conv.lastCatalogSearch;
      location = last.location;
      fechaEntrada = last.fechaEntrada;
      fechaSalida = last.fechaSalida;
      minCapacity = last.minCapacity;
      sortByPrice = last.sortByPrice;
      excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
      hasPets = (last as any).hasPets === true ? true : undefined;
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
      hasPets = (parsed as any).hasPets === true ? true : undefined;
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
      allowsPets: hasPets,
    });
    console.log("[catalog-search] location:", location, "fincas encontradas (antes de catálogo):", fincas.length);

    if (fincas.length === 0) {
      console.log("[catalog-search] 0 fincas para", location, "fechas:", new Date(fechaEntrada).toISOString(), "-", new Date(fechaSalida).toISOString());
      return { sent: false, location };
    }

    let chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getByLocationKeyword, {
      location,
    });
    if (!chosenCatalog) {
      console.log("[catalog-search] sin catálogo por keyword para:", location, "— buscando default");
      chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    }
    if (!chosenCatalog) {
      console.error("[catalog-search] NO hay catálogo default ni por keyword para:", location, "— no se puede enviar catálogo");
      return { sent: false, location, fincasCount: fincas.length, fincasFoundButNoCatalog: true };
    }

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
      : usedInferredDates
        ? `Te comparto algunas fincas disponibles en ${location}:`
        : "Estas son las fincas disponibles para tus fechas:";

    try {
      await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
        to: args.phone,
        productRetailerIds,
        bodyText,
        catalogId: chosenCatalog.whatsappCatalogId,
        wamid: args.wamid,
      });
    } catch (err) {
      console.error("[catalog-search] Error enviando catálogo interactivo, fallback a texto:", err);
      const top = fincas.slice(0, 5);
      const lines = top.map((f: any, idx: number) => {
        const price = Number(f.priceBase ?? 0);
        const priceLabel =
          price > 0 ? `$${price.toLocaleString("es-CO")} / noche` : "Precio a confirmar";
        return `${idx + 1}. ${f.title} — ${priceLabel}`;
      });
      const fallbackText =
        `No pude enviarte el catálogo interactivo en este momento, pero aquí tienes opciones disponibles en ${location}:\n\n` +
        `${lines.join("\n")}\n\n` +
        `Si te gusta alguna, te amplío detalles y validamos disponibilidad de inmediato. ✅`;

      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: fallbackText,
        wamid: args.wamid,
      });
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: fallbackText,
        createdAt: Date.now(),
      });
      return { sent: false, location, fincasCount: fincas.length, fincasFoundButNoCatalog: true };
    }

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
        catalogCount: productRetailerIds.length,
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
    const fallbackCatalogId = "1560075992300705";
    if (!apiKey || !wabaNumber) {
      throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
    }
    if (!catalogId) {
      throw new Error("catalogId es requerido (viene de whatsappCatalogs en la BD)");
    }
    console.log("[ycloud] Enviando catálogo:", catalogId, "con productos:", args.productRetailerIds.length);
    const bodyText = args.bodyText ?? "Estas son nuestras fincas disponibles para tus fechas:";
    const buildBody = (catalogIdToUse: string): Record<string, unknown> => {
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
                  catalog_id: catalogIdToUse,
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
                  catalog_id: catalogIdToUse,
                  sections: [
                    {
                      title: "Fincas disponibles",
                      product_items: args.productRetailerIds.map((id) => ({ product_retailer_id: id })),
                    },
                  ],
                },
              },
            };
      if (args.wamid) body.context = { message_id: args.wamid };
      return body;
    };

    const sendCatalogMessage = async (catalogIdToUse: string) => {
      const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(buildBody(catalogIdToUse)),
      });
      const textRes = await res.text();
      return { ok: res.ok, status: res.status, textRes };
    };

    let response = await sendCatalogMessage(catalogId);
    const invalidCatalogError =
      !response.ok &&
      response.status === 400 &&
      (
        /invalid[_\s-]?catalog[_\s-]?id/i.test(response.textRes) ||
        response.textRes.includes('"code":"131009"') ||
        response.textRes.includes('"errorDataDetails":"Invalid catalog_id."')
      );
    if (invalidCatalogError) {
      if (catalogId !== fallbackCatalogId) {
        console.warn(
          "[ycloud] catalog_id inválido en BD:",
          catalogId,
          "reintentando con fallback:",
          fallbackCatalogId
        );
        response = await sendCatalogMessage(fallbackCatalogId);
      }
    }

    if (!response.ok) {
      throw new Error(`YCloud API error: ${response.status} - ${response.textRes}`);
    }
    return JSON.parse(response.textRes);
  },
});

/**
 * Extrae datos del cliente y de la reserva analizando el historial de mensajes.
 * Prioriza bloques [CONTRACT_PDF:...] existentes o usa la IA para inferir.
 */
export const extractContractData = action({
  args: { 
    conversationId: v.id("conversations"),
    forceFresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const { conversationId, forceFresh } = args;
    const messages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: conversationId,
      limit: 30,
    });

    // Helper para normalizar los datos extraídos
    const normalizeData = async (parsed: any, historyMessages: any[]): Promise<any> => {
      const currentYear = new Date().getFullYear();

      // MEJORA: Convertir cualquier formato común a YYYY-MM-DD
      const ensureISODate = (d: string) => {
        if (!d) return d;
        // 1. Si ya es YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
        // 2. Si es DD/MM/YYYY o DD-MM-YYYY
        const slashMatch = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (slashMatch) {
          return `${slashMatch[3]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[1].padStart(2, "0")}`;
        }
        // 3. Si es DD/MM/YY
        const shortslashMatch = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
        if (shortslashMatch) {
          return `20${shortslashMatch[3]}-${shortslashMatch[2].padStart(2, "0")}-${shortslashMatch[1].padStart(2, "0")}`;
        }
        return d;
      };

      const fixYear = (d: string) => {
        const iso = ensureISODate(d);
        if (!iso) return iso;
        const match = iso.match(/^(\d{4})-(.*)/);
        if (match && Number(match[1]) < currentYear) {
          return `${currentYear}-${match[2]}`;
        }
        return iso;
      };

      // Normalizar fechas de entrada/salida inmediatamente
      parsed.checkInDate = fixYear(parsed.entrada || parsed.checkInDate || "");
      parsed.checkOutDate = fixYear(parsed.salida || parsed.checkOutDate || "");

      // Resolución de propiedad
      let resolvedPropertyId = String(parsed.propertyId || "");
      if (!resolvedPropertyId || !resolvedPropertyId.includes(":")) {
        const fincaName = String(parsed.finca || parsed.fincaName || parsed.nombreFinca || "");
        let searchTerms = [resolvedPropertyId, fincaName].filter(
          (t) => t && t.length > 2,
        );

        // MEJORA: Si no hay nombre de finca en el JSON, buscarlo en los últimos mensajes
        if (searchTerms.length === 0 && historyMessages.length > 0) {
          const recentText = historyMessages.slice(-10).map((m: any) => m.content).join("\n");
          // Buscar patrones como "Finca: Villa Barbosa", "en la Villa Barbosa", "seleccionaste Villa Barbosa"
          const fincaMatch = recentText.match(/(?:finca|propiedad|en la|seleccionaste|para|de)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
          if (fincaMatch) {
            searchTerms.push(fincaName === "" ? fincaMatch[1] : fincaName);
          }
        }

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

      // Intentar extraer numeroMascotas de la historia si falta en el JSON
      let petCount = Number(parsed.petCount || parsed.numeroMascotas || parsed.mascotas || 0);
      if (petCount === 0 && historyMessages.length > 0) {
        for (const msg of [...historyMessages].reverse()) {
          const text = msg.content.toLowerCase();
          // Regex para: "Mascotas: 2", "llevo 2 perros", "un gato", "sin mascotas"
          const match = text.match(/(?:mascotas|perros|gatos|animales)(?:\s*[:\-]\s*|\s+)(\d{1,2})/i)
                     || text.match(/(\d{1,2})\s+(?:mascotas|perros|gatos|animales)/i)
                     || (/\b(un|una)\s+(mascota|perro|gato|animal)\b/i.test(text) ? [null, "1"] : null);
          if (match) {
            petCount = parseInt(match[1], 10);
            break;
          }
        }
      }

      // Calcular noches si hay fechas
      let calculatedNoches = 0;
      if (parsed.checkInDate && parsed.checkOutDate) {
        try {
          const start = new Date(parsed.checkInDate + "T12:00:00");
          const end = new Date(parsed.checkOutDate + "T12:00:00");
          if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
            calculatedNoches = Math.round(
              (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
            );
          }
        } catch (e) {
          console.error("Error calculating nights:", e);
        }
      } else if (parsed.noches) {
        calculatedNoches = Number(parsed.noches);
      }

      // El total de alojamiento (sin extras)
      const stayPrice = Number(parsed.stayPrice || parsed.precioEstadia || 0);

      // 3. Obtener el precio oficial de la base de datos (Temporadas)
      let databasePrice: number | null = null;
      let databaseStayPrice: number | null = null;
      let appliedRuleName: string | null = null;

      if (resolvedPropertyId && parsed.checkInDate && parsed.checkOutDate) {
        try {
          const pricingRes = await ctx.runQuery(api.fincas.calculateStayPrice, {
            propertyId: resolvedPropertyId as any,
            fechaEntrada: String(parsed.checkInDate),
            fechaSalida: String(parsed.checkOutDate),
            numeroMascotas: petCount,
          });
          
          if (pricingRes && pricingRes.subtotal !== undefined && pricingRes.nightsCount !== undefined && pricingRes.subtotal > 0) {
            databasePrice = Math.round(pricingRes.subtotal / pricingRes.nightsCount);
            databaseStayPrice = pricingRes.subtotal;
            appliedRuleName = pricingRes.appliedRule || null;
          }

        } catch (e) {
          console.error("Error fetching database seasonal price:", e);
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
        checkInDate: parsed.checkInDate,
        checkOutDate: parsed.checkOutDate,
        checkInTime: formatTimeTo24h(
          String(parsed.entradaHora || parsed.checkInTime || ""),
        ),
        checkOutTime: formatTimeTo24h(
          String(parsed.salidaHora || parsed.checkOutTime || ""),
        ),
        nightlyPrice: (() => {
          // Si tenemos un precio de base de datos (temporada), ese manda SIEMPRE
          if (databasePrice !== null) {
            return String(databasePrice);
          }

          const rawNightly = Number(parsed.nightlyPrice || 0);
          const total = Number(parsed.totalPrice || parsed.precioTotal || 0);
          
          // REPARACIÓN AGRESIVA: Si no hay precio de DB pero tenemos noches
          if (calculatedNoches > 0) {
            let effectiveStayPrice = stayPrice;
            
            // Si el stayPrice es sospechoso (0 o igual al total teniendo mascotas), recalculamos
            if (effectiveStayPrice === 0 || (effectiveStayPrice === total && petCount > 0)) {
              const pets = Number(petCount || 0);
              let petSurcharge = 0;
              if (pets > 0 && pets <= 2) petSurcharge = pets * 100000;
              else if (pets >= 3) petSurcharge = pets * 30000;
              
              const derivedStayPrice = total - petSurcharge;
              if (derivedStayPrice > 0) {
                effectiveStayPrice = derivedStayPrice;
              }
            }

            if (effectiveStayPrice > 0) {
              const recalculated = Math.round(effectiveStayPrice / calculatedNoches);
              // Si el recalcula es un número "limpio" o el rawNightly parece erróneo, lo usamos
              if (rawNightly === 0 || rawNightly % 100 !== 0 || Math.abs(recalculated - rawNightly) > 100) {
                return String(recalculated);
              }
            }
          }
          return String(parsed.nightlyPrice || "");
        })(),
        totalPrice: databaseStayPrice !== null 
          ? String(databaseStayPrice + (Number(parsed.totalPrice || 0) - (stayPrice || databaseStayPrice))) // Intentar mantener extras si existen
          : String(parsed.totalPrice || parsed.precioTotal || ""),
        stayPrice: databaseStayPrice || (calculatedNoches > 0 && Number(parsed.totalPrice || 0) > 0 ? Number(parsed.totalPrice || 0) : stayPrice) || undefined,
        appliedSeason: appliedRuleName || undefined,
        numeroPersonas,
        petCount,
        propertyId: resolvedPropertyId,
      };


    };

    // 1. Intentar encontrar un bloque [CONTRACT_PDF:...] ya generado (SOLUCIÓN RÁPIDA)
    if (!forceFresh) {
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

REGLAS DE PRECIO IMPORTANTES:
- nightlyPrice: PRECIO POR NOCHE del alojamiento solamente (sin depósitos ni extras).
- stayPrice: SUBTOTAL del alojamiento solamente (nightlyPrice * número de noches). Sin mascotas ni depósitos.
- totalPrice: VALOR TOTAL de la operación incluyendo mascotas, depósitos y todo lo mencionado.

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
- nightlyPrice: precio por noche (solo números, sin extras)
- stayPrice: total solo estadía (solo números, sin extras)
- totalPrice: precio total final (solo números, incluyendo todo)
- numeroPersonas: cantidad TOTAL de personas/huéspedes (solo el número, ej. 10)
- petCount: cantidad de mascotas (solo el número, ej. 2)
- fincaName: nombre de la finca
- propertyId: ID de la finca
- noches: número de noches (opcional pero recomendado)

Mensajes:\n${history}`;


    const { text } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
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
