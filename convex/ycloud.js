"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAllAssistantMessages = exports.backfillTemplateMessages = exports.extractContractData = exports.sendWhatsAppCatalogList = exports.maybeSendCatalogForUserMessage = exports.maybeSendSingleFincaCatalogForUserMessage = exports.detectCatalogIntentWithAI = exports.maybeSendWhatsappTemplateReply = exports.selectWhatsappTemplateWithAI = exports.sendWhatsAppTemplateMessage = exports.sendWhatsAppMessage = exports.markOutboundAsHuman = exports.generateReplyWithRagAndFincas = exports.processInboundMessage = exports.getOrCreateConversation = exports.getOrCreateContact = exports.recordProcessedEvent = void 0;
exports.isAffirmativeOnly = isAffirmativeOnly;
exports.isProvidingFollowUpData = isProvidingFollowUpData;
exports.isNegativeOnly = isNegativeOnly;
const openai_1 = require("@ai-sdk/openai");
const ai_1 = require("ai");
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
const rag_1 = __importDefault(require("./rag"));
const consultantPrompt_1 = require("./lib/consultantPrompt");
const transcription_1 = require("./lib/transcription");
function isAffirmativeOnly(userMessage) {
    const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w\s]/g, "");
    if (t.length > 50)
        return false;
    return /^(s[ií]|si(\s+.*)?|ok|okey|dale|claro|va|yes|listo|bueno|uhum|aja|por\s+supuesto|adelante|confirmo|exacto|eso(\s+mismo)?)$/i.test(t);
}
function isProvidingFollowUpData(userMessage) {
    const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    if (/\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|para\s+\d+|huespedes|personas)\b/i.test(t))
        return true;
    if (/\b(mascotas?|perros?|gatos?|llevamos|traemos|2 mascot|sin mascot)\b/i.test(t))
        return true;
    if (/\b(personal|servicio|empleada|cocinera|aseo)\b/i.test(t))
        return true;
    if (/\b(confirmo|de\s+acuerdo|entendido|leido|requerimientos|convivencia)\b/i.test(t))
        return true;
    return false;
}
function isNegativeOnly(userMessage) {
    const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w\s]/g, "");
    if (t.length > 50)
        return false;
    return /^(no(\s+.*)?|nada|ningun[oa]|tampoco|ni\s+idea|para\s+nada)$/i.test(t);
}
exports.recordProcessedEvent = (0, server_1.internalMutation)({
    args: { eventId: values_1.v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("ycloudProcessedEvents")
            .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
            .unique();
        if (existing)
            return { duplicate: true };
        await ctx.db.insert("ycloudProcessedEvents", { eventId: args.eventId });
        return { duplicate: false };
    },
});
exports.getOrCreateContact = (0, server_1.internalMutation)({
    args: { phone: values_1.v.string(), name: values_1.v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("contacts")
            .withIndex("by_phone", (q) => q.eq("phone", args.phone))
            .unique();
        if (existing)
            return existing._id;
        const now = Date.now();
        return await ctx.db.insert("contacts", {
            phone: args.phone,
            name: args.name || args.phone,
            createdAt: now,
            updatedAt: now,
        });
    },
});
exports.getOrCreateConversation = (0, server_1.internalMutation)({
    args: { contactId: values_1.v.id("contacts") },
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
        return { conversationId, isNew: true };
    },
});
exports.processInboundMessage = (0, server_1.internalAction)({
    args: {
        eventId: values_1.v.string(),
        phone: values_1.v.string(),
        name: values_1.v.string(),
        text: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal("text"), values_1.v.literal("image"), values_1.v.literal("audio"), values_1.v.literal("video"), values_1.v.literal("document"))),
        mediaUrl: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const contactId = await ctx.runMutation(api_1.internal.ycloud.getOrCreateContact, { phone: args.phone, name: args.name });
        const { conversationId, isNew } = await ctx.runMutation(api_1.internal.ycloud.getOrCreateConversation, { contactId });
        const now = Date.now();
        let finalContent = args.text;
        if (args.type === "audio" && args.mediaUrl) {
            try {
                console.log("[transcription] Iniciando transcripción...");
                const allFincas = await ctx.runQuery(api_1.api.fincas.search, { query: " ", limit: 1000 });
                const fincaNames = allFincas.map(p => p.title).join(", ");
                const contextualPrompt = `FincasYa, reservación de fincas, hospedaje, fin de semana. Fincas: ${fincaNames}. Palabras clave: mascotas, adultos, niños, personas, depósito, reserva, entrada, salida, disponibilidad.`;
                const transcription = await (0, transcription_1.transcribeAudio)(args.mediaUrl, contextualPrompt);
                console.log("[transcription] Resultado:", transcription);
                finalContent = `[Voz] ${transcription}`;
            }
            catch (err) {
                console.error("[voice] Error transcribiendo audio:", err);
                finalContent = "[Audio] (Transcripción fallida)";
            }
        }
        await ctx.runMutation(api_1.internal.messages.insertUserMessage, {
            conversationId,
            content: finalContent,
            createdAt: now,
            type: args.type,
            mediaUrl: args.mediaUrl,
        });
        const DEBOUNCE_MS = 5000;
        await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
        const convAfterDebounce = await ctx.runQuery(api_1.api.conversations.getById, {
            conversationId,
        });
        if (!convAfterDebounce)
            return;
        if ((convAfterDebounce.lastMessageAt ?? 0) > now) {
            console.log("[debounce] Mensaje más nuevo detectado, cediendo turno al handler posterior", {
                phone: args.phone,
                theirMessageAt: now,
                newerMessageAt: convAfterDebounce.lastMessageAt,
            });
            return;
        }
        const conv = convAfterDebounce;
        const shouldReply = conv.status === "ai";
        if (shouldReply) {
            let currentMessageText = (args.type === "audio" && finalContent.startsWith("[Voz]"))
                ? finalContent
                : (args.text || "");
            let singleFincaSent = false;
            let fincaTitle = "";
            let whatsappCatalogSentForSearch = false;
            let catalogLocation = "";
            let catalogFincasCount = 0;
            let catalogFoundFincasButFailed = false;
            let catalogIntent = { intent: "none" };
            const recentForCatalogIntent = await ctx.runQuery(api_1.api.messages.listRecent, {
                conversationId,
                limit: 14,
            });
            const catalogIntentSnippet = recentForCatalogIntent
                .map((m) => `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 320)}`)
                .join("\n");
            let imageIdentifiedFincaName;
            let confirmedFincaTitle;
            if (args.type === "image" && args.mediaUrl) {
                try {
                    console.log("[vision] Analizando imagen del usuario...");
                    const allFincas = await ctx.runQuery(api_1.api.fincas.search, {
                        query: " ",
                        limit: 50,
                    });
                    const fincaNames = allFincas.map((f) => f.title).join(", ");
                    const { text: visionResult } = await (0, ai_1.generateText)({
                        model: openai_1.openai.chat("gpt-5-mini"),
                        temperature: 0,
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
                        catalogIntent = { intent: "single_finca", fincaName: imageIdentifiedFincaName };
                    }
                    else {
                        console.log("[vision] No se pudo identificar la finca de la imagen");
                    }
                }
                catch (e) {
                    console.error("[vision] Error analizando imagen:", e);
                }
            }
            try {
                catalogIntent = await ctx.runAction(api_1.internal.ycloud.detectCatalogIntentWithAI, {
                    userMessage: imageIdentifiedFincaName
                        ? `Quiero reservar la finca ${imageIdentifiedFincaName}`
                        : currentMessageText,
                    conversationSnippet: catalogIntentSnippet,
                });
            }
            catch (e) {
                console.error("YCloud detectCatalogIntentWithAI error:", e);
            }
            if (imageIdentifiedFincaName) {
                catalogIntent = { intent: "single_finca", fincaName: imageIdentifiedFincaName };
            }
            const followUpData = isProvidingFollowUpData(currentMessageText)
                && catalogIntent.intent !== "single_finca";
            try {
                if (!followUpData) {
                    const result = await ctx.runAction(api_1.internal.ycloud.maybeSendSingleFincaCatalogForUserMessage, {
                        phone: args.phone,
                        conversationId,
                        userMessage: imageIdentifiedFincaName
                            ? `Quiero reservar la finca ${imageIdentifiedFincaName}`
                            : currentMessageText,
                        wamid: args.wamid,
                        extractedFincaName: catalogIntent.intent === "single_finca"
                            ? catalogIntent.fincaName
                            : undefined,
                    });
                    if (result && result.sent && result.fincaTitle) {
                        singleFincaSent = true;
                        fincaTitle = result.fincaTitle;
                        confirmedFincaTitle = result.fincaTitle;
                    }
                }
            }
            catch (e) {
                console.error("YCloud single-finca catalog error:", e);
            }
            try {
                if (!singleFincaSent) {
                    console.log("[catalog-intent]", JSON.stringify(catalogIntent));
                    const invalidSearchLocations = /\b(dias?|personas?|fincas?|reservar?|noches?|una|los|las|el|la)\b/i;
                    const catalogIntentArg = catalogIntent.intent === "more_options"
                        ? catalogIntent
                        : catalogIntent.intent === "search_catalog" &&
                            catalogIntent.location &&
                            catalogIntent.location.length >= 3 &&
                            !invalidSearchLocations.test(catalogIntent.location)
                            ? catalogIntent
                            : undefined;
                    const catalogRes = await ctx.runAction(api_1.internal.ycloud.maybeSendCatalogForUserMessage, {
                        conversationId,
                        phone: args.phone,
                        userMessage: currentMessageText,
                        wamid: args.wamid,
                        catalogIntent: catalogIntentArg,
                    });
                    whatsappCatalogSentForSearch = catalogRes?.sent ?? false;
                    catalogLocation = catalogRes?.location ?? "";
                    catalogFincasCount = catalogRes?.fincasCount ?? 0;
                    if (!whatsappCatalogSentForSearch && catalogRes?.fincasFoundButNoCatalog) {
                        catalogFoundFincasButFailed = true;
                        catalogLocation = catalogRes.location ?? "";
                        catalogFincasCount = catalogRes.fincasCount ?? 0;
                    }
                }
            }
            catch (e) {
                console.error("YCloud catalog send error:", e);
            }
            if (!whatsappCatalogSentForSearch &&
                !singleFincaSent &&
                catalogIntent.intent !== "single_finca") {
                const dynamicLocationsList_pre = await ctx.runQuery(api_1.api.fincas.getAllUniqueLocations, {});
                const msgLower_pre = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
                const matchedCity = dynamicLocationsList_pre.find((loc) => msgLower_pre.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")));
                if (matchedCity) {
                    console.log("[catalog-fallback] Ciudad detectada sin catálogo, forzando envío:", matchedCity);
                    try {
                        const catalogRes = await ctx.runAction(api_1.internal.ycloud.maybeSendCatalogForUserMessage, {
                            conversationId,
                            phone: args.phone,
                            userMessage: currentMessageText,
                            wamid: args.wamid,
                            catalogIntent: {
                                intent: "search_catalog",
                                location: matchedCity,
                                hasWeekend: true,
                            },
                        });
                        whatsappCatalogSentForSearch = catalogRes?.sent ?? false;
                        catalogLocation = catalogRes?.location ?? matchedCity;
                        catalogFincasCount = catalogRes?.fincasCount ?? 0;
                        if (!whatsappCatalogSentForSearch && catalogRes?.fincasFoundButNoCatalog) {
                            catalogFoundFincasButFailed = true;
                        }
                    }
                    catch (e) {
                        console.error("YCloud catalog fallback error:", e);
                    }
                }
            }
            let templateSent = false;
            const isProvidingData = /\d{7,}/.test(currentMessageText) || /@\w+\.\w+/.test(currentMessageText);
            const isSpecificFinca = singleFincaSent || catalogIntent.intent === "single_finca";
            const dynamicLocationsList = await ctx.runQuery(api_1.api.fincas.getAllUniqueLocations, {});
            const msgLower = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
            const mentionsCityOrFinca = dynamicLocationsList.some((loc) => msgLower.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")));
            const mentionsDatesOrPersonas = /\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|personas?|fin de semana)\b/i.test(currentMessageText);
            const mentionsBookingIntent = /\b(reservar|alquilar|arrendar|finca\s+en|fincas\s+en|fincas\s+de|finca\s+de|finca\s+para)\b/i.test(currentMessageText);
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
                    const routed = await ctx.runAction(api_1.internal.ycloud.maybeSendWhatsappTemplateReply, {
                        phone: args.phone,
                        wamid: args.wamid,
                        conversationId,
                        userMessage: currentMessageText,
                    });
                    templateSent = routed?.sent ?? false;
                }
                catch (e) {
                    console.error("YCloud maybeSendWhatsappTemplateReply error:", e);
                }
            }
            if (templateSent) {
                await ctx.runMutation(api_1.internal.conversations.updateLastMessageAt, {
                    conversationId,
                });
                return;
            }
            const searchOverride = catalogIntent.intent === "single_finca"
                ? catalogIntent.fincaName
                : singleFincaSent && fincaTitle
                    ? fincaTitle
                    : undefined;
            const dynamicLocations = dynamicLocationsList.join(", ");
            const replyText = await ctx.runAction(api_1.internal.ycloud.generateReplyWithRagAndFincas, {
                conversationId,
                userMessage: currentMessageText,
                singleFincaCatalogSent: singleFincaSent,
                fincaTitle,
                searchQueryOverride: searchOverride,
                whatsappCatalogSentForSearch,
                dynamicLocations,
                catalogLocation,
                catalogFincasCount,
                catalogFoundFincasButFailed,
                imageUrl: args.type === "image" && args.mediaUrl ? args.mediaUrl : undefined,
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
                            if (c === "{")
                                depth++;
                            else if (c === "}") {
                                depth--;
                                if (depth === 0) {
                                    jsonEnd = i + 1;
                                    break;
                                }
                            }
                        }
                    }
                    const jsonStr = jsonEnd > 0 ? replyText.slice(jsonStart, jsonEnd) : null;
                    if (jsonStr) {
                        try {
                            const parsed = JSON.parse(jsonStr);
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
                            const alreadyHasPaymentInfo = cleanReplyText.includes("RNT") || cleanReplyText.includes("50%") || cleanReplyText.includes("Proceso de reserva");
                            const textToSend = cleanReplyText
                                ? (alreadyHasPaymentInfo
                                    ? cleanReplyText
                                    : `${cleanReplyText}\n\n${PAYMENT_PROCESS_TEXT}`)
                                : `¡Listo! He recibido todos tus datos para la reserva. ✨\n\n${PAYMENT_PROCESS_TEXT}`;
                            await ctx.runAction(api_1.internal.ycloud.sendWhatsAppMessage, {
                                to: args.phone,
                                text: textToSend,
                                wamid: args.wamid,
                            });
                            await ctx.runMutation(api_1.internal.conversations.escalate, {
                                conversationId,
                            });
                        }
                        catch (parseErr) {
                            console.error("CONTRACT_PDF parse/send error:", parseErr);
                            await ctx.runAction(api_1.internal.ycloud.sendWhatsAppMessage, {
                                to: args.phone,
                                text: replyText,
                                wamid: args.wamid,
                            });
                        }
                    }
                    else {
                        await ctx.runAction(api_1.internal.ycloud.sendWhatsAppMessage, {
                            to: args.phone,
                            text: replyText,
                            wamid: args.wamid,
                        });
                        const isBookingClosing = replyText.includes("RNT") ||
                            replyText.includes("Proceso de reserva") ||
                            replyText.includes("50% del valor") ||
                            replyText.includes("163658");
                        if (isBookingClosing) {
                            await ctx.runMutation(api_1.internal.conversations.escalate, {
                                conversationId,
                            });
                        }
                    }
                }
                catch (e) {
                    console.error("YCloud send error:", e);
                }
            }
        }
        await ctx.runMutation(api_1.internal.conversations.updateLastMessageAt, {
            conversationId,
        });
    },
});
exports.generateReplyWithRagAndFincas = (0, server_1.internalAction)({
    args: {
        conversationId: values_1.v.id("conversations"),
        userMessage: values_1.v.string(),
        singleFincaCatalogSent: values_1.v.optional(values_1.v.boolean()),
        fincaTitle: values_1.v.optional(values_1.v.string()),
        searchQueryOverride: values_1.v.optional(values_1.v.string()),
        whatsappCatalogSentForSearch: values_1.v.optional(values_1.v.boolean()),
        dynamicLocations: values_1.v.optional(values_1.v.string()),
        catalogLocation: values_1.v.optional(values_1.v.string()),
        catalogFincasCount: values_1.v.optional(values_1.v.number()),
        catalogFoundFincasButFailed: values_1.v.optional(values_1.v.boolean()),
        imageUrl: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const ragResult = await rag_1.default.search(ctx, {
            namespace: "fincas",
            query: args.searchQueryOverride ?? args.userMessage,
            limit: 5,
        });
        const searchQuery = (args.searchQueryOverride ?? args.userMessage).trim();
        const fincasList = await ctx.runQuery(api_1.api.fincas.search, {
            query: searchQuery,
            limit: 12,
        });
        const catalogAlreadyShown = args.whatsappCatalogSentForSearch === true;
        const recentMessages = await ctx.runQuery(api_1.api.messages.listRecent, {
            conversationId: args.conversationId,
            limit: 14,
        });
        let fincasContext;
        const catalogFailed = args.catalogFoundFincasButFailed === true;
        if (catalogAlreadyShown && args.catalogLocation) {
            fincasContext = `(El sistema YA ENVIÓ EXITOSAMENTE el catálogo interactivo de WhatsApp con ${args.catalogFincasCount || "varias"} fincas disponibles en ${args.catalogLocation}. El cliente ya puede ver nombres, fotos y precios directamente en su pantalla. Responde siguiendo EXACTAMENTE el formato del PASO 2: menciona que compartiste el catálogo en ${args.catalogLocation}, y luego pide los datos faltantes con viñetas: ● 🏡 ¿Cuál de estas fincas te llamó la atención? ● 📅 Fechas exactas de tu estadía ● 👨‍👩‍👧‍👦 Número total de personas ● 🐾 ¿Llevarán mascotas? Omite los datos que el cliente ya haya proporcionado, pero SIEMPRE incluye la pregunta de finca y mascotas. NO repitas lista de fincas en texto. Termina con "Quedo atento a tu respuesta. 😊")`;
        }
        else if (catalogAlreadyShown) {
            fincasContext = "(Ya se envió el catálogo de WhatsApp con las fincas; el cliente ve nombres, fotos y precios ahí. Sigue el PASO 2: pregunta cuál finca le llamó la atención, fechas, personas y mascotas. NO repitas lista de fincas en texto.)";
        }
        else if (catalogFailed && fincasList.length > 0) {
            fincasContext = `⚠️ MODO FALLBACK (catálogo interactivo NO disponible para esta ciudad): El sistema intentó enviar el catálogo de WhatsApp pero las fincas no están registradas en el catálogo de Meta. DEBES mencionar en texto las fincas disponibles con sus precios (excepción a la regla de no listar). Fincas encontradas:\n${formatFincasForPrompt(fincasList)}`;
        }
        else {
            fincasContext = formatFincasForPrompt(fincasList);
        }
        if (fincasList.length > 0 && !catalogAlreadyShown) {
            const fullConversationText = [
                ...recentMessages.map((m) => m.content),
                args.userMessage,
            ].join(" ");
            const monthNames = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
            const dateRangeMatch = fullConversationText.match(/(?:del\s+|desde el\s+|desde\s+)?(\d{1,2})\s*(?:al|hasta el|hasta|a)\s*(\d{1,2})/i);
            const monthMatch = fullConversationText.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i);
            let parsedDates = null;
            if (dateRangeMatch) {
                const d1 = parseInt(dateRangeMatch[1], 10);
                const d2 = parseInt(dateRangeMatch[2], 10);
                const now = new Date();
                const monthIndex = monthMatch ? monthNames[monthMatch[1].toLowerCase()] ?? now.getMonth() : now.getMonth();
                const year = now.getFullYear();
                const monthNum = String(monthIndex + 1).padStart(2, '0');
                parsedDates = {
                    start: `${year}-${monthNum}-${String(d1).padStart(2, '0')}`,
                    end: `${year}-${monthNum}-${String(d2).padStart(2, '0')}`
                };
            }
            const pricingBlocks = [];
            const availabilityBlocks = [];
            for (const finca of fincasList.slice(0, 8)) {
                try {
                    if (parsedDates) {
                        const pricingRes = await ctx.runQuery(api_1.api.fincas.calculateStayPrice, {
                            propertyId: finca._id,
                            fechaEntrada: parsedDates.start,
                            fechaSalida: parsedDates.end,
                        });
                        if (pricingRes && pricingRes.total > 0) {
                            const breakdown = pricingRes.nights.map((n) => `    - ${n.date} (${n.ruleName}): $${n.price.toLocaleString("es-CO")}`).join("\n");
                            pricingBlocks.push(`📋 DESGLOSE DE PRECIOS PARA ${finca.title} (${parsedDates.start} al ${parsedDates.end}):
    Total: $${pricingRes.total.toLocaleString("es-CO")} (${pricingRes.nightsCount} noches)
    Desglose:
${breakdown}
  ⚠️ INSTRUCCIÓN: Informa al cliente este TOTAL EXACTO de $${pricingRes.total.toLocaleString("es-CO")} y menciona brevemente por qué varía el precio (ej. noches de fin de semana o temporada).`);
                        }
                    }
                    const rules = await ctx.runQuery(api_1.api.fincas.getPropertyPricingRules, {
                        propertyId: finca._id,
                    });
                    if (rules.length > 0 && (!parsedDates || pricingBlocks.length === 0)) {
                        const reglaLines = rules.map((r) => {
                            const rango = r.fechaDesde && r.fechaHasta ? `${r.fechaDesde} al ${r.fechaHasta}` : "general";
                            return `  - ${r.nombre} (${rango}): $${(r.valorUnico || 0).toLocaleString("es-CO")}/noche`;
                        }).join("\n");
                        pricingBlocks.push(`📋 Tarifas generales de ${finca.title}:\n${reglaLines}`);
                    }
                }
                catch (e) {
                    console.log("[pricing] Error calculating price for", finca.title, e);
                }
                try {
                    const availability = await ctx.runQuery(api_1.api.fincas.getPropertyAvailability, {
                        propertyId: finca._id,
                        monthsAhead: 3,
                    });
                    if (availability.length > 0) {
                        const busyLines = availability.map((b) => {
                            const d1 = new Date(b.fechaEntrada).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
                            const d2 = new Date(b.fechaSalida).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
                            return `  - [${d1} al ${d2}] (${b.reason})`;
                        }).join("\n");
                        availabilityBlocks.push(`🗓️ CALENDARIO DE OCUPACIÓN (${finca.title}):\n${busyLines}`);
                    }
                    else {
                        availabilityBlocks.push(`🗓️ CALENDARIO DE OCUPACIÓN (${finca.title}): Totalmente disponible por ahora.`);
                    }
                }
                catch (e) {
                    console.log("[availability] Error fetching availability for", finca.title, e);
                }
            }
            if (pricingBlocks.length > 0) {
                fincasContext += `\n\n## 📅 REGLAS DE TEMPORADA Y PRECIOS POR FINCA\n${pricingBlocks.join("\n\n")}\n\nUSA siempre el PRECIO APLICABLE marcado con ⚠️ si existe. Si no, usa el precio Base de la finca. NUNCA inventes precios.`;
            }
            else {
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
            hasImage: !!args.imageUrl,
        });
        const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
        const historyCutoff = Date.now() - HISTORY_TTL_MS;
        const freshMessages = recentMessages.filter((m) => m.createdAt >= historyCutoff);
        console.log("[history-ttl] mensajes en contexto:", freshMessages.length, "/", recentMessages.length);
        const messages = [];
        for (let idx = 0; idx < freshMessages.length; idx++) {
            const m = freshMessages[idx];
            const isUser = m.sender === "user";
            const isLastUserMsg = isUser && idx === freshMessages.length - 1;
            if (isLastUserMsg && args.imageUrl) {
                messages.push({
                    role: "user",
                    content: [
                        { type: "text", text: m.content || "El usuario envió esta imagen." },
                        { type: "image", image: new URL(args.imageUrl) },
                    ],
                });
            }
            else if (isUser) {
                messages.push({ role: "user", content: m.content });
            }
            else {
                messages.push({ role: "assistant", content: m.content });
            }
        }
        const { text } = await (0, ai_1.generateText)({
            model: openai_1.openai.chat("gpt-5-mini"),
            temperature: 1,
            system: systemPrompt,
            messages,
        });
        await ctx.runMutation(api_1.internal.messages.insertAssistantMessage, {
            conversationId: args.conversationId,
            content: text,
            createdAt: Date.now(),
        });
        return text;
    },
});
function formatFincasForPrompt(list) {
    if (!list?.length)
        return "";
    return list
        .map((p) => `- ${p.title} (ID: ${p._id}): ${p.description ?? ""} | Ubicación: ${p.location ?? "N/A"} | Capacidad: ${p.capacity ?? "N/A"} personas | Precio base/noche: $${(p.priceBase ?? 0).toLocaleString("es-CO")}`)
        .join("\n");
}
function buildSystemPrompt(ragContext, fincasContext, opts) {
    let basePrompt = consultantPrompt_1.CONSULTANT_SYSTEM_PROMPT;
    if (opts?.dynamicLocations) {
        basePrompt = basePrompt.replace(/{DYNAMIC_LOCATIONS_LIST}/g, opts.dynamicLocations);
    }
    else {
        basePrompt = basePrompt.replace(/{DYNAMIC_LOCATIONS_LIST}/g, "nuestros destinos disponibles");
    }
    const singleFincaHint = opts?.singleFincaCatalogSent && opts?.fincaTitle
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
    return `${basePrompt}${dynamicLocationsText}${priorityInstructions}${singleFincaHint}${multiCatalogHint}${visionHint}${voiceHint}${officialNameHint}

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
exports.markOutboundAsHuman = (0, server_1.internalMutation)({
    args: { phone: values_1.v.string() },
    handler: async (ctx, args) => {
        const contact = await ctx.db
            .query("contacts")
            .withIndex("by_phone", (q) => q.eq("phone", args.phone))
            .unique();
        if (!contact)
            return;
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
exports.sendWhatsAppMessage = (0, server_1.internalAction)({
    args: {
        to: values_1.v.string(),
        text: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
        sendDirectly: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const apiKey = process.env.YCLOUD_API_KEY;
        const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
        if (!apiKey || !wabaNumber) {
            throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex (npx convex env set ...)");
        }
        const endpoint = args.sendDirectly
            ? "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly"
            : "https://api.ycloud.com/v2/whatsapp/messages";
        const body = {
            from: wabaNumber,
            to: args.to,
            type: "text",
            text: { body: args.text.replace(/\[CONTRACT_PDF:.*?\]/g, "").trim() },
        };
        if (args.wamid)
            body.context = { message_id: args.wamid };
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
const YCLOUD_SEND_DIRECTLY = "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly";
const TEMPLATE_ROUTING_DENYLIST = new Set(["chat_center"]);
function templateRoutingDisabled() {
    const envVal = process.env.YCLOUD_TEMPLATE_ROUTING?.trim().toLowerCase();
    return (envVal === "0" ||
        envVal === "false" ||
        envVal === "off" ||
        envVal === "no");
}
function isTemplateApproved(status) {
    return String(status ?? "").toUpperCase() === "APPROVED";
}
function bodyHasVariables(components) {
    if (!components?.length)
        return false;
    for (const c of components) {
        if (c.type === "BODY" &&
            typeof c.text === "string" &&
            c.text.includes("{{")) {
            return true;
        }
    }
    return false;
}
function buildIntentHintFromName(name) {
    return name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function itemsToRoutable(items, onlyWabaId) {
    const extraDeny = new Set((process.env.YCLOUD_TEMPLATE_ROUTING_DENYLIST ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean));
    const out = [];
    const seen = new Set();
    for (const t of items) {
        if (onlyWabaId &&
            (!t.wabaId || String(t.wabaId) !== onlyWabaId))
            continue;
        if (!isTemplateApproved(t.status))
            continue;
        if (bodyHasVariables(t.components))
            continue;
        if (TEMPLATE_ROUTING_DENYLIST.has(t.name) || extraDeny.has(t.name))
            continue;
        const lang = (t.language || "es").trim();
        const key = `${t.name}:${lang}`;
        if (seen.has(key))
            continue;
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
async function fetchYCloudTemplateItems(apiKey, withWabaFilter, wabaId) {
    const params = new URLSearchParams({ limit: "100" });
    if (withWabaFilter && wabaId)
        params.set("filter.wabaId", wabaId);
    const res = await fetch(`${YCLOUD_TEMPLATES_LIST}?${params.toString()}`, {
        headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("fetchYCloudTemplateItems error:", res.status, txt);
        return [];
    }
    const data = (await res.json());
    return data.items ?? [];
}
async function fetchRoutableTemplates() {
    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey)
        return [];
    const wabaId = process.env.YCLOUD_WABA_ID?.trim();
    let items = await fetchYCloudTemplateItems(apiKey, true, wabaId);
    if (items.length === 0 && wabaId) {
        console.warn("[template-routing] listado vacío con filter.wabaId; reintentando sin filtro y filtrando por wabaId en items");
        items = await fetchYCloudTemplateItems(apiKey, false, undefined);
    }
    return itemsToRoutable(items, wabaId || undefined);
}
function pickTemplateByKeywords(userMessage, routable) {
    const msg = userMessage.toLowerCase().normalize("NFD");
    const ascii = msg.replace(/\p{M}/gu, "");
    const byName = (n) => routable.find((t) => t.name === n);
    const pick = (templateName) => {
        const t = byName(templateName);
        return t ? { name: t.name, language: t.language } : null;
    };
    const rules = [
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
    const looksLikeGreeting = /^(hola|holaa|hey|buenos|buenas|buen\s+d[ií]a|qu[eé]\s+tal|saludos|hi)\b/i.test(trim) ||
        /^(info|informaci[oó]n|quiero\s+(una\s+)?finca|busco\s+(una\s+)?finca|necesito\s+finca|me\s+ayudas|ayuda)\b/i.test(trim);
    if (shortMsg && looksLikeGreeting) {
        const preferred = process.env.YCLOUD_WELCOME_TEMPLATE_NAME?.trim() || "bienvenida_hernan";
        const order = [preferred, "bienvenida_hernan", "bienvenida"];
        const seenNames = new Set();
        for (const n of order) {
            if (seenNames.has(n))
                continue;
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
exports.sendWhatsAppTemplateMessage = (0, server_1.internalAction)({
    args: {
        to: values_1.v.string(),
        templateName: values_1.v.string(),
        language: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
    },
    handler: async (_ctx, args) => {
        const apiKey = process.env.YCLOUD_API_KEY;
        const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
        if (!apiKey || !wabaNumber) {
            throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
        }
        const baseBody = {
            from: wabaNumber,
            to: args.to,
            type: "template",
            template: {
                name: args.templateName,
                language: { code: args.language },
            },
        };
        const post = (body) => fetch(YCLOUD_SEND_DIRECTLY, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey,
            },
            body: JSON.stringify(body),
        });
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
        return JSON.parse(textRes);
    },
});
exports.selectWhatsappTemplateWithAI = (0, server_1.internalAction)({
    args: {
        userMessage: values_1.v.string(),
        conversationSnippet: values_1.v.string(),
        templatesJson: values_1.v.string(),
    },
    handler: async (_ctx, args) => {
        const { text: modelText } = await (0, ai_1.generateText)({
            model: openai_1.openai.chat("gpt-5-mini"),
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
            const parsed = JSON.parse(raw);
            if (parsed.choice !== "TEMPLATE")
                return null;
            const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
            const language = typeof parsed.language === "string" ? parsed.language.trim() : "";
            if (!name || !language)
                return null;
            return { name, language };
        }
        catch (err) {
            console.error("selectWhatsappTemplateWithAI parse error:", err, modelText);
            return null;
        }
    },
});
exports.maybeSendWhatsappTemplateReply = (0, server_1.internalAction)({
    args: {
        phone: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
        conversationId: values_1.v.id("conversations"),
        userMessage: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        if (templateRoutingDisabled()) {
            console.log("[template-routing] desactivado por YCLOUD_TEMPLATE_ROUTING");
            return { sent: false };
        }
        if (isAffirmativeOnly(args.userMessage) || isNegativeOnly(args.userMessage)) {
            console.log("[template-routing] solo afirmación/negación (sí/no); no enviar plantilla");
            return { sent: false };
        }
        let routable = [];
        try {
            routable = await fetchRoutableTemplates();
        }
        catch (e) {
            console.error("fetchRoutableTemplates error:", e);
            return { sent: false };
        }
        if (routable.length === 0) {
            console.warn("[template-routing] 0 plantillas enrutables (revisa YCLOUD_API_KEY, YCLOUD_WABA_ID, APPROVED y sin {{}} en BODY)");
            return { sent: false };
        }
        const recent = await ctx.runQuery(api_1.api.messages.listRecent, {
            conversationId: args.conversationId,
            limit: 8,
        });
        const snippet = recent
            .map((m) => `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 280)}`)
            .join("\n");
        const templatesJson = JSON.stringify(routable);
        let picked = pickTemplateByKeywords(args.userMessage, routable);
        if (!picked) {
            try {
                picked = await ctx.runAction(api_1.internal.ycloud.selectWhatsappTemplateWithAI, {
                    userMessage: args.userMessage,
                    conversationSnippet: snippet,
                    templatesJson,
                });
            }
            catch (e) {
                console.error("selectWhatsappTemplateWithAI error:", e);
            }
        }
        if (!picked) {
            console.log("[template-routing] sin match (keywords + IA NONE o error). Plantillas enrutables:", routable.length);
            return { sent: false };
        }
        const valid = routable.some((t) => t.name === picked.name && t.language === picked.language);
        if (!valid) {
            console.warn("[template-routing] nombre/idioma inválido respecto a la lista:", picked);
            return { sent: false };
        }
        console.log("[template-routing] enviando plantilla:", picked.name, picked.language);
        try {
            await ctx.runAction(api_1.internal.ycloud.sendWhatsAppTemplateMessage, {
                to: args.phone,
                templateName: picked.name,
                language: picked.language,
                wamid: args.wamid,
            });
        }
        catch (e) {
            console.error("sendWhatsAppTemplateMessage error:", e);
            return { sent: false };
        }
        const pickedTemplate = routable.find((t) => t.name === picked.name && t.language === picked.language);
        await ctx.runMutation(api_1.internal.messages.insertAssistantMessage, {
            conversationId: args.conversationId,
            content: pickedTemplate?.body || `[Plantilla WhatsApp: ${picked.name}]`,
            createdAt: Date.now(),
        });
        return { sent: true, templateName: picked.name };
    },
});
exports.detectCatalogIntentWithAI = (0, server_1.internalAction)({
    args: {
        userMessage: values_1.v.string(),
        conversationSnippet: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const now = new Date();
        const month = now.getMonth();
        const year = now.getFullYear();
        const snippet = (args.conversationSnippet ?? "").trim();
        const { text } = await (0, ai_1.generateText)({
            model: openai_1.openai.chat("gpt-5-mini"),
            temperature: 1,
            system: `Eres un clasificador. Del mensaje del usuario extrae la intención y datos. Responde SOLO con un JSON válido, sin markdown, sin explicación.

