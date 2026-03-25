import { mutation, query } from "./_generated/server";

export const checkSlugs = query({
  args: {},
  handler: async (ctx) => {
    const fincas = await ctx.db.query("properties").collect();
    return fincas.map(f => ({ title: f.title, slug: f.slug }));
  },
});
