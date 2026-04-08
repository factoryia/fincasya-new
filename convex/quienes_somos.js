"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.update = exports.get = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.get = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query('quienes_somos').unique();
    },
});
exports.update = (0, server_1.mutation)({
    args: {
        queEsFincasYa: values_1.v.optional(values_1.v.string()),
        mision: values_1.v.optional(values_1.v.string()),
        vision: values_1.v.optional(values_1.v.string()),
        objetivos: values_1.v.optional(values_1.v.array(values_1.v.string())),
        politicas: values_1.v.optional(values_1.v.array(values_1.v.string())),
        trayectoriaTitle: values_1.v.optional(values_1.v.string()),
        trayectoriaParagraphs: values_1.v.optional(values_1.v.string()),
        stats: values_1.v.optional(values_1.v.array(values_1.v.object({
            label: values_1.v.string(),
            value: values_1.v.string(),
        }))),
        recognitionTitle: values_1.v.optional(values_1.v.string()),
        recognitionSubtitle: values_1.v.optional(values_1.v.string()),
        presenciaInstitucional: values_1.v.optional(values_1.v.string()),
        carouselImages: values_1.v.optional(values_1.v.array(values_1.v.string())),
        videoUrl: values_1.v.optional(values_1.v.string()),
        videoTitle: values_1.v.optional(values_1.v.string()),
        videoDescription: values_1.v.optional(values_1.v.string()),
        videoBadge: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query('quienes_somos').unique();
        const now = Date.now();
        if (existing) {
            const updates = { updatedAt: now };
            if (args.queEsFincasYa !== undefined)
                updates.queEsFincasYa = args.queEsFincasYa;
            if (args.mision !== undefined)
                updates.mision = args.mision;
            if (args.vision !== undefined)
                updates.vision = args.vision;
            if (args.objetivos !== undefined)
                updates.objetivos = args.objetivos;
            if (args.politicas !== undefined)
                updates.politicas = args.politicas;
            if (args.trayectoriaTitle !== undefined)
                updates.trayectoriaTitle = args.trayectoriaTitle;
            if (args.trayectoriaParagraphs !== undefined)
                updates.trayectoriaParagraphs = args.trayectoriaParagraphs;
            if (args.stats !== undefined)
                updates.stats = args.stats;
            if (args.recognitionTitle !== undefined)
                updates.recognitionTitle = args.recognitionTitle;
            if (args.recognitionSubtitle !== undefined)
                updates.recognitionSubtitle = args.recognitionSubtitle;
            if (args.presenciaInstitucional !== undefined)
                updates.presenciaInstitucional = args.presenciaInstitucional;
            if (args.carouselImages !== undefined)
                updates.carouselImages = args.carouselImages;
            if (args.videoUrl !== undefined)
                updates.videoUrl = args.videoUrl;
            if (args.videoTitle !== undefined)
                updates.videoTitle = args.videoTitle;
            if (args.videoDescription !== undefined)
                updates.videoDescription = args.videoDescription;
            if (args.videoBadge !== undefined)
                updates.videoBadge = args.videoBadge;
            await ctx.db.patch(existing._id, updates);
            return existing._id;
        }
        else {
            const id = await ctx.db.insert('quienes_somos', {
                queEsFincasYa: args.queEsFincasYa ?? '',
                mision: args.mision ?? '',
                vision: args.vision ?? '',
                objetivos: args.objetivos ?? [],
                politicas: args.politicas ?? [],
                trayectoriaTitle: args.trayectoriaTitle ?? '',
                trayectoriaParagraphs: args.trayectoriaParagraphs ?? '',
                stats: args.stats ?? [],
                recognitionTitle: args.recognitionTitle ?? '',
                recognitionSubtitle: args.recognitionSubtitle ?? '',
                presenciaInstitucional: args.presenciaInstitucional ?? '',
                carouselImages: args.carouselImages ?? [],
                videoUrl: args.videoUrl ?? '',
                videoTitle: args.videoTitle ?? '',
                videoDescription: args.videoDescription ?? '',
                videoBadge: args.videoBadge ?? '',
                updatedAt: now,
            });
            return id;
        }
    },
});
//# sourceMappingURL=quienes_somos.js.map