import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ============ QUERIES ============

/**
 * Obtener todas las fincas con paginación
 */
export const list = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("properties")),
    location: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("FINCA"),
        v.literal("CASA_CAMPESTRE"),
        v.literal("VILLA"),
        v.literal("HACIENDA"),
        v.literal("QUINTA"),
        v.literal("APARTAMENTO"),
        v.literal("CASA")
      )
    ),
    category: v.optional(
      v.union(
        v.literal("ECONOMICA"),
        v.literal("ESTANDAR"),
        v.literal("PREMIUM"),
        v.literal("LUJO"),
        v.literal("ECOTURISMO"),
        v.literal("CON_PISCINA"),
        v.literal("CERCA_BOGOTA"),
        v.literal("GRUPOS_GRANDES"),
        v.literal("VIP")
      )
    ),
    minCapacity: v.optional(v.number()),
    maxPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    
    // Aplicar filtros con índices y obtener todas las propiedades
    const allPropertiesQuery = args.location
      ? ctx.db.query("properties").withIndex("by_location", (q) => q.eq("location", args.location!))
      : args.type
      ? ctx.db.query("properties").withIndex("by_type", (q) => q.eq("type", args.type!))
      : args.category
      ? ctx.db.query("properties").withIndex("by_category", (q) => q.eq("category", args.category!))
      : args.minCapacity
      ? ctx.db.query("properties").withIndex("by_capacity", (q) => q.gte("capacity", args.minCapacity!))
      : ctx.db.query("properties");
    
    const allProperties = await allPropertiesQuery.collect();

    // Aplicar cursor si existe (filtrar manualmente después de obtener los resultados)
    let filtered = allProperties;
    if (args.cursor) {
      filtered = filtered.filter((p: typeof allProperties[number]) => p._id > args.cursor!);
    }

    // Aplicar filtros adicionales que no tienen índice
    if (args.minCapacity && !args.location && !args.type && !args.category) {
      // Ya se aplicó con índice, no necesita filtrar de nuevo
    } else if (args.minCapacity) {
      filtered = filtered.filter((p: typeof allProperties[number]) => p.capacity >= args.minCapacity!);
    }
    if (args.maxPrice) {
      filtered = filtered.filter((p: typeof allProperties[number]) => p.priceBase <= args.maxPrice!);
    }

    // Determinar si hay más resultados
    const hasMore = filtered.length > limit;
    const propertiesToReturn = hasMore ? filtered.slice(0, limit) : filtered;

    // Obtener imágenes y características para cada propiedad
    const propertiesWithDetails = await Promise.all(
      propertiesToReturn.map(async (property: typeof allProperties[number]) => {
        const images = await ctx.db
          .query("propertyImages")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .collect();

        const features = await ctx.db
          .query("propertyFeatures")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .collect();

        // Ordenar imágenes por el campo order
        const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        return {
          ...property,
          images: sortedImages.map((img) => img.url),
          features: features.map((f) => f.name),
        };
      })
    );

    // Obtener el cursor para la siguiente página
    const nextCursor = hasMore && propertiesWithDetails.length > 0 
      ? propertiesWithDetails[propertiesWithDetails.length - 1]._id 
      : undefined;

    return {
      properties: propertiesWithDetails,
      hasMore,
      nextCursor,
    };
  },
});

/**
 * Obtener una finca por ID
 */
export const getById = query({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.id);
    if (!property) {
      return null;
    }

    const images = await ctx.db
      .query("propertyImages")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    const features = await ctx.db
      .query("propertyFeatures")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    const additionalCosts = await ctx.db
      .query("additionalCosts")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    const pricing = await ctx.db
      .query("propertyPricing")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();
    const sortedPricing = pricing.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    // Ordenar imágenes por el campo order
    const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return {
      ...property,
      images: sortedImages.map((img) => img.url),
      features: features.map((f) => f.name),
      additionalCosts,
      pricing: sortedPricing.map((p) => {
        let condicionesParsed: unknown;
        if (p.condiciones) {
          try {
            condicionesParsed = JSON.parse(p.condiciones);
          } catch {
            condicionesParsed = undefined;
          }
        }
        let reglasParsed: unknown;
        if (p.reglas) {
          try {
            reglasParsed = JSON.parse(p.reglas);
          } catch {
            reglasParsed = undefined;
          }
        }
        return {
          id: p._id,
          nombre: p.nombre,
          fechaDesde: p.fechaDesde,
          fechaHasta: p.fechaHasta,
          valorUnico: p.valorUnico,
          condiciones: condicionesParsed,
          activa: p.activa ?? true,
          reglas: reglasParsed,
          order: p.order,
        };
      }),
    };
  },
});

