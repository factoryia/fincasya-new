export const GLOBAL_PLATFORM_SCOPE = 'global' as const;

export type AiChannel = 'whatsapp' | 'web';

type PlatformSettingsRow = {
  aiEnabled?: boolean;
  webAiEnabled?: boolean;
  whatsappAiEnabled?: boolean;
  /** Legacy boolean (compat). El corte real es `botOnlyNewConversationsSince`. */
  botOnlyNewConversations?: boolean;
  /** Corte por fecha (ms): el bot solo atiende conversaciones creadas desde aquí. */
  botOnlyNewConversationsSince?: number;
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

/** ¿Está activo el corte "solo conversaciones nuevas"? (hay un timestamp). */
export async function isBotOnlyNewConversationsActive(ctx: {
  db: any;
}): Promise<boolean> {
  const row = await getPlatformSettingsRow(ctx);
  return typeof row?.botOnlyNewConversationsSince === 'number';
}
