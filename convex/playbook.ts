/**
 * MÓDULO DE ENTRENAMIENTO DEL PLAYBOOK DE TONO.
 * ---------------------------------------------------------------------------
 * La tabla `playbookExemplars` es la FUENTE EDITABLE (desde el panel admin).
 * El RAG (namespace "playbook") es el ÍNDICE DERIVADO: solo se sincronizan los
 * ejemplos `enabled`. El bot busca contra el RAG (`knowledge.searchPlaybookForBot`).
 *
 *   tabla (editable)  ──sync──▶  RAG (índice)  ──búsqueda──▶  bot
 *
 * Todas las funciones admin son `internal*` y se exponen por `convex/http.ts`
 * con `X-API-Key` (mismo patrón que la Base de Conocimiento). `seedFromCode` es
 * pública para poder correrla por CLI (`bunx convex run playbook:seedFromCode`).
 */

import { v } from "convex/values";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import rag from "./rag";
import { PLAYBOOK_NAMESPACE, PLAYBOOK_SEED } from "./lib/playbookSeed";

/** Modelo para el "draft" de un ejemplo desde un chat crudo. Mini es de sobra. */
const DRAFT_MODEL = "gpt-4.1-mini";

/** Fases válidas del FSM (+ "any"). Se usa para validar entrada. */
const VALID_PHASES = [
  "welcome",
  "collecting",
  "catalog_sent",
  "pet_check",
  "pet_rules_shown",
  "quote_shown",
  "contract",
  "done",
  "any",
] as const;

function isValidPhase(p: string): boolean {
  return (VALID_PHASES as readonly string[]).includes(p);
}

/** Núcleo de un ejemplo (lo que necesita el sync al RAG). */
type ExemplarCore = {
  key: string;
  phase: string;
  situation: string;
  clientExamples: string[];
  response: string;
  tags: string[];
  enabled: boolean;
};

/** Texto que se EMBEBE (situación + frases del cliente). La respuesta modelo NO
 *  se embebe: viaja en metadata para no sesgar el match con el mensaje entrante. */
function embedTextFor(situation: string, clientExamples: string[]): string {
  return [situation, ...clientExamples]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Quita surrogates UTF-16 sueltos (medio emoji). Sin ellos, Convex no puede
 *  serializar el string a JSON ("unexpected end of hex escape"). Implementación
 *  manual: no depende de `\p{Surrogate}` (soporte variable en runtimes). */
function stripLoneSurrogates(str: string): string {
  if (!str) return "";
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += str[i] + str[i + 1];
        i++;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      out += str[i];
    }
  }
  return out;
}

/** Trunca por CODE POINTS (no parte pares de surrogates) y limpia sueltos. */
function safeSlice(str: string, max: number): string {
  const cps = Array.from(stripLoneSurrogates(str));
  return cps.length <= max ? cps.join("") : cps.slice(0, max).join("");
}

function sanitizeText(str: string, maxLen?: number): string {
  const cleaned = stripLoneSurrogates(str ?? "");
  return maxLen == null ? cleaned : safeSlice(cleaned, maxLen);
}

/** Genera una clave estable a partir de la situación (+ sufijo corto único). */
function makeKey(situation: string): string {
  // Slug simple: colapsa todo lo no-alfanumérico a "-" (las tildes caen a "-",
  // suficiente para una key estable; no necesitamos legibilidad perfecta).
  const slug = situation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix =
    Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
  return `pb-${slug || "ej"}-${suffix}`;
}

/**
 * Sincroniza UN ejemplo con el RAG: si `enabled`, lo indexa (add reemplaza por
 * key); si no, lo saca del índice pero se conserva en la tabla.
 */
async function syncExemplarToRag(
  ctx: ActionCtx,
  ex: ExemplarCore,
): Promise<void> {
  if (ex.enabled) {
    await rag.add(ctx, {
      namespace: PLAYBOOK_NAMESPACE,
      key: ex.key,
      text: embedTextFor(ex.situation, ex.clientExamples),
      title: safeSlice(ex.situation, 80),
      metadata: {
        phase: ex.phase,
        situation: ex.situation,
        response: ex.response,
        tags: ex.tags,
      },
    });
    return;
  }
  const ns = await rag.getNamespace(ctx, { namespace: PLAYBOOK_NAMESPACE });
  if (ns) {
    try {
      await rag.deleteByKey(ctx, { namespaceId: ns.namespaceId, key: ex.key });
    } catch (err) {
      console.error("playbook: deleteByKey falló (ignorado):", err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations de tabla (writes puros; el sync al RAG lo hacen las actions).
// ─────────────────────────────────────────────────────────────────────────────

/** Upsert por `key` en la tabla. Devuelve si se creó (vs. actualizó). */
export const _upsertRow = internalMutation({
  args: {
    key: v.string(),
    phase: v.string(),
    situation: v.string(),
    clientExamples: v.array(v.string()),
    response: v.string(),
    tags: v.array(v.string()),
    enabled: v.boolean(),
    source: v.string(),
  },
  handler: async (ctx, args): Promise<{ key: string; created: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("playbookExemplars")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        phase: args.phase,
        situation: args.situation,
        clientExamples: args.clientExamples,
        response: args.response,
        tags: args.tags,
        enabled: args.enabled,
        source: args.source,
        updatedAt: now,
      });
      return { key: args.key, created: false };
    }
    await ctx.db.insert("playbookExemplars", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
    return { key: args.key, created: true };
  },
});

/** Borra una fila por `key`. */
export const _deleteRow = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const existing = await ctx.db
      .query("playbookExemplars")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true };
  },
});

