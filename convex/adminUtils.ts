/**
 * Utilidades de administración para gestionar roles de usuarios internos.
 *
 * Se ejecutan desde CLI con `npx convex run adminUtils:<fn> '{...}'`.
 */
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { components } from './_generated/api';

/**
 * Lista todos los usuarios de Better Auth con su email y rol.
 *   npx convex run adminUtils:listInternalUsers '{}'
 */
export const listInternalUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { numItems: 500, cursor: null },
    } as any)) as { page: Array<{ _id: string; email?: string; name?: string; role?: string }> };
    return (result.page ?? []).map((u) => ({
      _id: u._id,
      email: u.email ?? null,
      name: u.name ?? null,
      role: u.role ?? null,
    }));
  },
});

/**
 * Cambia el rol de un usuario buscado por email.
 *   npx convex run adminUtils:setRoleByEmail '{"email":"...","role":"admin"}'
 */
export const setRoleByEmail = internalMutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal('admin'),
      v.literal('vendedor'),
      v.literal('asesor_limitado'),
      v.literal('contabilidad'),
      v.literal('propietario'),
      v.literal('client'),
      v.literal('user'),
    ),
  },
  handler: async (ctx, { email, role }) => {
    const found = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: 'email', value: email }],
    } as any)) as { _id: string; role?: string } | null;

    if (!found) throw new Error(`User not found for email: ${email}`);
    const prev = found.role ?? null;

    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      model: 'user',
      where: [{ field: '_id', value: found._id }],
      update: { role },
    } as any);

    return { ok: true, email, previousRole: prev, newRole: role, userId: found._id };
  },
});
