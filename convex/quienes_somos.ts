import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

/**
 * Obtener el contenido de la página "¿Quiénes Somos?"
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('quienes_somos').unique();
  },
});

/**
 * Actualizar el contenido de la página "¿Quiénes Somos?"
 */
export const update = mutation({
  args: {
    queEsFincasYa: v.optional(v.string()),
    mision: v.optional(v.string()),
    vision: v.optional(v.string()),
    objetivos: v.optional(v.array(v.string())),
    politicas: v.optional(v.array(v.string())),
    trayectoriaTitle: v.optional(v.string()),
    trayectoriaParagraphs: v.optional(v.string()),
    stats: v.optional(v.array(v.object({
      label: v.string(),
      value: v.string(),
    }))),
    recognitionTitle: v.optional(v.string()),
    recognitionSubtitle: v.optional(v.string()),
    presenciaInstitucional: v.optional(v.string()),
    carouselImages: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('quienes_somos').unique();
    const now = Date.now();

    if (existing) {
      const updates: Record<string, any> = { updatedAt: now };
      
      if (args.queEsFincasYa !== undefined) updates.queEsFincasYa = args.queEsFincasYa;
      if (args.mision !== undefined) updates.mision = args.mision;
      if (args.vision !== undefined) updates.vision = args.vision;
      if (args.objetivos !== undefined) updates.objetivos = args.objetivos;
      if (args.politicas !== undefined) updates.politicas = args.politicas;
      if (args.trayectoriaTitle !== undefined) updates.trayectoriaTitle = args.trayectoriaTitle;
      if (args.trayectoriaParagraphs !== undefined) updates.trayectoriaParagraphs = args.trayectoriaParagraphs;
      if (args.stats !== undefined) updates.stats = args.stats;
      if (args.recognitionTitle !== undefined) updates.recognitionTitle = args.recognitionTitle;
      if (args.recognitionSubtitle !== undefined) updates.recognitionSubtitle = args.recognitionSubtitle;
      if (args.presenciaInstitucional !== undefined) updates.presenciaInstitucional = args.presenciaInstitucional;
      if (args.carouselImages !== undefined) updates.carouselImages = args.carouselImages;

      await ctx.db.patch(existing._id, updates);
      return existing._id;
    } else {
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
        updatedAt: now,
      });
      return id;
    }
  },
});