/** Cambia `enabled` y devuelve el ejemplo (para re-sincronizarlo). */
export const _setEnabledRow = internalMutation({
  args: { key: v.string(), enabled: v.boolean() },
  handler: async (ctx, args): Promise<ExemplarCore | null> => {
    const existing = await ctx.db
      .query("playbookExemplars")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return {
      key: existing.key,
      phase: existing.phase,
      situation: existing.situation,
      clientExamples: existing.clientExamples,
      response: existing.response,
      tags: existing.tags,
      enabled: args.enabled,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints admin (via `convex/http.ts`, protegidos con X-API-Key).
// ─────────────────────────────────────────────────────────────────────────────

export type PlaybookExemplarPublic = {
  key: string;
  phase: string;
  situation: string;
  clientExamples: string[];
  response: string;
  tags: string[];
  enabled: boolean;
  source: string;
  updatedAt: number;
};

/** Lista todos los ejemplos (habilitados primero, luego por edición reciente). */
export const listForAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<PlaybookExemplarPublic[]> => {
    const rows = await ctx.db.query("playbookExemplars").collect();
    rows.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    return rows.map((r) => ({
      key: r.key,
      phase: r.phase,
      situation: r.situation,
      clientExamples: r.clientExamples,
      response: r.response,
      tags: r.tags,
      enabled: r.enabled,
      source: r.source,
      updatedAt: r.updatedAt,
    }));
  },
});

/** Crea o edita un ejemplo (por `key`) y lo sincroniza con el RAG. */
export const upsertForAdmin = internalAction({
  args: {
    key: v.optional(v.string()),
    phase: v.string(),
    situation: v.string(),
    clientExamples: v.optional(v.array(v.string())),
    response: v.string(),
    tags: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
    source: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ key: string; created: boolean; enabled: boolean }> => {
    const situation = args.situation.trim();
    const response = args.response.trim();
    if (!situation || !response) {
      throw new Error("`situation` y `response` son obligatorios");
    }
    const ex: ExemplarCore & { source: string } = {
      key: (args.key && args.key.trim()) || makeKey(situation),
      phase: isValidPhase(args.phase) ? args.phase : "any",
      situation,
      clientExamples: (args.clientExamples ?? [])
        .map((s) => s.trim())
        .filter(Boolean),
      response,
      tags: (args.tags ?? []).map((s) => s.trim()).filter(Boolean),
      enabled: args.enabled ?? true,
      source: args.source ?? "manual",
    };
    const res = await ctx.runMutation(internal.playbook._upsertRow, ex);
    await syncExemplarToRag(ctx, ex);
    return { key: ex.key, created: res.created, enabled: ex.enabled };
  },
});

/** Borra un ejemplo de la tabla y del RAG. */
export const deleteForAdmin = internalAction({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const key = args.key.trim();
    await ctx.runMutation(internal.playbook._deleteRow, { key });
    const ns = await rag.getNamespace(ctx, { namespace: PLAYBOOK_NAMESPACE });
    if (ns) {
      try {
        await rag.deleteByKey(ctx, { namespaceId: ns.namespaceId, key });
      } catch (err) {
        console.error("playbook: deleteByKey falló (ignorado):", err);
      }
    }
    return { ok: true };
  },
});

/** Habilita/deshabilita un ejemplo (deshabilitado = fuera del índice, pero se conserva). */
export const setEnabledForAdmin = internalAction({
  args: { key: v.string(), enabled: v.boolean() },
  handler: async (
    ctx,
    args,
  ): Promise<{ key: string; enabled: boolean }> => {
    const row = await ctx.runMutation(internal.playbook._setEnabledRow, {
      key: args.key.trim(),
      enabled: args.enabled,
    });
    if (!row) throw new Error("Ejemplo no encontrado");
    await syncExemplarToRag(ctx, row);
    return { key: row.key, enabled: row.enabled };
  },
});

/** Re-sincroniza TODA la tabla con el RAG (botón "reindexar"). */
export const syncAllToRag = internalAction({
  args: {},
  handler: async (ctx): Promise<{ synced: number }> => {
    const rows = await ctx.runQuery(internal.playbook.listForAdmin, {});
    let synced = 0;
    for (const r of rows) {
      await syncExemplarToRag(ctx, r);
      synced += 1;
    }
    return { synced };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Entrenar DESDE conversaciones reales (flujo principal): el asesor busca y
// selecciona conversaciones del sistema; la IA las analiza de punta a punta
// (del primer mensaje al cierre) y propone ejemplos. NO se pega texto a mano.
// ─────────────────────────────────────────────────────────────────────────────

export type TrainingConversation = {
  conversationId: string;
  contactName: string;
  phone: string;
  channel: string;
  status: string;
  tags: string[];
  lastMessageAt: number;
  lastPreview: string;
};

/** Lista conversaciones PAGINADA (join con contacto), ordenadas por último
 *  mensaje (desc). El cursor permite scroll infinito para llegar a las viejas.
 *  Filtro opcional por nombre/teléfono (filtra cada página; el cliente sigue
 *  pidiendo páginas hasta `isDone`). */
export const listConversationsForTraining = internalQuery({
  args: {
    search: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    items: TrainingConversation[];
    continueCursor: string;
    isDone: boolean;
  }> => {
    const search = (args.search ?? "").trim().toLowerCase();
    const numItems = Math.min(Math.max(args.numItems ?? 25, 1), 50);

    const result = await ctx.db
      .query("conversations")
      .withIndex("by_last_message")
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems });

    const items: TrainingConversation[] = [];
    for (const c of result.page) {
      const contact = await ctx.db.get(c.contactId);
      const contactName = sanitizeText(contact?.name ?? "Sin nombre");
      const phone = sanitizeText(contact?.phone ?? "");
      if (search && !`${contactName} ${phone}`.toLowerCase().includes(search)) {
        continue;
      }
      const lastMsg = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
        .order("desc")
        .first();
      items.push({
        conversationId: c._id,
        contactName,
        phone,
        channel: sanitizeText(c.channel),
        status: sanitizeText(c.status),
        tags: (c.tags ?? []).map((tag) => sanitizeText(String(tag))),
        lastMessageAt: c.lastMessageAt ?? c.createdAt,
        lastPreview: sanitizeText(
          (lastMsg?.content ?? "").replace(/\s+/g, " ").trim(),
          90,
        ),
      });
    }
    return {
      items,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export type TrainingMessage = {
  sender: string;
  /** true = lo escribió un asesor HUMANO (sender assistant + sentByUserId). */
  isHuman: boolean;
  content: string;
  type: string;
  createdAt: number;
};

/** Mensajes ordenados de una conversación (preview + insumo del análisis). */
export const getConversationMessagesForTraining = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    contactName: string;
    phone: string;
    messages: TrainingMessage[];
  } | null> => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return null;
    const contact = await ctx.db.get(conv.contactId);
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
    return {
      contactName: sanitizeText(contact?.name ?? "Sin nombre"),
      phone: sanitizeText(contact?.phone ?? ""),
      messages: msgs.map((m) => ({
        sender: sanitizeText(m.sender),
        isHuman: m.sentByUserId != null,
        content: sanitizeText(m.content),
        type: sanitizeText(m.type ?? "text"),
        createdAt: m.createdAt,
      })),
    };
  },
});

type Draft = {
  situation: string;
  phase: string;
  clientExamples: string[];
  response: string;
  tags: string[];
};

/** Transcript etiquetado (Cliente / Asesor humano / Bot). Ignora system y
 *  vacíos. Cap de caracteres para acotar el costo del LLM. */
function buildTranscript(messages: TrainingMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.sender === "system") continue;
    const content = (m.content ?? "").trim();
    if (!content) continue;
    const who = m.sender === "user" ? "Cliente" : m.isHuman ? "Asesor" : "Bot";
    lines.push(`${who}: ${content}`);
  }
  return safeSlice(lines.join("\n"), 8000);
}

