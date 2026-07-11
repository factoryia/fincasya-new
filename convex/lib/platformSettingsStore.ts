import type { Id } from '../_generated/dataModel';
import { clearPendingResumeFromHumanDb } from '../botSessions';
import {
  AiChannel,
  GLOBAL_PLATFORM_SCOPE,
  getPlatformSettingsRow,
  resolveChannelAiEnabled,
} from './platformAi';

type PlatformSettingsPatch = {
  aiEnabled?: boolean;
  webAiEnabled?: boolean;
  whatsappAiEnabled?: boolean;
  updatedAt: number;
  updatedByUserId?: string;
};

async function upsertPlatformSettings(
  ctx: { db: any },
  patch: PlatformSettingsPatch,
): Promise<Id<'platformSettings'>> {
  const existing = await ctx.db
    .query('platformSettings')
    .withIndex('by_scope', (q: any) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }

  return await ctx.db.insert('platformSettings', {
    scope: GLOBAL_PLATFORM_SCOPE,
    aiEnabled: patch.aiEnabled ?? false,
    webAiEnabled: patch.webAiEnabled,
    whatsappAiEnabled: patch.whatsappAiEnabled,
    updatedAt: patch.updatedAt,
    updatedByUserId: patch.updatedByUserId,
  });
}

async function escalateChannelAiConversationsToHuman(
  ctx: { db: any },
  channel: AiChannel,
) {
  const aiConversations = await ctx.db
    .query('conversations')
    .withIndex('by_status', (q: any) => q.eq('status', 'ai'))
    .collect();

  for (const conversation of aiConversations) {
    if (conversation.channel !== channel) continue;
    await ctx.db.patch(conversation._id, { status: 'human', attended: true });
    await clearPendingResumeFromHumanDb(ctx, conversation._id);
  }
}

export async function upsertGlobalAiEnabled(
  ctx: { db: any },
  aiEnabled: boolean,
  updatedByUserId?: string,
): Promise<Id<'platformSettings'>> {
  const now = Date.now();
  const settingsId = await upsertPlatformSettings(ctx, {
    aiEnabled,
    webAiEnabled: aiEnabled,
    whatsappAiEnabled: aiEnabled,
    updatedAt: now,
    updatedByUserId,
  });
  if (!aiEnabled) {
    await escalateChannelAiConversationsToHuman(ctx, 'web');
    await escalateChannelAiConversationsToHuman(ctx, 'whatsapp');
  }
  // Al encender: no reactivar conversaciones en masa (web ni WhatsApp).
  return settingsId;
}

export async function setGlobalAiEnabled(
  ctx: { db: any },
  aiEnabled: boolean,
  updatedByUserId?: string,
) {
  return await upsertGlobalAiEnabled(ctx, aiEnabled, updatedByUserId);
}

export async function setChannelAiEnabled(
  ctx: { db: any },
  channel: AiChannel,
  aiEnabled: boolean,
  updatedByUserId?: string,
) {
  const now = Date.now();
  const existing = await getPlatformSettingsRow(ctx);
  const webAiEnabled =
    channel === 'web'
      ? aiEnabled
      : resolveChannelAiEnabled(existing, 'web');
  const whatsappAiEnabled =
    channel === 'whatsapp'
      ? aiEnabled
      : resolveChannelAiEnabled(existing, 'whatsapp');

  const settingsId = await upsertPlatformSettings(ctx, {
    aiEnabled: webAiEnabled || whatsappAiEnabled,
    webAiEnabled,
    whatsappAiEnabled,
    updatedAt: now,
    updatedByUserId,
  });

  if (!aiEnabled) {
    await escalateChannelAiConversationsToHuman(ctx, channel);
  }
  // Al encender: no reactivar conversaciones en masa (igual que WhatsApp).

  return settingsId;
}
