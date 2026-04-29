import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

// ============ QUERIES ============

/**
 * Listar todos los encargados contables
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('accountingManagers').collect();
  },
});

/**
 * Obtener un encargado por ID
 */
export const getById = query({
  args: { id: v.id('accountingManagers') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============ MUTATIONS ============

/**
 * Crear un encargado contable
 */
export const create = mutation({
  args: {
    name: v.string(),
    idNumber: v.string(),
    idIssuancePlace: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    bankName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('accountingManagers', {
      name: args.name,
      idNumber: args.idNumber,
      idIssuancePlace: args.idIssuancePlace,
      accountNumber: args.accountNumber,
      bankName: args.bankName,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Actualizar un encargado contable
 */
export const update = mutation({
  args: {
    id: v.id('accountingManagers'),
    name: v.optional(v.string()),
    idNumber: v.optional(v.string()),
    idIssuancePlace: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    bankName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error('Encargado no encontrado');
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.idNumber !== undefined) updates.idNumber = args.idNumber;
    if (args.idIssuancePlace !== undefined) updates.idIssuancePlace = args.idIssuancePlace;
    if (args.accountNumber !== undefined) updates.accountNumber = args.accountNumber;
    if (args.bankName !== undefined) updates.bankName = args.bankName;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Eliminar un encargado contable
 */
export const remove = mutation({
  args: { id: v.id('accountingManagers') },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error('Encargado no encontrado');
    }
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
