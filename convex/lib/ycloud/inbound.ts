import type { Id } from "../../_generated/dataModel";
import type { BotEntities } from "../bot/types";
import {
  capacityCeilForCupo,
  capacityCeilRelaxedForCupo,
  inferRetailerIdFromCatalogTitle,
} from "../bot/entities";
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

/**
 * Heurística para decidir si el mensaje del cliente parece una pregunta tipo FAQ
 * que vale la pena resolver con el RAG (mascotas, horarios, pagos, ubicación, etc.).
 *
 * DELIBERADAMENTE conservadora: si hay duda, devuelve false. Disparar el RAG
 * cuando el cliente está dando datos del flujo (ej. "quiero reservar 22 amigos
 * en Melgar") rompe la experiencia con un volcado de FAQs.
 *
 * Reglas:
 *   - Trae `?` o `¿` → true.
 *   - Empieza con palabra interrogativa explícita (qué/cómo/cuál/dónde/cuándo/
 *     cuánto/puedo/se puede/me regalas/me dices/sabes/tienen/aceptan/permiten/
 *     hay/incluye) → true.
 *   - Mensaje corto (<=120 chars) con término FAQ inequívoco (horario, check-in,
 *     mascota, piscina, cancelación, formas de pago, política, reglas) → true.
 *   - "reserva/reservar/abono/depósito" SOLO se consideran si ya cumplió alguna
 *     de las reglas anteriores. Por sí solas NO disparan (son transaccionales).
 *   - Default: false.
 */
function looksLikeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 4 || t.length > 250) return false;
  if (t.includes("?") || t.includes("¿")) return true;

  const lower = t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  // ¿Empieza con palabra interrogativa o frase de petición de info?
  const startsAsQuestion =
    /^(que\b|cual\b|cuales\b|cuando\b|donde\b|como\b|cuanto\b|cuanta\b|cuantos\b|cuantas\b|puedo\b|se puede\b|me regala|me regalas|me dices|me dice|me confirma|me explica|me explican|me cuent|sabes\b|saben\b|tienen\b|tiene\b|aceptan\b|acepta\b|permiten\b|permite\b|hay\b|incluye\b|incluyen\b|conoce|conoces|necesito saber|quisiera saber|una consulta|una pregunta)\b/.test(
      lower,
    );
  if (startsAsQuestion) return true;

  // Mensaje corto con términos FAQ inequívocos.
  const shortAndFaqy =
    t.length <= 120 &&
    /\b(horario|horarios|check ?in|check ?out|hora\s+de\s+(entrada|salida|llegada|llegar)|mascota|mascotas|perr[oa]s?|gatos?|piscina|jacuzzi|bbq|raza|cancelaci[oó]n|cancelar|forma[s]?\s+de\s+pago|metodo[s]?\s+de\s+pago|c[oó]mo\s+pago|c[oó]mo\s+se\s+paga|pol[ií]tica|reglas?)\b/.test(
      lower,
    );
  if (shortAndFaqy) return true;

  return false;
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

  const lowerText = String(textForTurn ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  // PQRS / queja / reclamo / problema operativo: NO es flujo de venta — escalar
  // con mensaje empático específico (no el genérico de reserva).
  const looksLikeComplaint =
    /\b(pqrs|queja|quejas|quejarme|reclamo|reclamos|reclamar|reclamacion|denuncia|denunciar|peticion|inconformidad|inconforme)\b/.test(
      lowerText,
    ) ||
    /\b(no estoy buscando (finca|reserva)|no (es|estoy) (para|por) (reserva|reservar|buscar)|no (quiero|deseo) reservar|no es para reservar)\b/.test(
      lowerText,
    ) ||
    /\b(se da[nñ]o|se rompio|esta da[nñ]ad[oa]|no funciona|no sirve|esta malo|esta dañado)\b/.test(
      lowerText,
    );

  // Petición explícita de asesor humano (flujo normal, no necesariamente queja).
  const wantsHumanGeneric =
    /\b(hablar con|llamar|asesor|humano|persona real|agente|persona|alguien (me )?ayud[ae]|me (puede|pueden) ayudar real|atencion humana|servicio al cliente|no me sirve (este|el) bot|no entiend[eo]s? nada|ya me cans[eé])\b/.test(
      lowerText,
    );

  const wantsHuman = looksLikeComplaint || wantsHumanGeneric;
  if (wantsHuman) {
    const t0 = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId: process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg = looksLikeComplaint
      ? "Lamento la situación 🙏 Te conecto con un asesor para gestionar tu solicitud. Un agente te escribirá en breve 🤝"
      : "Perfecto, te comunico con un asesor. Un agente te escribirá en breve ✨";
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        looksLikeComplaint
          ? "🚨 El cliente pidió atención humana (posible PQRS o tema operativo). Revisar y contactar. La IA quedó en pausa."
          : "📣 El cliente pidió hablar con un asesor. Revisar conversación y contactar. La IA quedó en pausa.",
      createdAt: t0 + 5,
      metadata: {
        kind: "inbox_escalation_alert",
        escalationReason: looksLikeComplaint ? "client_complaint" : "client_requested",
      },
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
  const currentSamePhaseTurnCount = session?.samePhaseTurnCount ?? 0;
  const currentPhaseEnteredAt = session?.phaseEnteredAt ?? Date.now();
  let currentEntities = session?.entities ?? {};

  // ── Media en fases post-catálogo → escalar a humano ──────────────────────
  // En `contract` / `quote_shown` / `pet_rules_shown` / `pet_check` / `done`,
  // si el cliente manda imagen / video / documento, casi siempre es:
  //   - Foto de la cédula (parte del contrato).
  //   - Comprobante de transferencia / pago.
  //   - Documento o foto extra para el asesor.
  // El bot NO sabe leer imágenes y no debería intentar adivinar. Escalamos
  // automáticamente para que un humano verifique.
  const isMediaMessage =
    args.type === "image" || args.type === "video" || args.type === "document";
  const phaseRequiresHumanForMedia: Array<typeof currentPhase> = [
    "pet_check",
    "pet_rules_shown",
    "quote_shown",
    "contract",
    "done",
  ];
  if (isMediaMessage && phaseRequiresHumanForMedia.includes(currentPhase)) {
    const tMedia = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const mediaHandoffMsg =
      "Gracias por enviarnos el documento 📎 Te conecto con un asesor para revisarlo y confirmarte los siguientes pasos. Un agente te escribirá en breve 🤝 ✨";
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: mediaHandoffMsg,
      createdAt: tMedia,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        "📎 Cliente envió archivo/foto en fase post-catálogo. Revisar (puede ser cédula, comprobante de pago o documento adicional). La IA quedó en pausa.",
      createdAt: tMedia + 5,
      metadata: {
        kind: "inbox_escalation_alert",
        escalationReason: "media_post_catalog",
        phaseAtEscalation: currentPhase,
        mediaType: args.type,
        mediaUrl: args.mediaUrl ?? null,
      },
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: mediaHandoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return;
  }
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

  // Pre-fetch RAG (FAQs) si el mensaje parece una pregunta. Si no es pregunta,
  // ahorramos la llamada de embeddings + vector search.
  //
  // `searchFaqForBot` ya devuelve SOLO el texto del top-1 entry (no concatena
  // varias FAQs distintas), con su score. Si score < minScore o no hay match,
  // devuelve `text: ""` y caemos al flujo normal sin RAG.
  let faqContext: string | null = null;
  if (looksLikeQuestion(textForTurn)) {
    try {
      const ragResult = (await ctx.runAction(deps.api.knowledge.searchFaqForBot, {
        query: textForTurn,
      })) as { text?: string; title?: string; score?: number } | null;
      const t = String(ragResult?.text ?? "").trim();
      if (t.length > 0) faqContext = t;
    } catch (err) {
      console.error("inbound: searchFaqForBot fallo (degradado, sigue sin RAG):", err);
    }
  }

  const result = await deps.runBotTurn({
    messageText: textForTurn,
    currentPhase,
    currentEntities,
    conversationHistory: history,
    currentSamePhaseTurnCount,
    currentPhaseEnteredAt,
    faqContext,
    contactName: args.name,
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
      })) as {
        text?: string;
        totals?: {
          propertyTitle?: string;
          nightly?: number;
          nightsCount?: number;
          subtotal?: number;
          appliedRule?: string;
          cupo?: number;
        };
      } | null;
      const text = String(data?.text ?? "").trim();
      if (!text) return null;
      return {
        text,
        totals: data?.totals
          ? {
              propertyTitle: String(data.totals.propertyTitle ?? "").trim(),
              nightly: Number(data.totals.nightly ?? 0),
              nightsCount: Number(data.totals.nightsCount ?? 0),
              subtotal: Number(data.totals.subtotal ?? 0),
              appliedRule: String(data.totals.appliedRule ?? "").trim(),
              cupo: Number(data.totals.cupo ?? 0),
            }
          : undefined,
      };
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
    samePhaseTurnCount: result.samePhaseTurnCount,
    phaseEnteredAt: result.phaseEnteredAt,
  });

  const action = result.action;

  // ⚠️ Cuando `action === send_catalog`, DIFERIMOS el envío del replyText
  // (pre-catálogo "Te comparto las opciones disponibles") hasta saber si
  // hay fichas reales. Si el query devuelve vacío, NO enviamos el pre-catálogo
  // y vamos directo al mensaje de escalada — así evitamos la incoherencia
  // "te comparto opciones... no tengo opciones".
  const deferReplyForCatalog = action.type === "send_catalog";

  if (result.replyText && !deferReplyForCatalog) {
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

  // Mensajes adicionales (paquetes multi-burbuja, p. ej. tras `pet_check`).
  // Se envían en orden con un pequeño delay para que WhatsApp los muestre como
  // burbujas separadas y no en una sola notificación. NO se incluye `wamid`
  // (`context.message_id`) para que no queden todos citando el mismo mensaje
  // del cliente — solo el primero lo hace.
  //
  // Estos también se difieren si la acción es send_catalog (mismo motivo).
  const extras: string[] = Array.isArray(result.additionalMessages)
    ? (result.additionalMessages as string[])
    : [];
  if (!deferReplyForCatalog) {
    for (const extra of extras) {
      const text = String(extra ?? "").trim();
      if (!text) continue;
      await new Promise((r) => setTimeout(r, 600));
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: text,
        createdAt: Date.now(),
      });
      await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text,
      });
    }
  }
  if (action.type === "send_catalog") {
    if (
      !(await isStillThisTailUserMessage(ctx, deps, conversationId, String(insertedMsgId), now))
    ) {
      return;
    }
    // Si el cliente confirmó evento Y declaró capacidad de evento mayor que el
    // cupo de hospedaje, el filtro de catálogo debe respetar la mayor. El helper
    // server-side `catalogPeopleCountForFilter` ya considera `eventCapacity` de
    // la finca cuando `isEvento=true`; aquí solo le pasamos el `minCapacity`
    // correcto (lo que el cliente realmente necesita acomodar).
    const eventPeople = Number(
      result.updatedEntities.eventPeopleCount ?? 0,
    );
    const effectiveMinCapacity =
      action.isEvento && eventPeople > action.cupo ? eventPeople : action.cupo;

    const catalogPayload = (await ctx.runQuery(
      deps.api.whatsappCatalogs.getPayloadByLocationForN8n,
      {
        location: action.location,
        fechaEntrada: action.checkIn,
        fechaSalida: action.checkOut,
        minCapacity: effectiveMinCapacity,
        // Techo estricto: la primera pasada solo trae fincas en el rango ajustado.
        // Ver `capacityCeilForCupo` (~cupo + buffer adaptativo).
        maxCapacity: capacityCeilForCupo(effectiveMinCapacity),
        // Techo relajado: si la pasada estricta no llena el catálogo, la
        // intermedia amplía hasta `maxCapacityRelaxed` (~1.7x el cupo).
        // EVITA que aparezcan fincas absurdamente grandes (ej. una de 53
        // personas para alguien que pidió 22). Ver `capacityCeilRelaxedForCupo`.
        maxCapacityRelaxed: capacityCeilRelaxedForCupo(effectiveMinCapacity),
        isEvento: action.isEvento,
      },
    )) as {
      catalogId?: string;
      productRetailerIds?: string[];
      productQuoteLines?: string[];
      productTitles?: string[];
    } | null;

    if (catalogPayload?.productRetailerIds?.length) {
      // Hay fichas → ahora SÍ enviamos el pre-catálogo diferido + extras + fichas.
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
      for (const extra of extras) {
        const text = String(extra ?? "").trim();
        if (!text) continue;
        await new Promise((r) => setTimeout(r, 600));
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: text,
          createdAt: Date.now(),
        });
        await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text,
        });
      }

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

      // ── EVENTO: política comercial ─────────────────────────────────────
      // Antes el bot escalaba a humano APENAS enviaba el catálogo cuando era
      // evento. Eso producía dos malas UX: (a) el cliente recibía fichas y de
      // inmediato un "te conecto con asesor" sin que hubiera podido elegir
      // siquiera, y (b) si el cliente no llegaba a dar `eventPeopleCount` /
      // `eventLogistics` por las preguntas que se hacían ANTES del catálogo,
      // el flujo escalaba sin que el cliente viera ni una finca.
      //
      // Nueva política (refinada):
      //   1. Mostrar primero el catálogo (siempre).
      //   2. Preguntar detalles del evento (total de personas + logística)
      //      DESPUÉS de mandar las fichas, SIN escalar todavía.
      //   3. Cuando se conoce la logística:
      //      - `extra` (DJ / banda / sonido pro / iluminación / matrimonios):
      //        escalar al asesor — el bot no calcula sobreprecio.
      //      - `basic` (cumpleaños familiar, sonido de la finca, departir
      //        tranquilos): SEGUIR EL FLUJO NORMAL — el bot continúa con
      //        pet_check → quote_shown → contract. La cotización estándar
      //        aplica sin sobreprecio.
      if (action.isEvento === true) {
        const tEvent = Date.now() + 50;
        const peopleCount = Number(
          result.updatedEntities.eventPeopleCount ?? 0,
        );
        const peopleCountMissing = !peopleCount || peopleCount <= 0;
        const logistics = result.updatedEntities.eventLogistics ?? null;
        const logisticsMissing = !logistics;
        const needsEventDetails = peopleCountMissing || logisticsMissing;

        if (needsEventDetails) {
          // Aún faltan datos del evento → preguntar SIN escalar. El bot sigue
          // activo esperando que el cliente elija finca + entregue detalles.
          const askLines: string[] = [
            "Como es para *evento* 🎉, mientras revisas las opciones te hago un par de preguntas 👇",
            "",
          ];
          if (peopleCountMissing) {
            askLines.push(
              "👥 *Total de personas en el evento* (las que duermen + las que van solo por el día / pasadía).",
            );
          }
          if (logisticsMissing) {
            askLines.push(
              "🎵 *Logística del evento*:",
              "🎧 Sonido profesional / DJ / iluminación",
              "🎸 Banda en vivo o grupos musicales",
              "🏡 O solo el sonido básico de la finca (departir tranquilos)",
            );
          }
          askLines.push(
            "",
            "Cuéntame cuál finca te gusta y estos datos para confirmarte la disponibilidad 🤝",
          );
          const eventQuestionsMsg = askLines.join("\n");
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: eventQuestionsMsg,
            createdAt: tEvent,
          });
          await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: eventQuestionsMsg,
          });
        } else if (logistics === "extra") {
          // Logística pesada (DJ / banda / sonido pro / iluminación) →
          // escalar al asesor: el bot NO calcula sobreprecio del evento.
          const eventHandoffMsg = [
            "Como es para *evento* 🎉, el precio final puede variar según la logística (sonido pro, banda, equipos).",
            "",
            "👉 Mientras revisas las opciones, te conecto con un asesor para confirmarte *precios y disponibilidad* del evento. Un agente te escribirá en breve 🤝 ✨",
          ].join("\n");
          await ctx.runMutation(deps.internal.conversations.escalate, {
            conversationId,
            assignedUserId:
              process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
          });
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: eventHandoffMsg,
            createdAt: tEvent,
          });
          await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
            conversationId,
            content:
              "🎉 Evento con logística *extra* (DJ/banda/sonido pro). El cliente recibió el catálogo + entregó detalles. Confirmar precio/condiciones del evento. La IA quedó en pausa.",
            createdAt: tEvent + 5,
            metadata: {
              kind: "inbox_escalation_alert",
              escalationReason: "event_after_catalog",
              requestedLocation: action.location,
              requestedCupo: action.cupo,
              eventPeopleCount: peopleCount,
              eventLogistics: logistics,
            },
          });
          await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: eventHandoffMsg,
          });
        } else {
          // Logística básica (cumpleaños familiar, departir tranquilos) → NO
          // escalar. El bot sigue el flujo normal: en el próximo turno cuando
          // el cliente elija una finca, transition catalog_sent → pet_check
          // y de ahí avanza a quote_shown + contract con la cotización
          // estándar (sin sobreprecio de evento, porque no aplica).
          const basicEventAckMsg = [
            "¡Perfecto! 🎉 Para tu evento *básico* (sin sonido pro ni banda) te aplica la tarifa normal de la finca.",
            "",
            "Cuéntame *cuál finca te llama la atención* y seguimos con la reserva 🤝",
          ].join("\n");
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: basicEventAckMsg,
            createdAt: tEvent,
          });
          await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: basicEventAckMsg,
          });
        }
      }
    } else {
      // Catálogo vacío: ninguna finca cumple los filtros (cupo + evento +
      // location + capacidad). El bot ya envió el pre-catálogo prometiendo
      // opciones, pero las fichas reales no van a aparecer. Escalamos a humano
      // con un mensaje específico para que el cliente NO quede esperando.
      const noResultsMsg = [
        "Por ahora no tengo opciones exactas para esos requisitos en el catálogo 🤔",
        "",
        "*Te conecto con un asesor* para evaluar disponibilidad especial y opciones personalizadas según tus fechas y tipo de plan 🤝",
        "",
        "Un agente te escribirá en breve para ayudarte ✨",
      ].join("\n");
      await ctx.runMutation(deps.internal.conversations.escalate, {
        conversationId,
        assignedUserId:
          process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
      });
      const tNoRes = Date.now();
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: noResultsMsg,
        createdAt: tNoRes,
      });
      await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
        conversationId,
        content:
          "🚨 Catálogo vacío: el cliente pidió fincas pero los filtros (cupo + evento + zona) no devolvieron opciones. Revisar requisitos y contactar.",
        createdAt: tNoRes + 5,
        metadata: {
          kind: "inbox_escalation_alert",
          escalationReason: "catalog_no_results",
          requestedLocation: action.location,
          requestedCupo: action.cupo,
          requestedIsEvento: action.isEvento,
        },
      });
      await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: noResultsMsg,
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }
  } else if (action.type === "escalate_human") {
    const reason = action.reason;
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId: process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
      ...(reason === "contract_complete" ? { priority: "urgent" as const } : {}),
    });
    const alertCreatedAt = Date.now() + (result.replyText ? 20 : 0);
    const alertBody =
      reason === "contract_complete"
        ? "🚨 El cliente completó los datos del contrato por WhatsApp. Prioridad: revisar, avisar al equipo si aplica y contactar al cliente. La IA quedó en pausa."
        : reason === "stuck_loop"
          ? "⚠️ Escalación automática: el cliente llevaba varios turnos sin avanzar; se ofreció asesor humano. Revisar y contactar. La IA quedó en pausa."
          : reason === "pets_exceed_limit"
            ? "🐾 El cliente declaró más de 3 mascotas. Evaluar condiciones especiales (aseo extra, fincas con espacio, depósito ajustado). La IA quedó en pausa."
            : reason === "catalog_no_results"
              ? "🚨 Catálogo vacío para los filtros del cliente. Revisar requisitos (cupo / evento / zona) y proponer opciones manualmente. La IA quedó en pausa."
              : reason === "event_after_catalog"
                ? "🎉 Evento confirmado: cliente recibió el catálogo. Confirmar precio y condiciones del evento (logística + capacidad). La IA quedó en pausa."
                : reason === "media_post_catalog"
                  ? "📎 Cliente envió archivo/foto en fase post-catálogo. Revisar (cédula, comprobante, doc). La IA quedó en pausa."
                  : "ℹ️ Conversación pasada a asesor humano. La IA quedó en pausa.";
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content: alertBody,
      createdAt: alertCreatedAt,
      metadata: {
        kind: "inbox_escalation_alert",
        escalationReason: reason ?? "generic",
      },
    });
  }

  await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, { conversationId });
}
