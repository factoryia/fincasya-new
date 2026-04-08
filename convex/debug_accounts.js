"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccount = void 0;
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
exports.getAccount = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const result = await ctx.runQuery(api_1.components.betterAuth.adapter.findMany, {
            model: 'account',
            paginationOpts: {
                cursor: null,
                numItems: 5,
            },
        });
        return result.page.map((acc) => ({
            userId: acc.userId,
            providerId: acc.providerId,
            passwordPrefix: acc.password
                ? acc.password.substring(0, 10)
                : 'no-password',
        }));
    },
});
//# sourceMappingURL=debug_accounts.js.map