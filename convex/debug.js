"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSlugs = void 0;
const server_1 = require("./_generated/server");
exports.checkSlugs = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const fincas = await ctx.db.query("properties").collect();
        return fincas.map(f => ({ title: f.title, slug: f.slug }));
    },
});
//# sourceMappingURL=debug.js.map