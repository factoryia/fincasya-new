import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { Id } from './_generated/dataModel';
import { authComponent } from './betterAuth/auth';

// ============ QUERIES ============

/**
 * Listar reseñas de una propiedad
 */
export const list = query({
  args: {
    propertyId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Intentar normalizar el ID si es un ID de Convex válido
    let normalizedId = ctx.db.normalizeId('properties', args.propertyId);

    if (!normalizedId) {
      // Si no es un ID válido, intentar buscar por código (el slug de la URL suele ser el code)
      const property = await ctx.db
        .query('properties')
        .withIndex('by_code', (q) => q.eq('code', args.propertyId))
        .first();

      if (!property) return [];
      normalizedId = property._id;
    }

    const reviews = await ctx.db
      .query('reviews')
      .withIndex('by_property', (q) => q.eq('propertyId', normalizedId))
      .order('desc')
      .take(limit);

    // Obtener detalles del usuario para cada reseña
    const reviewsWithUser = await Promise.all(
      reviews.map(async (review) => {
        const user = review.userId
          ? await ctx.db.get(review.userId as any)
          : null;
        const userData = user as any;

        return {
          ...review,
          user: userData
            ? {
                name: userData.name || 'Usuario',
                image: userData.image,
              }
            : {
                name: 'Usuario',
                image: `https://api.dicebear.com/7.x/notionists/svg?seed=${review.userId || review._id}`,
              },
        };
      }),
    );

    return reviewsWithUser;
  },
});

/**
 * Debug: Intentar obtener un ID de varias tablas
 */
export const getByIdDebug = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const results: any = {};

    // Check 'user' table
    try {
      const userId = ctx.db.normalizeId('user', args.id);
      results.user = userId ? await ctx.db.get(userId) : 'not a user id';
    } catch (e: any) {
      results.user_error = e.message;
    }

    // Check 'discountCodes' table
    try {
      const dcId = ctx.db.normalizeId('discountCodes', args.id);
      results.discountCodes = dcId
        ? await ctx.db.get(dcId)
        : 'not a discountCodes id';
    } catch (e: any) {
      results.discountCodes_error = e.message;
    }

    // Check 'users' (plural) table
    try {
      const usersId = ctx.db.normalizeId('users' as any, args.id);
      results.users_plural = usersId
        ? await ctx.db.get(usersId as any)
        : 'not a users id';
    } catch (e: any) {
      results.users_plural_error = e.message;
    }

    // Check by field 'userId' in 'user' table
    try {
      results.userByUserIdField = await ctx.db
        .query('user')
        .withIndex('userId', (q) => q.eq('userId', args.id))
        .first();
    } catch (e: any) {
      results.userByUserIdField_error = e.message;
    }

    return results;
  },
});
export const debugUsers = query({
  args: {},
  handler: async (ctx) => {
    console.log('--- START DEBUG USERS ---');
    const data: any = {};

    // Check 'user' table
    try {
      const users = await ctx.db.query('user').collect();
      data.user_count = users.length;
      data.user_sample = users.slice(0, 3).map((u) => ({
        _id: u._id,
        name: u.name,
        userId: (u as any).userId,
        email: u.email,
      }));
      console.log(`User count: ${users.length}`);

      // Try to find specifically by email if we know any
      const me = await ctx.db
        .query('user')
        .withIndex('email_name', (q) =>
          q.eq('email', 'santiago.suescun@gmail.com'),
        )
        .first();
      data.found_me_by_email = !!me;
      data.authComponent_keys = Object.keys(authComponent);
    } catch (e: any) {
      data.user_error = e.message;
      console.error(`User error: ${e.message}`);
    }

    // Check 'users' (plural) table
    try {
      const usersPlural = await ctx.db.query('users' as any).collect();
      data.users_plural_count = usersPlural.length;
      data.users_plural_sample = usersPlural
        .slice(0, 3)
        .map((u) => ({ _id: u._id, name: u.name, userId: (u as any).userId }));
      console.log(`Users (plural) count: ${usersPlural.length}`);
    } catch (e: any) {
      data.users_plural_error = e.message;
      console.error(`Users (plural) error: ${e.message}`);
    }

    // Check 'session' table
    try {
      const sessions = await ctx.db.query('session').collect();
      data.sessions_count = sessions.length;
      data.sessions_sample = sessions.slice(0, 3);
      console.log(`Session count: ${sessions.length}`);
    } catch (e: any) {
      data.sessions_error = e.message;
      console.error(`Session error: ${e.message}`);
    }

    // Check 'properties' table
    try {
      const props = await ctx.db.query('properties').collect();
      data.properties_count = props.length;
      console.log(`Properties count: ${props.length}`);
    } catch (e: any) {
      data.properties_error = e.message;
    }

    // Check 'reviews' table
    try {
      const revs = await ctx.db.query('reviews').order('desc').take(10);
      data.reviews_count = revs.length;
      data.reviews_sample = revs.map((r) => ({
        _id: r._id,
        userId: (r as any).userId,
        propertyId: r.propertyId,
      }));
      console.log(`Reviews count: ${revs.length}`);
    } catch (e: any) {
      data.reviews_error = e.message;
      console.error(`Reviews error: ${e.message}`);
    }

    // Check 'discountCodes' table
    try {
      const dcs = await ctx.db.query('discountCodes').collect();
      data.discountCodes_count = dcs.length;
      data.discountCodes_sample = dcs
        .slice(0, 3)
        .map((d) => ({ _id: d._id, code: d.code }));
      console.log(`DiscountCodes count: ${dcs.length}`);
    } catch (e: any) {
      data.discountCodes_error = e.message;
      console.error(`DiscountCodes error: ${e.message}`);
    }

    console.log('--- END DEBUG USERS ---');
    return data;
  },
});

