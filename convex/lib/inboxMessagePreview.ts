import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const PREVIEW_MAX_LEN = 80;

export function buildInboxMessagePreview(
  content: string | undefined,
  type?: string,
): string {
  const text = (content ?? "").trim();
  if (text) {
    return text.length > PREVIEW_MAX_LEN
      ? text.slice(0, PREVIEW_MAX_LEN) + "…"
      : text;
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
  const lastMsg = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .first();
  if (!lastMsg) return "";
  return buildInboxMessagePreview(lastMsg.content, lastMsg.type);
}
