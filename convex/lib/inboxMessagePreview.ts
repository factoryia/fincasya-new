import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { jsonSafeString, truncateJsonSafe } from "./jsonSafeString";

const PREVIEW_MAX_LEN = 80;

export function buildInboxMessagePreview(
  content: string | undefined,
  type?: string,
): string {
  const text = jsonSafeString(content).trim();
  if (text) {
    return truncateJsonSafe(text, PREVIEW_MAX_LEN);
  }
  switch (type) {
    case "image":
      return "Imagen";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "document":
      return "Documento";
    case "product":
      return "Finca seleccionada del catálogo";
    default:
      return "";
  }
}

export async function getConversationLastMessagePreview(
  ctx: QueryCtx,
  conversationId: Id<"conversations">,
): Promise<string> {
  const meta = await getConversationLastMessageMeta(ctx, conversationId);
  return meta.preview;
}

export async function getConversationLastMessageMeta(
  ctx: QueryCtx,
  conversationId: Id<"conversations">,
): Promise<{
  preview: string;
  sender?: string;
  lastContactMessageAt?: number;
}> {
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .take(50);

  const lastMsg = recent[0];
  if (!lastMsg) return { preview: "" };

  const sender =
    typeof lastMsg.sender === "string" ? lastMsg.sender : undefined;

  let lastContactMessageAt: number | undefined;
  for (const msg of recent) {
    const msgSender =
      typeof msg.sender === "string" ? msg.sender : undefined;
    if (msgSender !== "user") continue;
    if (msg.metadata?.kind === "inbox_escalation_alert") continue;
    lastContactMessageAt = msg.createdAt ?? msg._creationTime;
    break;
  }

  return {
    preview: buildInboxMessagePreview(lastMsg.content, lastMsg.type),
    sender,
    lastContactMessageAt,
  };
}

/** Contador de no leídos efectivo para el listado del inbox. */
export function effectiveInboxUnreadCount(
  storedCount: number | undefined,
  opts?: {
    lastMessageSender?: string;
    inboxLastReadAt?: number | null;
    lastContactMessageAt?: number | null;
  },
): number {
  const raw = storedCount ?? 0;
  if (raw <= 0) return 0;

  const lastRead = opts?.inboxLastReadAt ?? 0;
  const lastContact = opts?.lastContactMessageAt;

  // Marca manual "no leída" o mensajes del cliente después del cursor de lectura.
  if (lastContact != null && lastContact > lastRead) {
    return raw;
  }

  // Si el último mensaje ya es del equipo, no hay pendiente de lectura.
  if (opts?.lastMessageSender && opts.lastMessageSender !== "user") {
    return 0;
  }

  return raw;
}
