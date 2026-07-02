/**
 * Envío masivo de plantillas WhatsApp a contactos seleccionados.
 *
 * Módulo CRM independiente: NO toca contacts.ts, bookings.ts ni fincas.ts.
 * Solo lee de contacts/conversations y escribe en broadcastLogs (tabla propia).
 * Respeta habeas data: filtra por dataConsentStatus === "granted".
 */
import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sendTemplateToYcloud } from "./lib/ycloud/senders";
import {
  ALL_TEMPLATES,
  buildSendComponents,
  getTemplateDef,
  MANUAL_TEMPLATE_KEYS,
  renderTemplateBody,
  type TemplateDef,
} from "./lib/ycloud/templateCatalog";

const BETWEEN_SENDS_MS = 250;

function normalizeOutboundPhone(raw: string | undefined | null): string {
  const cleaned = String(raw ?? "").replace(/[^\d]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 10 && cleaned.startsWith("3")) return `57${cleaned}`;
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/** Plantillas disponibles para envío masivo (mismas que el envío manual). */
export const listTemplates = query({
  args: {},
  handler: async () =>
    MANUAL_TEMPLATE_KEYS.map((key) => {
      const def = ALL_TEMPLATES[key];
      const buttons = def.buttons ?? (def.button ? [def.button] : []);
      return {
        key: def.key,
        name: def.name,
        category: def.category,
        bodyText: def.bodyText,
        paramKeys: def.paramKeys,
        exampleParams: def.exampleParams,
        footer: def.footer ?? null,
        buttons: buttons.map((b) => ({ type: b.type, text: b.text })),
      };
    }),
});

/** Contactos elegibles para broadcast: con dataConsentStatus=granted y teléfono válido. */
export const listEligibleContacts = query({
  args: {
    contactIds: v.array(v.id("contacts")),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      _id: Id<"contacts">;
      name: string;
      phone: string;
      eligible: boolean;
      reason?: string;
    }> = [];

    for (const id of args.contactIds) {
      const contact = await ctx.db.get(id);
      if (!contact) {
        results.push({ _id: id, name: "?", phone: "", eligible: false, reason: "no_encontrado" });
        continue;
      }
      const phone = normalizeOutboundPhone(contact.phone);
      if (!phone) {
        results.push({
          _id: id,
          name: contact.name ?? "Sin nombre",
          phone: contact.phone ?? "",
          eligible: false,
          reason: "sin_telefono",
        });
        continue;
      }
      if (contact.dataConsentStatus !== "granted") {
        results.push({
          _id: id,
          name: contact.name ?? "Sin nombre",
          phone: contact.phone ?? "",
          eligible: false,
          reason: "sin_consentimiento",
        });
        continue;
      }
      results.push({
        _id: id,
        name: contact.name ?? "Sin nombre",
        phone,
        eligible: true,
      });
    }
    return results;
  },
});

/** Historial de broadcasts enviados. */
export const listBroadcasts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("broadcastLogs")
      .order("desc")
      .take(args.limit ?? 20);
    return rows;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal queries/mutations
// ─────────────────────────────────────────────────────────────────────────────

export const getContactsForSend = internalQuery({
  args: { contactIds: v.array(v.id("contacts")) },
  handler: async (ctx, args) => {
    const out: Array<{
      contactId: Id<"contacts">;
      name: string;
      phone: string;
      conversationId: Id<"conversations"> | null;
    }> = [];

    for (const id of args.contactIds) {
      const contact = await ctx.db.get(id);
      if (!contact) continue;
      const phone = normalizeOutboundPhone(contact.phone);
      if (!phone) continue;
      if (contact.dataConsentStatus !== "granted") continue;

      const convs = await ctx.db
        .query("conversations")
        .withIndex("by_contact", (q) => q.eq("contactId", id))
        .collect();
      let primaryConvId: Id<"conversations"> | null = null;
      let maxLast = -1;
      for (const c of convs) {
        if (c.channel !== "whatsapp") continue;
        const lm = c.lastMessageAt ?? c.createdAt ?? 0;
        if (lm > maxLast) {
          maxLast = lm;
          primaryConvId = c._id;
        }
      }

      out.push({
        contactId: id,
        name: contact.name ?? "Sin nombre",
        phone,
        conversationId: primaryConvId,
      });
    }
    return out;
  },
});