/**
 * Obtener reseña por ID
 */
export const getById = query({
  args: { id: v.id('reviews') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============ MUTATIONS ============

/**
 * Crear una nueva reseña
 */
export const create = mutation({
  args: {
    propertyId: v.string(),
    bookingId: v.optional(v.id('bookings')),
    userId: v.optional(v.string()),
    rating: v.number(),
    comment: v.optional(v.string()),
    verified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { propertyId, userId, ...rest } = args;

    // Resolve propertyId
    let normalizedPropertyId = ctx.db.normalizeId('properties', propertyId);
    if (!normalizedPropertyId) {
      const property = await ctx.db
        .query('properties')
        .withIndex('by_code', (q) => q.eq('code', propertyId))
        .first();
      if (!property) throw new Error('ID o código de propiedad inválido');
      normalizedPropertyId = property._id;
    }

    // Resolve userId to Convex _id if possible
    let userDocId: string | undefined = undefined;
    if (userId) {
      console.log(`Resolving user: ${userId}`);
      const normalizedUserId = ctx.db.normalizeId('user', userId);
      if (normalizedUserId) {
        userDocId = normalizedUserId;
        console.log(`Normalized to: ${userDocId}`);
      } else {
        // Try searching by better-auth userId field
        const user = await ctx.db
          .query('user')
          .withIndex('userId', (q) => q.eq('userId', userId))
          .first();
        if (user) {
          userDocId = user._id;
          console.log(`Found via index: ${userDocId}`);
        } else {
          console.log(`User not found via index for: ${userId}, using raw ID`);
          userDocId = userId; // Store the raw string ID
        }
      }
    }

    const now = Date.now();
    console.log(`Inserting review with userId: ${userDocId}`);
    const reviewId = await ctx.db.insert('reviews', {
      ...rest,
      propertyId: normalizedPropertyId,
      userId: userDocId,
      createdAt: now,
      updatedAt: now,
    });

    // Actualizar estadísticas de la propiedad
    await updatePropertyStats(ctx, normalizedPropertyId);

    return reviewId;
  },
});

/**
 * Actualizar una reseña
 */
export const update = mutation({
  args: {
    id: v.id('reviews'),
    rating: v.optional(v.number()),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('Reseña no encontrada');

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    // Si cambió el rating, actualizar estadísticas
    if (updates.rating !== undefined && updates.rating !== existing.rating) {
      await updatePropertyStats(ctx, existing.propertyId);
    }

    return id;
  },
});

/**
 * Eliminar una reseña
 */
export const remove = mutation({
  args: { id: v.id('reviews') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error('Reseña no encontrada');

    await ctx.db.delete(args.id);

    // Actualizar estadísticas
    await updatePropertyStats(ctx, existing.propertyId);

    return { success: true };
  },
});

// ============ HELPERS ============

/**
 * Helper para recalcular el rating promedio y contador de reseñas de una propiedad
 */
async function updatePropertyStats(ctx: any, propertyId: any) {
  const allReviews = await ctx.db
    .query('reviews')
    .withIndex('by_property', (q: any) => q.eq('propertyId', propertyId))
    .collect();

  const reviewsCount = allReviews.length;
  let rating = 0;

  if (reviewsCount > 0) {
    const sum = allReviews.reduce((acc: number, r: any) => acc + r.rating, 0);
    rating = Number((sum / reviewsCount).toFixed(1));
  }

  await ctx.db.patch(propertyId, {
    rating,
    reviewsCount,
  });
}

/**
 * Debug: Check specific hardcoded ID
 */
export const getByIdHardcoded = mutation({
  args: {},
  handler: async (ctx) => {
    const id = 'jd7ars35k6jgtt7h7rmrgpn62182jwph';
    const results: any = {};

    // Check 'user' table
    try {
      const userId = ctx.db.normalizeId('user', id);
      results.user = userId ? await ctx.db.get(userId) : 'not a user id';
    } catch (e: any) {
      results.user_error = e.message;
    }

    // Check 'users' (plural) table
    try {
      const usersId = ctx.db.normalizeId('users' as any, id);
      results.users_plural = usersId
        ? await ctx.db.get(usersId as any)
        : 'not a users id';
    } catch (e: any) {
      results.users_plural_error = e.message;
    }

    // Check 'discountCodes' table
    try {
      const dcId = ctx.db.normalizeId('discountCodes', id);
      results.discountCodes = dcId
        ? await ctx.db.get(dcId)
        : 'not a discountCodes id';
    } catch (e: any) {
      results.discountCodes_error = e.message;
    }

    return results;
  },
});
