import { query } from './_generated/server';
import { components } from './_generated/api';

export const getAccount = query({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'account',
      paginationOpts: {
        cursor: null,
        numItems: 5,
      },
    });
    return result.page.map((acc: any) => ({
      userId: acc.userId,
      providerId: acc.providerId,
      passwordPrefix: acc.password
        ? acc.password.substring(0, 10)
        : 'no-password',
    }));
  },
});