export const insertBroadcastLog = internalMutation({
  args: {
    templateKey: v.string(),
    templateName: v.string(),
    totalRequested: v.number(),
    totalSent: v.number(),
    totalFailed: v.number(),
    totalSkipped: v.number(),
    sentByUserId: v.optional(v.string()),
    bodyParams: v.optional(v.array(v.string())),
    recipients: v.array(
      v.object({
        contactId: v.id("contacts"),
        phone: v.string(),
        status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
        wamid: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("broadcastLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Action: envío masivo
// ─────────────────────────────────────────────────────────────────────────────

export const sendBroadcast = action({
  args: {
    contactIds: v.array(v.id("contacts")),
    templateKey: v.string(),
    bodyParams: v.optional(v.array(v.string())),
    sentByUserId: v.optional(v.string()),
    logToInbox: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    error?: string;
    totalRequested?: number;
    totalSent?: number;
    totalFailed?: number;
    totalSkipped?: number;
  }> => {
    const def = getTemplateDef(args.templateKey);
    if (!def) throw new Error(`Plantilla desconocida: ${args.templateKey}`);

    const contacts = await ctx.runQuery(
      internal.campaignBroadcast.getContactsForSend,
      { contactIds: args.contactIds },
    );

    if (contacts.length === 0) {
      return { ok: false as const, error: "No hay contactos elegibles (sin consentimiento o teléfono inválido)." };
    }

    const bodyParams = (args.bodyParams ?? []).map((p) => String(p ?? ""));
    const shouldLogToInbox = args.logToInbox !== false;

    const recipients: Array<{
      contactId: Id<"contacts">;
      phone: string;
      status: "sent" | "failed" | "skipped";
      wamid?: string;
      error?: string;
    }> = [];

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];

      const contactBodyParams = buildContactBodyParams(def, bodyParams, c.name);
      const components = buildSendComponents(def, contactBodyParams);

      try {
        const { wamid, status } = await sendTemplateToYcloud({
          to: c.phone,
          templateName: def.name,
          languageCode: def.language,
          ...(components ? { components } : { bodyParams: contactBodyParams }),
        });

        recipients.push({
          contactId: c.contactId,
          phone: c.phone,
          status: "sent",
          wamid: wamid ?? undefined,
        });
        sent++;

        if (shouldLogToInbox && c.conversationId) {
          try {
            await ctx.runMutation(internal.messages.insertAssistantMessage, {
              conversationId: c.conversationId,
              content: renderTemplateBody(def, contactBodyParams),
              createdAt: Date.now(),
              sentByUserId: args.sentByUserId,
              wamid: wamid && wamid.length > 6 ? wamid : undefined,
              metadata: {
                source: "broadcast",
                templateName: def.name,
                templateKey: def.key,
              },
            });
            await ctx.runMutation(internal.conversations.updateLastMessageAt, {
              conversationId: c.conversationId,
            });
          } catch {
            // Log failure doesn't block the broadcast
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        recipients.push({
          contactId: c.contactId,
          phone: c.phone,
          status: "failed",
          error: errorMsg.slice(0, 200),
        });
        failed++;
      }

      if (i < contacts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BETWEEN_SENDS_MS));
      }
    }

    const skipped = args.contactIds.length - contacts.length;

    await ctx.runMutation(internal.campaignBroadcast.insertBroadcastLog, {
      templateKey: args.templateKey,
      templateName: def.name,
      totalRequested: args.contactIds.length,
      totalSent: sent,
      totalFailed: failed,
      totalSkipped: skipped,
      sentByUserId: args.sentByUserId,
      bodyParams: bodyParams.length > 0 ? bodyParams : undefined,
      recipients,
    });

    return {
      ok: true as const,
      totalRequested: args.contactIds.length,
      totalSent: sent,
      totalFailed: failed,
      totalSkipped: skipped,
    };
  },
});

/**
 * Si la plantilla tiene un param "nombre"/"nombreTurista" y el bodyParam
 * correspondiente está vacío, lo rellena con el nombre del contacto.
 */
function buildContactBodyParams(
  def: TemplateDef,
  baseParams: string[],
  contactName: string,
): string[] {
  const out = [...baseParams];
  while (out.length < def.paramKeys.length) out.push("");
  for (let i = 0; i < def.paramKeys.length; i++) {
    const key = def.paramKeys[i];
    if (
      (key === "nombre" || key === "nombreTurista") &&
      !out[i]?.trim()
    ) {
      const first = contactName.split(/\s+/)[0] || contactName;
      out[i] = first;
    }
  }
  return out;
}
