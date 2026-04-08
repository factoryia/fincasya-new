"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirstOwner = void 0;
const server_1 = require("./_generated/server");
exports.getFirstOwner = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const owner = await ctx.db
            .query("user")
            .filter((q) => q.eq(q.field("role"), "propietario"))
            .first();
        return owner;
    },
});
//# sourceMappingURL=debug_owner.js.map