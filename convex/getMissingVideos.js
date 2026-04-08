"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./_generated/server");
exports.default = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const allProperties = await ctx.db.query('properties').collect();
        const missingVideo = allProperties.filter((p) => !p.video || p.video.trim() === '');
        return missingVideo.map((p) => p.title);
    },
});
//# sourceMappingURL=getMissingVideos.js.map