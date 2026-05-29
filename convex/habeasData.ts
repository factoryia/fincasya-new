import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Solicitudes de Habeas Data (Ley 1581 Colombia).
 *
 * - `create`: público (cualquier titular puede crear una solicitud).
 * - `list` / `getById` / `updateStatus`: para el admin.
 *   La autorización se gestiona desde el controller de NestJS con AdminGuard;
 *   acá solo exponemos las funciones.
 */

const VALID_REQUEST_TYPES = [
  'acceso',
  'rectificacion',
  'cancelacion',
  'oposicion',
  'revocatoria',
  'queja',
];

const VALID_STATUSES = ['pending', 'in_review', 'resolved', 'rejected'];

// ============ MUTATIONS ============

export const create = mutation({
  args: {
    fullName: v.string(),
    documentType: v.string(),
    documentNumber: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    requestType: v.string(),
    description: v.string(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!VALID_REQUEST_TYPES.includes(args.requestType)) {
      throw new Error(`Tipo de solicitud inválido: ${args.requestType}`);
    }
    const now = Date.now();
    const id = await ctx.db.insert('habeasDataRequests', {
      fullName: args.fullName.trim(),
      documentType: args.documentType.trim(),
      documentNumber: args.documentNumber.trim(),
      email: args.email.toLowerCase().trim(),
      phone: args.phone?.trim(),
      requestType: args.requestType,
      description: args.description.trim(),
      status: 'pending',
      ipAddress: args.ipAddress,
      userAgent: args.userAgent?.slice(0, 500),
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id('habeasDataRequests'),
    status: v.string(),
    internalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!VALID_STATUSES.includes(args.status)) {
      throw new Error(`Estado inválido: ${args.status}`);
    }
    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };
    if (args.internalNotes !== undefined) {
      patch.internalNotes = args.internalNotes;
    }
    if (args.status === 'resolved' || args.status === 'rejected') {
      patch.resolvedAt = now;
    }
    await ctx.db.patch(args.id, patch);
    return { ok: true };
  },
});

// ============ QUERIES ============

export const list = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const baseQuery = args.status
      ? ctx.db
          .query('habeasDataRequests')
          .withIndex('by_status', (q) => q.eq('status', args.status as string))
      : ctx.db.query('habeasDataRequests').withIndex('by_created');
    return await baseQuery.order('desc').take(limit);
  },
});

export const getById = query({
  args: { id: v.id('habeasDataRequests') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const countPending = query({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query('habeasDataRequests')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect();
    return pending.length;
  },
});