/**
 * Obtener una finca por código
 */
export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();

    if (!property) {
      return null;
    }

    const images = await ctx.db
      .query("propertyImages")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect();

    const features = await ctx.db
      .query("propertyFeatures")
      .withIndex("by_property", (q) => q.eq("propertyId", property._id))
      .collect();

    // Ordenar imágenes por el campo order
    const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    return {
      ...property,
      images: sortedImages.map((img) => img.url),
      features: features.map((f) => f.name),
    };
  },
});

/**
 * Buscar fincas por texto
 */
export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const searchTerm = args.query.toLowerCase();

    const allProperties = await ctx.db.query("properties").collect();

    // Buscar en título, descripción, ubicación y código
    const filtered = allProperties
      .filter(
        (p) =>
          p.title.toLowerCase().includes(searchTerm) ||
          p.description.toLowerCase().includes(searchTerm) ||
          p.location.toLowerCase().includes(searchTerm) ||
          (p.code && p.code.toLowerCase().includes(searchTerm))
      )
      .slice(0, limit);

    const propertiesWithDetails = await Promise.all(
      filtered.map(async (property) => {
        const images = await ctx.db
          .query("propertyImages")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .first();

        return {
          ...property,
          image: images?.url,
        };
      })
    );

    return propertiesWithDetails;
  },
});

/**
 * Fincas disponibles por ubicación y rango de fechas (para enviar catálogo WhatsApp).
 * Solo incluye fincas que están en al menos un catálogo (propertyWhatsAppCatalog) y sin reservas que solapen.
 */
export const searchAvailableByLocationAndDates = query({
  args: {
    location: v.string(),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 4;
    const locLower = args.location.trim().toLowerCase();
    if (!locLower) return [];

    const inCatalogIds = new Set(
      (await ctx.db.query("propertyWhatsAppCatalog").collect()).map((r) => r.propertyId)
    );
    const all = await ctx.db.query("properties").collect();
    const byLocation = all.filter(
      (p) =>
        p.location.toLowerCase().includes(locLower) && inCatalogIds.has(p._id)
    );

    const result: Array<{ _id: (typeof all)[number]["_id"]; title: string }> = [];

    for (const p of byLocation) {
      const bookings = await ctx.db
        .query("bookings")
        .withIndex("by_property", (q) => q.eq("propertyId", p._id))
        .collect();
      const overlap = bookings.some(
        (b) =>
          b.status !== "CANCELLED" &&
          b.fechaEntrada < args.fechaSalida &&
          b.fechaSalida > args.fechaEntrada
      );
      if (!overlap) {
        result.push({ _id: p._id, title: p.title });
        if (result.length >= limit) break;
      }
    }

    return result;
  },
});

// ============ MUTATIONS ============

/**
 * Crear una nueva finca
 */
