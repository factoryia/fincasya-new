import { query } from "./_generated/server";

/**
 * Obtener el usuario actual autenticado
 */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity;
  },
});
