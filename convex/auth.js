"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentUser = void 0;
const server_1 = require("./_generated/server");
exports.getCurrentUser = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        return identity;
    },
});
//# sourceMappingURL=auth.js.map