/** Corre el LLM sobre un transcript y devuelve 1..N ejemplos (borradores). */
async function draftsFromTranscript(transcript: string): Promise<Draft[]> {
  if (transcript.trim().length < 10) return [];

  // OJO: sin backticks dentro de strings (gotcha del proyecto). Se arma por join.
  const system = [
    "Eres un asistente que ayuda al equipo de FincasYa a construir su PLAYBOOK DE TONO a partir de conversaciones REALES.",
    "Te doy el transcript de una conversación (del primer mensaje al cierre). Roles: Cliente (usuario), Asesor (humano del equipo), Bot (respuestas automáticas).",
    "Tu tarea: identificar los MOMENTOS reutilizables donde el ASESOR respondió bien y extraer un ejemplo por cada situación distinta.",
    "APRENDE EL TONO SOLO DE LAS LÍNEAS 'Asesor:' (humano). IGNORA el tono de las líneas 'Bot:'. Usa 'Cliente:' para entender la situación.",
    "",
    "Devuelve SOLO un ARRAY JSON válido (sin markdown, sin texto extra). Cada elemento:",
    '{"situation": string, "phase": string, "clientExamples": string[], "response": string, "tags": string[]}',
    "Si no hay nada reutilizable del Asesor, devuelve [].",
    "",
    "Reglas OBLIGATORIAS por ejemplo:",
    "1. ANONIMIZA: quita nombres propios, teléfonos, cédulas, correos y direcciones.",
    "2. SIN DATOS DUROS: quita precios, montos, fechas concretas y nombres de fincas; generaliza (enseña el CÓMO, no el QUÉ).",
    '3. "situation": una frase que describa la situación del cliente.',
    '4. "response": reescribe la respuesta del Asesor en su tono cálido colombiano, anonimizada y generalizada. Máximo 4 líneas.',
    '5. "clientExamples": de 2 a 4 frases típicas del cliente para esa situación.',
    '6. "phase": una de: welcome, collecting, catalog_sent, pet_check, pet_rules_shown, quote_shown, contract, done, any.',
    '7. "tags": de 1 a 3 etiquetas en kebab-case.',
    '8. NUNCA uses la frase "un asesor te" seguida de un verbo. Usa primera persona.',
    "9. Máximo 5 ejemplos por conversación (los más valiosos).",
  ].join("\n");

  let text = "";
  try {
    const res = await generateText({
      model: openai(DRAFT_MODEL),
      system,
      prompt: transcript,
      temperature: 0.2,
      maxTokens: 1500,
    });
    text = res.text;
  } catch (err) {
    console.error("[playbook] draftsFromTranscript generateText falló:", err);
    return [];
  }

  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const arr: unknown[] = Array.isArray(parsedUnknown)
    ? parsedUnknown
    : [parsedUnknown];

  const asStr = (val: unknown): string =>
    typeof val === "string" ? val.trim() : "";
  const asArr = (val: unknown): string[] =>
    Array.isArray(val)
      ? val.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
      : [];

  const drafts: Draft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const rawPhase = asStr(o.phase);
    const draft: Draft = {
      situation: asStr(o.situation),
      phase: isValidPhase(rawPhase) ? rawPhase : "any",
      clientExamples: asArr(o.clientExamples),
      response: asStr(o.response),
      tags: asArr(o.tags),
    };
    if (draft.situation && draft.response) drafts.push(draft);
  }
  return drafts;
}

