/**
 * Queries reactivas autenticadas para el panel de inbox (mobile / web).
 *
 * - Auth: requiere identidad (Better Auth via @convex-dev/better-auth) y rol
 *   admin | assistant | vendedor en la tabla `user`.
 * - Realtime: al ser `query`s de Convex se mantienen suscritas automáticamente
 *   en clientes que usen `useQuery` de `convex/react`. No requieren polling.
 *
 * Los datos devueltos replican la forma que ya consume el panel (mismas claves
 * que `conversations:list` y `messages:listRecent`), pero con auth en línea.
 */
import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { components } from './_generated/api';

type AllowedRole =
  | 'admin'
  | 'vendedor'
  | 'asesor_limitado'
  | 'contabilidad';
const ALLOWED_ROLES: AllowedRole[] = [
  'admin',
  'vendedor',
  'asesor_limitado',
  'contabilidad',
];

async function requireInboxUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('NOT_AUTHENTICATED');

  // Lookup directo en el componente Better Auth por `_id == identity.subject`.
  // No usamos `safeGetAuthUser` porque depende de `identity.sessionId` que
  // no siempre está presente en el JWT de Convex.
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: identity.subject }],
  } as any)) as { _id?: string; email?: string; role?: string } | null;

  const role = user?.role ?? 'user';
  if (!ALLOWED_ROLES.includes(role as AllowedRole)) {
    throw new Error(
      `FORBIDDEN: role="${role}" email="${user?.email ?? identity.email ?? '?'}" subject="${identity.subject}" hasUser=${!!user}`,
    );
  }
  return { identity, user, role };
}

/**
 * Lista conversaciones del inbox para el usuario autenticado.
 *
 * - Si `role === 'vendedor'` filtra a las asignadas a su `_id` (un vendedor
 *   solo ve sus chats).
 * - admin / assistant ven todo.
 */
export const listConversations = query({
  args: {
    limit: v.optional(v.number()),
    channel: v.optional(v.union(v.literal('whatsapp'), v.literal('web'))),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, role } = await requireInboxUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 300);

    let convs = await ctx.db.query('conversations').collect();

    // Filtro por canal
    if (args.channel) {
      const matched: typeof convs = [];
      for (const c of convs) {
        let effective: 'whatsapp' | 'web';
        if (c.channel === 'web' || c.channel === 'whatsapp') {
          effective = c.channel;
        } else {
          const contact = await ctx.db.get(c.contactId);
          effective = contact?.phone?.startsWith('web:') ? 'web' : 'whatsapp';
        }
        if (effective === args.channel) matched.push(c);
      }
      convs = matched;
    }

    // Filtro por no-leídos
    if (args.unreadOnly) {
      convs = convs.filter((c) => (c.inboxUnreadCount ?? 0) > 0);
    }

    // Vendedor solo ve sus conversaciones asignadas
    if (role === 'vendedor' && user) {
      const uid = (user as { _id?: string })._id;
      convs = convs.filter((c) => c.assignedUserId === uid);
    }

    // Orden por último mensaje desc
    convs.sort(
      (a, b) =>
        (b.lastMessageAt ?? b._creationTime) -
        (a.lastMessageAt ?? a._creationTime),
    );

    const sliced = convs.slice(0, limit);

    // Enriquecer con el contacto y el último mensaje real (preview)
    const out = [] as Array<Record<string, unknown>>;
    for (const c of sliced) {
      const contact = await ctx.db.get(c.contactId);
      const { inboxUnreadCount, ...rest } = c;

      // Si la conversación no trae lastMessagePreview, lo derivamos del
      // último mensaje real en la tabla `messages`.
      let preview = (c as { lastMessagePreview?: string }).lastMessagePreview;
      if (!preview) {
        const lastMsg = await ctx.db
          .query('messages')
          .withIndex('by_conversation', (q) => q.eq('conversationId', c._id))
          .order('desc')
          .first();
        if (lastMsg) {
          const content =
            (lastMsg as { content?: string; text?: string }).content ??
            (lastMsg as { text?: string }).text ??
            '';
          preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
        }
      }

      out.push({
        ...rest,
        lastMessagePreview: preview ?? '',
        unreadCount: inboxUnreadCount ?? 0,
        contact: {
          name: (contact as { name?: string } | null)?.name ?? '',
          phone: (contact as { phone?: string } | null)?.phone ?? '',
        },
      });
    }
    return out;
  },
});

/**
 * Lista mensajes de una conversación (orden cronológico ascendente).
 */
export const listMessages = query({
  args: {
    conversationId: v.id('conversations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireInboxUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 80, 1), 200);

    const list = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) =>
        q.eq('conversationId', args.conversationId),
      )
      .order('desc')
      .take(limit);

    return list.reverse();
  },
});
