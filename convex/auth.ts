import { query } from "./_generated/server";

/**
 * Obtener el usuario actual autenticado
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Buscar el usuario completo en la tabla 'user' de Better Auth
    const user = await ctx.db
      .query('user')
      .withIndex('userId', (q) => q.eq('userId', identity.subject))
      .first();

    return user ?? identity;
  },
});