/**
 * Analiza 1..N conversaciones seleccionadas y devuelve los ejemplos propuestos
 * (borradores). NO persiste — el humano revisa y guarda con `upsertForAdmin`.
 * Este es el corazón de "escojo la conversación → la IA la analiza → la entreno".
 */
export const analyzeConversationsForDraft = internalAction({
  args: { conversationIds: v.array(v.id("conversations")) },
  handler: async (ctx, args): Promise<{ drafts: Draft[] }> => {
    const ids = args.conversationIds.slice(0, 5); // cap de costo/latencia
    const all: Draft[] = [];
    for (const id of ids) {
      const conv = await ctx.runQuery(
        internal.playbook.getConversationMessagesForTraining,
        { conversationId: id },
      );
      if (!conv) continue;
      const transcript = buildTranscript(conv.messages);
      const drafts = await draftsFromTranscript(transcript);
      all.push(...drafts);
    }
    return { drafts: all };
  },
});

/**
 * Siembra los ejemplos base (`PLAYBOOK_SEED`) EN LA TABLA y los sincroniza al
 * RAG. Idempotente por `key`. Pública para correrla por CLI:
 *   bunx convex run playbook:seedFromCode
 */
export const seedFromCode = action({
  args: {},
  handler: async (ctx): Promise<{ seeded: number }> => {
    let seeded = 0;
    for (const ex of PLAYBOOK_SEED) {
      const row: ExemplarCore & { source: string } = {
        key: ex.key,
        phase: ex.phase,
        situation: ex.situation,
        clientExamples: ex.clientExamples,
        response: ex.response,
        tags: ex.tags,
        enabled: true,
        source: "seed",
      };
      await ctx.runMutation(internal.playbook._upsertRow, row);
      await syncExemplarToRag(ctx, row);
      seeded += 1;
    }
    return { seeded };
  },
});