export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    location: v.string(),
    capacity: v.number(),
    lat: v.number(),
    lng: v.number(),
    priceBase: v.number(),
    priceBaja: v.number(),
    priceMedia: v.number(),
    priceAlta: v.number(),
    priceEspeciales: v.optional(v.number()),
    code: v.optional(v.string()),
    category: v.optional(
      v.union(
        v.literal("ECONOMICA"),
        v.literal("ESTANDAR"),
        v.literal("PREMIUM"),
        v.literal("LUJO"),
        v.literal("ECOTURISMO"),
        v.literal("CON_PISCINA"),
        v.literal("CERCA_BOGOTA"),
        v.literal("GRUPOS_GRANDES"),
        v.literal("VIP")
      )
    ),
    type: v.optional(
      v.union(
        v.literal("FINCA"),
        v.literal("CASA_CAMPESTRE"),
        v.literal("VILLA"),
        v.literal("HACIENDA"),
        v.literal("QUINTA"),
        v.literal("APARTAMENTO"),
        v.literal("CASA")
      )
    ),
    images: v.optional(v.array(v.string())),
    features: v.optional(v.array(v.string())),
    video: v.optional(v.string()),
    pricing: v.optional(
      v.array(
        v.object({
          nombre: v.string(),
          fechaDesde: v.optional(v.string()),
          fechaHasta: v.optional(v.string()),
          valorUnico: v.optional(v.number()),
          condiciones: v.optional(v.string()),
          activa: v.optional(v.boolean()),
          reglas: v.optional(v.string()),
          order: v.optional(v.number()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const propertyId = await ctx.db.insert("properties", {
      title: args.title,
      description: args.description,
      location: args.location,
      capacity: args.capacity,
      lat: args.lat,
      lng: args.lng,
      priceBase: args.priceBase,
      priceBaja: args.priceBaja,
      priceMedia: args.priceMedia,
      priceAlta: args.priceAlta,
      priceEspeciales: args.priceEspeciales,
      code: args.code,
      category: args.category ?? "ESTANDAR",
      type: args.type ?? "FINCA",
      rating: 0,
      reviewsCount: 0,
      video: args.video,
      createdAt: now,
      updatedAt: now,
    });

    // Insertar imágenes
    if (args.images && args.images.length > 0) {
      await Promise.all(
        args.images.map((url, index) =>
          ctx.db.insert("propertyImages", {
            propertyId,
            url,
            order: index,
          })
        )
      );
    }

    // Insertar características
    if (args.features && args.features.length > 0) {
      await Promise.all(
        args.features.map((name) =>
          ctx.db.insert("propertyFeatures", {
            propertyId,
            name,
          })
        )
      );
    }

    // Insertar temporadas y precios
    if (args.pricing && args.pricing.length > 0) {
      await Promise.all(
        args.pricing.map((p, index) =>
          ctx.db.insert("propertyPricing", {
            propertyId,
            nombre: p.nombre,
            fechaDesde: p.fechaDesde,
            fechaHasta: p.fechaHasta,
            valorUnico: p.valorUnico,
            condiciones: p.condiciones,
            activa: p.activa ?? true,
            reglas: p.reglas,
            order: p.order ?? index,
            createdAt: now,
            updatedAt: now,
          })
        )
      );
    }

    return propertyId;
  },
});

/**
 * Actualizar una finca
 */
export const update = mutation({
  args: {
    id: v.id("properties"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    capacity: v.optional(v.number()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    priceBase: v.optional(v.number()),
    priceBaja: v.optional(v.number()),
    priceMedia: v.optional(v.number()),
    priceAlta: v.optional(v.number()),
    priceEspeciales: v.optional(v.number()),
    code: v.optional(v.string()),
    category: v.optional(
      v.union(
        v.literal("ECONOMICA"),
        v.literal("ESTANDAR"),
        v.literal("PREMIUM"),
        v.literal("LUJO"),
        v.literal("ECOTURISMO"),
        v.literal("CON_PISCINA"),
        v.literal("CERCA_BOGOTA"),
        v.literal("GRUPOS_GRANDES"),
        v.literal("VIP")
      )
    ),
    type: v.optional(
      v.union(
        v.literal("FINCA"),
        v.literal("CASA_CAMPESTRE"),
        v.literal("VILLA"),
        v.literal("HACIENDA"),
        v.literal("QUINTA"),
        v.literal("APARTAMENTO"),
        v.literal("CASA")
      )
    ),
    video: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const property = await ctx.db.get(id);

    if (!property) {
      throw new Error("Propiedad no encontrada");
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    return id;
  },
});

/**
 * Actualizar temporadas y precios de una finca (reemplaza todos)
 */
export const setPricing = mutation({
  args: {
    propertyId: v.id("properties"),
    pricing: v.array(
      v.object({
        nombre: v.string(),
        fechaDesde: v.optional(v.string()),
        fechaHasta: v.optional(v.string()),
        valorUnico: v.optional(v.number()),
        condiciones: v.optional(v.string()),
        activa: v.optional(v.boolean()),
        reglas: v.optional(v.string()),
        order: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new Error("Propiedad no encontrada");
    }

    const existing = await ctx.db
      .query("propertyPricing")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();

    for (const p of existing) {
      await ctx.db.delete(p._id);
    }

    const now = Date.now();
    for (let i = 0; i < args.pricing.length; i++) {
      const p = args.pricing[i];
      await ctx.db.insert("propertyPricing", {
        propertyId: args.propertyId,
        nombre: p.nombre,
        fechaDesde: p.fechaDesde,
        fechaHasta: p.fechaHasta,
        valorUnico: p.valorUnico,
        condiciones: p.condiciones,
        activa: p.activa ?? true,
        reglas: p.reglas,
        order: p.order ?? i,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Agregar una temporada a una finca
 */
export const addTemporada = mutation({
  args: {
    propertyId: v.id("properties"),
    nombre: v.string(),
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    valorUnico: v.optional(v.number()),
    condiciones: v.optional(v.string()),
    activa: v.optional(v.boolean()),
    reglas: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property) {
      throw new Error("Propiedad no encontrada");
    }

    const existing = await ctx.db
      .query("propertyPricing")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const nextOrder = args.order ?? existing.length;

    const now = Date.now();
    const id = await ctx.db.insert("propertyPricing", {
      propertyId: args.propertyId,
      nombre: args.nombre,
      fechaDesde: args.fechaDesde,
      fechaHasta: args.fechaHasta,
      valorUnico: args.valorUnico,
      condiciones: args.condiciones,
      activa: args.activa ?? true,
      reglas: args.reglas,
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/**
 * Actualizar una temporada (ej. activar/desactivar o editar reglas)
 */
export const updateTemporada = mutation({
  args: {
    pricingId: v.id("propertyPricing"),
    nombre: v.optional(v.string()),
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    valorUnico: v.optional(v.number()),
    condiciones: v.optional(v.string()),
    activa: v.optional(v.boolean()),
    reglas: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { pricingId, ...updates } = args;
    const row = await ctx.db.get(pricingId);
    if (!row) {
      throw new Error("Temporada no encontrada");
    }

    await ctx.db.patch(pricingId, {
      ...updates,
      updatedAt: Date.now(),
    });

    return pricingId;
  },
});

/**
 * Eliminar una temporada de una finca
 */
export const removeTemporada = mutation({
  args: { pricingId: v.id("propertyPricing") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.pricingId);
    if (!row) {
      throw new Error("Temporada no encontrada");
    }
    await ctx.db.delete(args.pricingId);
    return { success: true };
  },
});

/**
 * Eliminar una finca
 */
export const remove = mutation({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.id);
    if (!property) {
      throw new Error("Propiedad no encontrada");
    }

    // Eliminar imágenes relacionadas
    const images = await ctx.db
      .query("propertyImages")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    await Promise.all(images.map((img) => ctx.db.delete(img._id)));

    // Eliminar características relacionadas
    const features = await ctx.db
      .query("propertyFeatures")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    await Promise.all(features.map((f) => ctx.db.delete(f._id)));

    // Eliminar costos adicionales relacionados
    const additionalCosts = await ctx.db
      .query("additionalCosts")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    await Promise.all(additionalCosts.map((cost) => ctx.db.delete(cost._id)));

    // Eliminar temporadas/precios relacionados
    const pricing = await ctx.db
      .query("propertyPricing")
      .withIndex("by_property", (q) => q.eq("propertyId", args.id))
      .collect();

    await Promise.all(pricing.map((p) => ctx.db.delete(p._id)));

    // Eliminar la propiedad
    await ctx.db.delete(args.id);

    return { success: true };
  },
});

/**
 * Agregar imagen a una finca
 */
export const addImage = mutation({
  args: {
    propertyId: v.id("properties"),
    url: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const imageId = await ctx.db.insert("propertyImages", {
      propertyId: args.propertyId,
      url: args.url,
      order: args.order ?? 0,
    });

    return imageId;
  },
});

/**
 * Eliminar imagen de una finca
 */
export const removeImage = mutation({
  args: { imageId: v.id("propertyImages") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.imageId);
    return { success: true };
  },
});

/**
 * Agregar característica a una finca
 */
export const addFeature = mutation({
  args: {
    propertyId: v.id("properties"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const featureId = await ctx.db.insert("propertyFeatures", {
      propertyId: args.propertyId,
      name: args.name,
    });

    return featureId;
  },
});

/**
 * Eliminar característica de una finca
 */
export const removeFeature = mutation({
  args: { featureId: v.id("propertyFeatures") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.featureId);
    return { success: true };
  },
});
