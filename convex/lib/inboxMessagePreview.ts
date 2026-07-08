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
): Promise<{ preview: string; sender?: string }> {
  const lastMsg = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first();
  if (!lastMsg) return { preview: "" };
  const sender =
    typeof lastMsg.sender === "string" ? lastMsg.sender : undefined;
  return {
    preview: buildInboxMessagePreview(lastMsg.content, lastMsg.type),
    sender,
  };
}

/** Contador de no leídos efectivo para el listado del inbox. */
export function effectiveInboxUnreadCount(
  storedCount: number | undefined,
  lastMessageSender?: string,
): number {
  const raw = storedCount ?? 0;
  if (raw <= 0) return 0;
  // Si el último mensaje ya no es del cliente, el hilo fue atendido (asesor o bot).
  if (lastMessageSender && lastMessageSender !== "user") return 0;
  return raw;
}
