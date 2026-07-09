import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type DbCtx = QueryCtx | MutationCtx;

/** First contact for a phone. `by_phone` is not unique — duplicates can exist. */
export async function findContactByPhone(
  ctx: DbCtx,
  phone: string,
): Promise<Doc<"contacts"> | null> {
  const normalized = phone.trim();
  if (!normalized) return null;
  return (
    (await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", normalized))
      .first()) ?? null
  );
}

/** All contacts sharing a phone (legacy duplicates). */
export async function listContactsByPhone(
  ctx: DbCtx,
  phone: string,
): Promise<Doc<"contacts">[]> {
  const normalized = phone.trim();
  if (!normalized) return [];
  return ctx.db
    .query("contacts")
    .withIndex("by_phone", (q) => q.eq("phone", normalized))
    .collect();
}
