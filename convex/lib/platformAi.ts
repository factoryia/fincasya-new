export const GLOBAL_PLATFORM_SCOPE = 'global' as const;

/** Por defecto la IA está apagada hasta que un admin la active. */
export async function isGlobalAiEnabled(ctx: { db: any }): Promise<boolean> {
  const row = await ctx.db
    .query('platformSettings')
    .withIndex('by_scope', (q: any) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
    .unique();
  return row?.aiEnabled === true;
}

export function defaultConversationStatus(aiEnabled: boolean): 'ai' | 'human' {
  return aiEnabled ? 'ai' : 'human';
}
