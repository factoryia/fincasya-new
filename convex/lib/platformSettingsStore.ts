import type { Id } from '../_generated/dataModel';
import { GLOBAL_PLATFORM_SCOPE } from './platformAi';

export async function upsertGlobalAiEnabled(
  ctx: { db: any },
  aiEnabled: boolean,
  updatedByUserId?: string,
): Promise<Id<'platformSettings'>> {
  const now = Date.now();
  const existing = await ctx.db
    .query('platformSettings')
    .withIndex('by_scope', (q: any) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      aiEnabled,
      updatedAt: now,
      updatedByUserId,
    });
    return existing._id;
  }

  return await ctx.db.insert('platformSettings', {
    scope: GLOBAL_PLATFORM_SCOPE,
    aiEnabled,
    updatedAt: now,
    updatedByUserId,
  });
}

async function escalateAllAiConversationsToHuman(ctx: { db: any }) {
  const aiConversations = await ctx.db
    .query('conversations')
    .withIndex('by_status', (q: any) => q.eq('status', 'ai'))
    .collect();

  for (const conversation of aiConversations) {
    await ctx.db.patch(conversation._id, { status: 'human' });
  }
}

export async function setGlobalAiEnabled(
  ctx: { db: any },
  aiEnabled: boolean,
  updatedByUserId?: string,
) {
  const settingsId = await upsertGlobalAiEnabled(ctx, aiEnabled, updatedByUserId);
  if (!aiEnabled) {
    await escalateAllAiConversationsToHuman(ctx);
  }
  return settingsId;
}
