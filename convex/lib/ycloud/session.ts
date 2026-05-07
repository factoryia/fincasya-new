import { SESSION_ACTIVE_TTL_MS, SESSION_REACTIVATE_TTL_MS } from "./constants";

export async function getOrCreateConversationForContact(ctx: any, contactId: string) {
  const now = Date.now();
  const all = await ctx.db
    .query("conversations")
    .withIndex("by_contact", (q: any) => q.eq("contactId", contactId))
    .order("desc")
    .collect();

  const active = all.find((c: any) => c.status === "ai" || c.status === "human");
  if (active) {
    const activeTs = Number(active.lastMessageAt ?? active.createdAt ?? 0);
    if (activeTs > 0 && now - activeTs < SESSION_ACTIVE_TTL_MS) {
      return { conversationId: active._id, isNew: false, isReactivated: false };
    }
    await ctx.db.patch(active._id, { status: "resolved" });
  }

  const latestResolved = all.find((c: any) => c.status === "resolved");
  if (latestResolved) {
    const resolvedTs = Number(latestResolved.lastMessageAt ?? latestResolved.createdAt ?? 0);
    if (resolvedTs > 0 && now - resolvedTs < SESSION_REACTIVATE_TTL_MS) {
      await ctx.db.patch(latestResolved._id, {
        status: "ai",
        operationalState: "pending_data",
      });
      return { conversationId: latestResolved._id, isNew: false, isReactivated: true };
    }
  }

  const conversationId = await ctx.db.insert("conversations", {
    contactId,
    channel: "whatsapp",
    status: "ai",
    operationalState: "pending_data",
    lastMessageAt: now,
    createdAt: now,
  });
  return { conversationId, isNew: true, isReactivated: false };
}
