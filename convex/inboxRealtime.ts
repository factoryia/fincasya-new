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
import {
  effectiveInboxUnreadCount,
  getConversationLastMessageMeta,
} from './lib/inboxMessagePreview';
import { inboxHistorySinceMs } from './lib/inboxHistoryCutoff';
import { jsonSafeString } from './lib/jsonSafeString';
import { sortPropertyImages } from './lib/propertyImages';

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
    const historySince = inboxHistorySinceMs();

    let convs = await ctx.db.query('conversations').collect();

    convs = convs.filter(
      (c) => (c.lastMessageAt ?? c._creationTime) >= historySince,
    );

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
      const [contact, lastMessage] = await Promise.all([
        ctx.db.get(c.contactId),
        getConversationLastMessageMeta(ctx, c._id),
      ]);
      const { inboxUnreadCount, ...rest } = c;

      out.push({
        ...rest,
        ...(rest.tags
          ? { tags: rest.tags.map((t) => jsonSafeString(t)) }
          : {}),
        ...(rest.lastCatalogSearch
          ? {
              lastCatalogSearch: {
                ...rest.lastCatalogSearch,
                location: jsonSafeString(rest.lastCatalogSearch.location),
              },
            }
          : {}),
        lastMessagePreview: lastMessage.preview,
        unreadCount: effectiveInboxUnreadCount(
          inboxUnreadCount,
          lastMessage.sender,
        ),
        contact: {
          name: jsonSafeString(
            (contact as { name?: string } | null)?.name ?? '',
          ),
          phone: jsonSafeString(
            (contact as { phone?: string } | null)?.phone ?? '',
          ),
        },
      });
    }
    return out;
  },
});

/**
 * Lista asesores (admin / vendedor / asesor_limitado) para los filtros de
 * asignación en el inbox. Devuelve solo los campos necesarios.
 */
export const listAssignees = query({
  args: {},
  handler: async (ctx) => {
    await requireInboxUser(ctx);
    const all = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { numItems: 200, cursor: null },
    } as any)) as { page: Array<{ _id: string; email?: string; name?: string; role?: string }> };
    return (all.page ?? [])
      .filter((u) =>
        ['admin', 'vendedor', 'asesor_limitado'].includes(u.role ?? ''),
      )
      .map((u) => ({
        _id: u._id,
        name: u.name ?? '',
        email: u.email ?? '',
        role: u.role ?? '',
      }));
  },
});

/**
 * Lista mensajes de una conversación (orden cronológico ascendente).
 *
 * ENRIQUECIMIENTO: si un mensaje tiene `metadata.productRetailerId` pero le
 * faltan los campos de display (propertyName, imageUrl, etc.), resolvemos la
 * finca en la DB y completamos la metadata antes de devolverla. Esto deja
 * al móvil renderizar tarjetas de catálogo bonitas sin queries extra.
 */
export const listMessages = query({
  args: {
    conversationId: v.id('conversations'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireInboxUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 80, 1), 200);
    const historySince = inboxHistorySinceMs();

    const list = await ctx.db
      .query('messages')
      .withIndex('by_conversation', (q) =>
        q.eq('conversationId', args.conversationId).gte('createdAt', historySince),
      )
      .order('desc')
      .take(limit);

    const ordered = list.reverse();

    // Cargar todos los links de catalog → property una sola vez
    const links = await ctx.db.query('propertyWhatsAppCatalog').collect();
    const byRetailer = new Map<string, string>(); // retailerId → propertyId
    for (const l of links) {
      const rid = String(l.productRetailerId ?? '').trim();
      if (rid) byRetailer.set(rid, l.propertyId as string);
    }

    // Resolver propiedades de forma batched, sin duplicar lookups
    const propCache = new Map<string, any>();
    async function getPropMeta(retailerId: string | undefined) {
      if (!retailerId) return null;
      const rid = String(retailerId).trim();
      if (!rid) return null;
      if (propCache.has(rid)) return propCache.get(rid);

      const propertyId = byRetailer.get(rid);
      if (!propertyId) {
        propCache.set(rid, null);
        return null;
      }
      const property = (await ctx.db.get(propertyId as any)) as any;
      if (!property) {
        propCache.set(rid, null);
        return null;
      }
      const images = await ctx.db
        .query('propertyImages')
        .withIndex('by_property', (q) => q.eq('propertyId', propertyId as any))
        .collect();
      const firstImg = sortPropertyImages(images)[0];
      const enriched = {
        propertyName: property.title ?? '',
        location: property.location ?? '',
        propertyId: propertyId,
        slug: (property.slug ?? property.code ?? '').toString().trim(),
        imageUrl: firstImg?.url ?? '',
        pricePerNight:
          typeof property.priceBase === 'number' ? property.priceBase : 0,
      };
      propCache.set(rid, enriched);
      return enriched;
    }

    // Enriquecer cada mensaje que tenga retailerId pero no tenga nombre/imagen
    const out: any[] = [];
    for (const m of ordered) {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      const retailerId =
        (meta.productRetailerId as string | undefined) ??
        (meta.retailerId as string | undefined);
      const hasFull = !!meta.propertyName && !!meta.imageUrl;
      if (retailerId && !hasFull) {
        const enriched = await getPropMeta(retailerId);
        if (enriched) {
          out.push({
            ...m,
            metadata: { ...meta, ...enriched },
          });
          continue;
        }
      }
      out.push(m);
    }
    return out;
  },
});
