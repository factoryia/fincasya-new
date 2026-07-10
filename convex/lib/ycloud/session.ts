import { SESSION_ACTIVE_TTL_MS, SESSION_REACTIVATE_TTL_MS } from "./constants";
import {
  defaultConversationStatus,
  isChannelAiEnabled,
} from "../platformAi";

export async function getOrCreateConversationForContact(
  ctx: any,
  contactId: string,
  channel: "whatsapp" | "web" = "whatsapp",
) {
  const now = Date.now();
  const aiEnabled = await isChannelAiEnabled(ctx, channel);
  // WhatsApp: siempre arranca en humano aunque el bot global esté ON.
  // El bot solo toma un chat cuando un admin lo pone en modo IA (toggle del
  // header) — nunca por un mensaje entrante del cliente.
  const initialStatus =
    channel === "whatsapp" ? "human" : defaultConversationStatus(aiEnabled);
  const all = await ctx.db
    .query("conversations")
    .withIndex("by_contact", (q: any) => q.eq("contactId", contactId))
    .order("desc")
    .collect();

  // Chat web: un solo hilo por visitante (mismo contactId). Evita 2–3 conversaciones
  // si llegan mensajes en paralelo o el usuario reabre el widget.
  if (channel === "web") {
    const webConvs = all.filter((c: any) => c.channel === "web");
    const latest = webConvs[0];
    if (latest) {
      if (latest.status === "resolved") {
        await ctx.db.patch(latest._id, {
          status: initialStatus,
          operationalState: "pending_data",
          lastMessageAt: now,
        });
        return {
          conversationId: latest._id,
          isNew: false,
          isReactivated: true,
        };
      }
      return {
        conversationId: latest._id,
        isNew: false,
        isReactivated: false,
      };
    }
  }

  const active = all.find(
    (c: any) =>
      (c.status === "ai" || c.status === "human") &&
      c.channel === channel,
  );
  if (active) {
    const activeTs = Number(active.lastMessageAt ?? active.createdAt ?? 0);
    if (activeTs > 0 && now - activeTs < SESSION_ACTIVE_TTL_MS) {
      return { conversationId: active._id, isNew: false, isReactivated: false };
    }
    await ctx.db.patch(active._id, { status: "resolved" });
  }

  const latestResolved = all.find(
    (c: any) => c.channel === channel && c.status === "resolved",
  );
  if (latestResolved) {
    const resolvedTs = Number(latestResolved.lastMessageAt ?? latestResolved.createdAt ?? 0);
    if (resolvedTs > 0 && now - resolvedTs < SESSION_REACTIVATE_TTL_MS) {
      await ctx.db.patch(latestResolved._id, {
        status: initialStatus,
        operationalState: "pending_data",
      });
      return { conversationId: latestResolved._id, isNew: false, isReactivated: true };
    }
  }

  const conversationId = await ctx.db.insert("conversations", {
    contactId,
    channel,
    status: initialStatus,
    operationalState: "pending_data",
    lastMessageAt: now,
    createdAt: now,
  });
  return { conversationId, isNew: true, isReactivated: false };
}
