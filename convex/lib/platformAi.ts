export const GLOBAL_PLATFORM_SCOPE = 'global' as const;

export type AiChannel = 'whatsapp' | 'web';

type PlatformSettingsRow = {
  aiEnabled?: boolean;
  webAiEnabled?: boolean;
  whatsappAiEnabled?: boolean;
  /** Si true, el bot solo responde conversaciones NUEVAS (no las antiguas). */
  botOnlyNewConversations?: boolean;
  updatedAt?: number;
  updatedByUserId?: string;
};

export async function getPlatformSettingsRow(ctx: {
  db: any;
}): Promise<PlatformSettingsRow | null> {
  return await ctx.db
    .query('platformSettings')
    .withIndex('by_scope', (q: any) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
    .unique();
}

export function resolveChannelAiEnabled(
  row: PlatformSettingsRow | null | undefined,
  channel: AiChannel,
): boolean {
  if (channel === 'web') {
    if (row?.webAiEnabled !== undefined) return row.webAiEnabled === true;
    return row?.aiEnabled === true;
  }
  if (row?.whatsappAiEnabled !== undefined) {
    return row.whatsappAiEnabled === true;
  }
  return row?.aiEnabled === true;
}

/** Por defecto la IA está apagada hasta que un admin la active. */
export async function isGlobalAiEnabled(ctx: { db: any }): Promise<boolean> {
  const row = await getPlatformSettingsRow(ctx);
  return resolveChannelAiEnabled(row, 'web') || resolveChannelAiEnabled(row, 'whatsapp');
}

export async function isChannelAiEnabled(
  ctx: { db: any },
  channel: AiChannel,
): Promise<boolean> {
  const row = await getPlatformSettingsRow(ctx);
  return resolveChannelAiEnabled(row, channel);
}

export function defaultConversationStatus(aiEnabled: boolean): 'ai' | 'human' {
  return aiEnabled ? 'ai' : 'human';
}