Reglas:
- intent: "single_finca" si pide VER o RESERVAR una finca específica por nombre (ej. "quiero ver villa green", "me gustaría reservar la finca X", "quinto la finca X", "esta es la finca que elegí"). **CRÍTICO:** Aunque el mensaje incluya fechas, personas u otros datos de reserva, si menciona un nombre de finca específico, DEBES marcarlo como "single_finca". También si es una confirmación para una finca mencionada justo antes. En fincaName pon solo el nombre de la finca en minúsculas.
- intent: "more_options" si pide otras opciones, más opciones, no le gustan, envía más, otras fincas, dame otras.
- intent: "search_catalog" SOLO SI MENCIONA EXPLÍCITAMENTE UN MUNICIPIO O CIUDAD (ej. Villeta, Melgar, etc.) Y NO MENCIONA UNA FINCA CONCRETA. Si menciona una finca, prioriza "single_finca".
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
            const parsed = JSON.parse(raw);
            const intent = parsed.intent;
            if (intent === "single_finca" && typeof parsed.fincaName === "string" && parsed.fincaName.trim()) {
                return { intent: "single_finca", fincaName: (parsed.fincaName).trim() };
            }
            if (intent === "more_options")
                return { intent: "more_options" };
            if (intent === "search_catalog" && typeof parsed.location === "string" && parsed.location.trim()) {
                const loc = normalizeCatalogLocation((parsed.location).replace(/[^\wáéíóúñ\s]/gi, "").trim());
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
        }
        catch {
        }
        return { intent: "none" };
    },
});
function parseSingleFincaRequest(userMessage) {
    const msg = userMessage.trim();
    if (msg.length < 4)
        return null;
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
            if (term.length >= 2 && !/^(la|el|de|una?)$/i.test(term))
                return term;
        }
    }
    return null;
}
function parseLocationAndDates(userMessage) {
    const msg = userMessage.trim().toLowerCase();
    const invalidLocations = new Set([
        "los dias", "los días", "el dia", "el día", "dos personas", "las personas",
        "una finca", "la finca", "los dias", "este fin", "el fin",
        "mi", "tu", "su", "un", "una", "el", "la", "los", "las",
    ]);
    const locationMatchEn = msg.match(/(?:en|de)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|\s+una|\s+la|,|$)/i);
    const locationMatchPara = msg.match(/(?:para)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|$)/i);
    const locationMatch = locationMatchEn || locationMatchPara;
    const location = locationMatch ? locationMatch[1].trim().replace(/\s+/g, " ") : "";
    const dateMatch = msg.match(/(?:del\s+)?(\d{1,2})\s*(?:al|hasta el|hasta)\s*(\d{1,2})/i);
    if (!location || !dateMatch)
        return null;
    if (invalidLocations.has(location) || location.length < 3)
        return null;
    if (/\b(dias?|personas?|fincas?|reservar?|noches?)\b/i.test(location))
        return null;
    const d1 = parseInt(dateMatch[1], 10);
    const d2 = parseInt(dateMatch[2], 10);
    if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31)
        return null;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const fechaEntrada = new Date(year, month, d1).getTime();
    const fechaSalida = new Date(year, month, d2 + 1).getTime();
    const personasMatch = msg.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i);
    const minCapacity = personasMatch ? parseInt(personasMatch[1], 10) : undefined;
    const sortByPrice = /\b(buen\s+precio|económico|económicas|barato|barata)\b/i.test(msg);
    return { location, fechaEntrada, fechaSalida, minCapacity, sortByPrice };
}
function getNextWeekendDates() {
    const now = new Date();
    const day = now.getDay();
    let daysUntilSaturday = (6 - day + 7) % 7;
    if (daysUntilSaturday === 0 && now.getHours() >= 12)
        daysUntilSaturday = 7;
    const sat = new Date(now);
    sat.setDate(sat.getDate() + daysUntilSaturday);
    sat.setHours(0, 0, 0, 0);
    const mon = new Date(sat);
    mon.setDate(mon.getDate() + 2);
    return { fechaEntrada: sat.getTime(), fechaSalida: mon.getTime() };
}
function parseSearchFilters(userMessage) {
    const msg = userMessage.trim().replace(/\s+/g, " ");
    const lower = msg.toLowerCase();
    if (!/\b(fin\s+de\s+semana|este\s+fin|próximo\s+fin|el\s+fin\s+de\s+semana)\b/i.test(lower))
        return null;
    const weekend = getNextWeekendDates();
    const locationMatch = lower.match(/(?:buscando\s+)?en\s+(.+?)(?:\s+una|\s+finca|,|\s+para\s+\d|$)/s)
        || lower.match(/(?:para|en)\s+(.+?)(?:\s+una|\s+finca|,|\s+grupo|$)/s);
    const location = locationMatch
        ? locationMatch[1].replace(/[^\wáéíóúñ\s]/gi, "").trim().replace(/\s+/g, " ")
        : "";
    if (!location || location.length < 2)
        return null;
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
function detectOtrasOpciones(userMessage) {
    const lower = userMessage.trim().toLowerCase();
    return (/\b(otras\s+opciones|más\s+opciones|no\s+me\s+gustan|envía\s+más|otras\s+fincas|dame\s+otras|quiero\s+ver\s+otras)\b/i.test(lower) ||
        /^otras$|^más$|^más\s+opciones$/i.test(lower));
}
function normalizeCatalogLocation(location) {
    const t = location.trim().toLowerCase().replace(/\s+/g, " ");
    if (t === "mergal" || t === "mergal tolima")
        return "melgar";
    return location.trim().replace(/\s+/g, " ");
}
function asksFincasOrCatalogInMessage(userMessage) {
    const lower = userMessage.trim().toLowerCase();
    return /\b(qu[eé]\s+fincas|qu[eé]\s+opciones|fincas\s+tienes|tienen\s+fincas|hay\s+fincas|ver\s+(las\s+)?opciones|m[aá]s\s+opciones|el\s+cat[aá]logo|un\s+cat[aá]logo|mostrar(me)?\s+(las\s+)?opciones)\b/i.test(lower);
}
function messageLooksLikeDateCapacityFollowup(userMessage) {
    const lower = userMessage.trim().toLowerCase();
    const hasWeekend = /\b(fin\s+de\s+semana|este\s+fin|pr[oó]ximo\s+fin|el\s+fin\s+de\s+semana)\b/i.test(lower);
    const hasPersonas = /\b\d+\s*(?:o\s+mas?\s+)?personas\b/i.test(lower);
    return hasWeekend && hasPersonas;
}
function shouldBlockCatalogMultiFincaSearch(userMessage) {
    const lower = userMessage
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
    if (!lower)
        return false;
    return (/\b(m[eé]todos?\s+de\s+pago|medios?\s+de\s+pago|como\s+pago|c[oó]mo\s+pagar|formas?\s+de\s+pago|aceptan\s+(tarjeta|nequi|pse)|\bpse\b|\bnequi\b|bancari|transferencia|consignaci[oó]n|datos\s+bancar|cuenta(s)?\s+bancar|n[uú]mero\s+de\s+cuenta|abono|saldo\s+(pendiente|restante)|contrato(\s+de)?\s+arrend|firm(ar|e|o)\s+(el\s+)?contrato|pdf\s+del\s+contrato)\b/.test(lower) ||
        /\b(qu[eé]\s+metodos|cu[aá]les\s+son\s+los\s+pagos|donde\s+pago|a\s+donde\s+consigno|puedo\s+pagar)\b/.test(lower) ||
        /\b(mascotas?|perros?|personal|servicio|empleada|convivencia|requerimientos|sonido|decoracion)\b/i.test(lower));
}
function looksLikeContractDataSubmission(userMessage) {
    const t = userMessage.trim();
    if (!/@\S+\.\S+/.test(t))
        return false;
    const digits = (t.match(/\d/g) ?? []).length;
    return digits >= 10;
}
exports.maybeSendSingleFincaCatalogForUserMessage = (0, server_1.internalAction)({
    args: {
        phone: values_1.v.string(),
        conversationId: values_1.v.id("conversations"),
        userMessage: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
        extractedFincaName: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        if (shouldBlockCatalogMultiFincaSearch(args.userMessage) ||
            looksLikeContractDataSubmission(args.userMessage)) {
            return { sent: false };
        }
        const searchTerm = args.extractedFincaName?.trim() || parseSingleFincaRequest(args.userMessage);
        if (!searchTerm) {
            console.log("[single-finca] no se encontró término de búsqueda en mensaje ni extracción IA");
            return { sent: false };
        }
        console.log("[single-finca] buscando:", searchTerm);
        const fincaToSend = await ctx.runQuery(api_1.api.fincas.findBySearchTerm, {
            term: searchTerm,
        });
        if (!fincaToSend) {
            console.log("[single-finca] sin resultados para:", searchTerm, "abortando");
            return { sent: false };
        }
        const catalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getDefault, {});
        if (!catalog) {
            console.log("[single-finca] sin catálogo por defecto, abortando");
            return { sent: false };
        }
        console.log("[single-finca] finca seleccionada:", fincaToSend.title);
        const productEntries = await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties, { catalogId: catalog._id, propertyIds: [fincaToSend._id] });
        let productRetailerIdToUse;
        if (productEntries.length > 0) {
            productRetailerIdToUse = productEntries[0].productRetailerId;
        }
        else {
            console.log("[single-finca] sin product entries para", fincaToSend.title, "usando ID directo como fallback");
            productRetailerIdToUse = fincaToSend._id;
        }
        await ctx.runAction(api_1.internal.ycloud.sendWhatsAppCatalogList, {
            to: args.phone,
            productRetailerIds: [productRetailerIdToUse],
            bodyText: `Aquí está ${fincaToSend.title} 🏡`,
            catalogId: catalog.whatsappCatalogId,
            wamid: args.wamid,
        });
        const firstImage = await ctx.runQuery(api_1.api.fincas.getPropertyImage, {
            propertyId: fincaToSend._id
        });
        await ctx.runMutation(api_1.internal.messages.insertAssistantMessageWithMedia, {
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
exports.maybeSendCatalogForUserMessage = (0, server_1.internalAction)({
    args: {
        conversationId: values_1.v.id("conversations"),
        phone: values_1.v.string(),
        userMessage: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
        catalogIntent: values_1.v.optional(values_1.v.union(values_1.v.object({ intent: values_1.v.literal("more_options") }), values_1.v.object({
            intent: values_1.v.literal("search_catalog"),
            location: values_1.v.string(),
            hasWeekend: values_1.v.optional(values_1.v.boolean()),
            dateD1: values_1.v.optional(values_1.v.number()),
            dateD2: values_1.v.optional(values_1.v.number()),
            minCapacity: values_1.v.optional(values_1.v.number()),
            sortByPrice: values_1.v.optional(values_1.v.boolean()),
        }))),
    },
    returns: values_1.v.object({ sent: values_1.v.boolean(), location: values_1.v.optional(values_1.v.string()), fincasCount: values_1.v.optional(values_1.v.number()), fincasFoundButNoCatalog: values_1.v.optional(values_1.v.boolean()) }),
    handler: async (ctx, args) => {
        const conv = await ctx.runQuery(api_1.api.conversations.getById, {
            conversationId: args.conversationId,
        });
        if (!conv)
            return { sent: false };
        if (shouldBlockCatalogMultiFincaSearch(args.userMessage) ||
            looksLikeContractDataSubmission(args.userMessage)) {
            return { sent: false };
        }
        let location;
        let fechaEntrada;
        let fechaSalida;
        let minCapacity;
        let sortByPrice;
        let excludePropertyIds;
        const intent = args.catalogIntent;
        if (intent?.intent === "more_options" && conv.lastCatalogSearch) {
            const last = conv.lastCatalogSearch;
            location = last.location;
            fechaEntrada = last.fechaEntrada;
            fechaSalida = last.fechaSalida;
            minCapacity = last.minCapacity;
            sortByPrice = last.sortByPrice;
            excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
        }
        else if (intent?.intent === "search_catalog" && intent.location) {
            const weekend = getNextWeekendDates();
            if (intent.hasWeekend) {
                fechaEntrada = weekend.fechaEntrada;
                fechaSalida = weekend.fechaSalida;
            }
            else if (intent.dateD1 != null && intent.dateD2 != null) {
                const now = new Date();
                const y = now.getFullYear();
                const m = now.getMonth();
                fechaEntrada = new Date(y, m, intent.dateD1).getTime();
                fechaSalida = new Date(y, m, intent.dateD2 + 1).getTime();
            }
            else {
                fechaEntrada = weekend.fechaEntrada;
                fechaSalida = weekend.fechaSalida;
            }
            location = intent.location;
            minCapacity = intent.minCapacity;
            sortByPrice = intent.sortByPrice;
        }
        else if (detectOtrasOpciones(args.userMessage) && conv.lastCatalogSearch) {
            const last = conv.lastCatalogSearch;
            location = last.location;
            fechaEntrada = last.fechaEntrada;
            fechaSalida = last.fechaSalida;
            minCapacity = last.minCapacity;
            sortByPrice = last.sortByPrice;
            excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
        }
        else {
            let parsed = parseLocationAndDates(args.userMessage) ??
                parseSearchFilters(args.userMessage);
            if (!parsed) {
                const allowMergedUserHistory = asksFincasOrCatalogInMessage(args.userMessage) ||
                    messageLooksLikeDateCapacityFollowup(args.userMessage);
                if (allowMergedUserHistory) {
                    const recentMsgs = await ctx.runQuery(api_1.api.messages.listRecent, {
                        conversationId: args.conversationId,
                        limit: 5,
                    });
                    const lastAssistant = recentMsgs.find((m) => m.sender === "assistant");
                    const isInClosingFlow = lastAssistant && (/avancemos con la reserva|elaborar tu contrato|datos de la persona/i.test(lastAssistant.content));
                    if (!isInClosingFlow) {
                        const recent = await ctx.runQuery(api_1.api.messages.listRecent, {
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
            }
            if (!parsed)
                return { sent: false };
            location = parsed.location;
            fechaEntrada = parsed.fechaEntrada;
            fechaSalida = parsed.fechaSalida;
            minCapacity = parsed.minCapacity;
            sortByPrice = parsed.sortByPrice;
        }
        location = normalizeCatalogLocation(location);
        const fincas = await ctx.runQuery(api_1.api.fincas.searchAvailableByLocationAndDates, {
            location,
            fechaEntrada,
            fechaSalida,
            limit: CATALOG_LIMIT,
            minCapacity,
            excludePropertyIds,
            sortByPrice,
        });
        console.log("[catalog-search] location:", location, "fincas encontradas (antes de catálogo):", fincas.length);
        if (fincas.length === 0)
            return { sent: false, location };
        let chosenCatalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getByLocationKeyword, {
            location,
        });
        if (!chosenCatalog) {
            chosenCatalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getDefault, {});
        }
        if (!chosenCatalog)
            return { sent: false };
        let productEntries = await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties, {
            catalogId: chosenCatalog._id,
            propertyIds: fincas.map((f) => f._id),
        });
        if (productEntries.length === 0) {
            const defaultCatalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getDefault, {});
            if (defaultCatalog && defaultCatalog._id !== chosenCatalog._id) {
                chosenCatalog = defaultCatalog;
                productEntries = await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties, { catalogId: chosenCatalog._id, propertyIds: fincas.map((f) => f._id) });
            }
        }
        const catalogEntryMap = new Map(productEntries.map((e) => [e.propertyId, e.productRetailerId]));
        const productRetailerIds = fincas.map((f) => catalogEntryMap.get(f._id) ?? f._id);
        if (catalogEntryMap.size === 0) {
            console.log("[catalog-search] sin entries en propertyWhatsAppCatalog, usando IDs de Convex como fallback:", productRetailerIds.length);
        }
        else if (catalogEntryMap.size < fincas.length) {
            console.log("[catalog-search] fallback parcial: ", catalogEntryMap.size, "con entrada,", fincas.length - catalogEntryMap.size, "con ID Convex");
        }
        const bodyText = excludePropertyIds?.length
            ? "Aquí tienes más opciones con los mismos filtros:"
            : "Estas son las fincas disponibles para tus fechas:";
        await ctx.runAction(api_1.internal.ycloud.sendWhatsAppCatalogList, {
            to: args.phone,
            productRetailerIds,
            bodyText,
            catalogId: chosenCatalog.whatsappCatalogId,
            wamid: args.wamid,
        });
        await ctx.runMutation(api_1.internal.conversations.setLastCatalogSent, {
            conversationId: args.conversationId,
            propertyIds: fincas.map((f) => f._id),
            location,
            fechaEntrada,
            fechaSalida,
            minCapacity,
            sortByPrice,
        });
        await ctx.runMutation(api_1.internal.messages.insertAssistantMessageWithMedia, {
            conversationId: args.conversationId,
            content: bodyText,
            type: "product",
            metadata: {
                catalog: fincas.slice(0, 3).map((f) => ({
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
exports.sendWhatsAppCatalogList = (0, server_1.internalAction)({
    args: {
        to: values_1.v.string(),
        productRetailerIds: values_1.v.array(values_1.v.string()),
        bodyText: values_1.v.optional(values_1.v.string()),
        catalogId: values_1.v.optional(values_1.v.string()),
        wamid: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        if (args.productRetailerIds.length === 0)
            return null;
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
        const body = args.productRetailerIds.length === 1
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
        if (args.wamid)
            (body).context = { message_id: args.wamid };
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
exports.extractContractData = (0, server_1.action)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        const messages = await ctx.runQuery(api_1.api.messages.listRecent, {
            conversationId: args.conversationId,
            limit: 30,
        });
        const normalizeData = async (parsed, historyMessages) => {
            const currentYear = new Date().getFullYear();
            const fixYear = (d) => {
                if (!d)
                    return d;
                const match = d.match(/^(\d{4})-(.*)/);
                if (match && Number(match[1]) < currentYear) {
                    return `${currentYear}-${match[2]}`;
                }
                return d;
            };
            let resolvedPropertyId = String(parsed.propertyId || "");
            if (!resolvedPropertyId || !resolvedPropertyId.includes(":")) {
                const fincaName = String(parsed.finca || parsed.fincaName || "");
                const searchTerms = [resolvedPropertyId, fincaName].filter((t) => t && t.length > 2);
                for (const term of searchTerms) {
                    const found = await ctx.runQuery(api_1.api.fincas.findBySearchTerm, {
                        term,
                    });
                    if (found) {
                        resolvedPropertyId = found._id;
                        break;
                    }
                }
            }
            const conv = await ctx.runQuery(api_1.api.conversations.getById, {
                conversationId: args.conversationId,
            });
            const contact = conv
                ? await ctx.runQuery(api_1.api.contacts.getById, {
                    contactId: conv.contactId,
                })
                : null;
            let numeroPersonas = Number(parsed.numeroPersonas || parsed.personas || 0);
            if (numeroPersonas === 0 && historyMessages.length > 0) {
                for (const msg of [...historyMessages].reverse()) {
                    const text = msg.content.toLowerCase();
                    const match = text.match(/(?:huéspedes|personas|pax|cupo)(?:\s*[:\-]\s*|\s+)(\d{1,2})/i)
                        || text.match(/(\d{1,2})\s+(?:personas|adultos|huéspedes)/i);
                    if (match) {
                        numeroPersonas = parseInt(match[1], 10);
                        break;
                    }
                }
            }
            return {
                clientName: String(parsed.nombre || parsed.clientName || contact?.name || ""),
                clientId: String(parsed.cedula || parsed.clientId || contact?.cedula || ""),
                clientPhone: String(parsed.celular || parsed.clientPhone || contact?.phone || ""),
                clientEmail: String(parsed.correo || parsed.clientEmail || contact?.email || ""),
                clientCity: String(parsed.ciudad || parsed.clientCity || contact?.city || ""),
                clientAddress: String(parsed.direccion || parsed.clientAddress || ""),
                checkInDate: fixYear(String(parsed.entrada || parsed.checkInDate || "")),
                checkOutDate: fixYear(String(parsed.salida || parsed.checkOutDate || "")),
                checkInTime: formatTimeTo24h(String(parsed.entradaHora || parsed.checkInTime || "")),
                checkOutTime: formatTimeTo24h(String(parsed.salidaHora || parsed.checkOutTime || "")),
                nightlyPrice: String(parsed.nightlyPrice ||
                    (parsed.precioTotal && parsed.noches
                        ? String(Math.round(Number(parsed.precioTotal) / Number(parsed.noches)))
                        : "")),
                totalPrice: String(parsed.totalPrice || parsed.precioTotal || ""),
                numeroPersonas,
                propertyId: resolvedPropertyId,
            };
        };
        for (const msg of [...messages].reverse()) {
            if (msg.sender === "assistant" &&
                msg.content.includes("[CONTRACT_PDF:")) {
                const tag = "[CONTRACT_PDF:";
                const idx = msg.content.indexOf(tag);
                const jsonStart = msg.content.indexOf("{", idx);
                let jsonEnd = -1;
                if (jsonStart >= 0) {
                    let depth = 0;
                    for (let i = jsonStart; i < msg.content.length; i++) {
                        if (msg.content[i] === "{")
                            depth++;
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
                    }
                    catch (e) {
                        console.error("Error parsing CONTRACT_PDF block:", e);
                    }
                }
            }
        }
        const history = messages
            .map((m) => `${m.sender.toUpperCase()}: ${m.content}`)
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
        const { text } = await (0, ai_1.generateText)({
            model: openai_1.openai.chat("gpt-5-mini"),
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
        }
        catch (e) {
            console.error("Error parsing AI extraction:", e);
            return { error: "No se pudieron extraer los datos automáticamente" };
        }
    },
});
function formatTimeTo24h(timeStr) {
    if (!timeStr)
        return "";
    const t = timeStr.trim().toUpperCase();
    const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) {
        if (/^\d{2}:\d{2}$/.test(t))
            return t;
        return timeStr;
    }
    let [_, hours, minutes, ampm] = match;
    let h = parseInt(hours, 10);
    if (ampm === "PM" && h < 12)
        h += 12;
    if (ampm === AmPM.AM && h === 12)
        h = 0;
    return `${h.toString().padStart(2, "0")}:${minutes}`;
}
var AmPM;
(function (AmPM) {
    AmPM["AM"] = "AM";
    AmPM["PM"] = "PM";
})(AmPM || (AmPM = {}));
exports.backfillTemplateMessages = (0, server_1.internalAction)({
    args: {},
    handler: async (ctx) => {
        const routable = await fetchRoutableTemplates();
        if (routable.length === 0)
            return { updated: 0 };
        const messages = await ctx.runQuery(api_1.internal.ycloud.listAllAssistantMessages);
        let updatedCount = 0;
        for (const msg of messages) {
            if (msg.content.startsWith("[Plantilla WhatsApp:")) {
                const match = msg.content.match(/\[Plantilla WhatsApp:\s*(.+?)\]/);
                if (match) {
                    const templateName = match[1].trim();
                    const template = routable.find((t) => t.name === templateName);
                    if (template && template.body) {
                        await ctx.runMutation(api_1.internal.messages.updateMessageContent, {
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
exports.listAllAssistantMessages = (0, server_1.internalQuery)({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query("messages")
            .filter((q) => q.eq(q.field("sender"), "assistant"))
            .collect();
    },
});
//# sourceMappingURL=ycloud.js.map