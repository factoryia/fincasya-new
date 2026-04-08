"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTabOrder = exports.getTabOrder = exports.getTabOrders = exports.updateImageOrder = exports.removeFeature = exports.unlinkFeature = exports.addFeature = exports.removeImage = exports.getImageById = exports.addImage = exports.remove = exports.removeTemporada = exports.updateTemporada = exports.addTemporada = exports.setPricing = exports.update = exports.create = exports.getPropertyAvailability = exports.getPropertyPricingRules = exports.getAllUniqueLocations = exports.searchAvailableByLocationAndDates = exports.search = exports.getBySlug = exports.getByCode = exports.calculateStayPrice = exports.getPropertyImage = exports.findBySearchTerm = exports.calculateSuggestedPrice = exports.getById = exports.list = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
const slugify = (text) => {
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]+/g, "")
        .replace(/--+/g, "-");
};
const SEARCH_STOPWORDS = new Set([
    'estoy',
    'buscando',
    'en',
    'una',
    'para',
    'el',
    'la',
    'los',
    'las',
    'que',
    'más',
    'mas',
    'personas',
    'grupo',
    'amigos',
    'dame',
    'buen',
    'precio',
    'este',
    'fin',
    'de',
    'semana',
    'viene',
    'o',
    'y',
    'con',
    'del',
    'al',
    'por',
    'necesito',
    'quiero',
    'ver',
    'opciones',
    'me',
    'gusta',
    'gustan',
]);
exports.list = (0, server_1.query)({
    args: {
        limit: values_1.v.optional(values_1.v.number()),
        cursor: values_1.v.optional(values_1.v.id('properties')),
        location: values_1.v.optional(values_1.v.string()),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal('FINCA'), values_1.v.literal('CASA_CAMPESTRE'), values_1.v.literal('VILLA'), values_1.v.literal('HACIENDA'), values_1.v.literal('QUINTA'), values_1.v.literal('APARTAMENTO'), values_1.v.literal('CASA'), values_1.v.literal('CASA_PRIVADA'), values_1.v.literal('CASA_EN_CONJUNTO_CERRADO'), values_1.v.literal('VILLA_PRIVADA'), values_1.v.literal('CONDOMINIO'), values_1.v.literal('YATE'), values_1.v.literal('ISLA'), values_1.v.literal('GLAMPING'))),
        category: values_1.v.optional(values_1.v.union(values_1.v.literal('ECONOMICA'), values_1.v.literal('ESTANDAR'), values_1.v.literal('PREMIUM'), values_1.v.literal('LUJO'), values_1.v.literal('ECOTURISMO'), values_1.v.literal('CON_PISCINA'), values_1.v.literal('CERCA_BOGOTA'), values_1.v.literal('GRUPOS_GRANDES'), values_1.v.literal('VIP'))),
        minCapacity: values_1.v.optional(values_1.v.number()),
        maxPrice: values_1.v.optional(values_1.v.number()),
        isFavorite: values_1.v.optional(values_1.v.boolean()),
        all: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 1000;
        const allPropertiesQuery = args.location
            ? ctx.db
                .query('properties')
                .withIndex('by_location', (q) => q.eq('location', args.location))
            : args.type
                ? ctx.db
                    .query('properties')
                    .withIndex('by_type', (q) => q.eq('type', args.type))
                : args.category
                    ? ctx.db
                        .query('properties')
                        .withIndex('by_category', (q) => q.eq('category', args.category))
                    : args.minCapacity
                        ? ctx.db
                            .query('properties')
                            .withIndex('by_capacity', (q) => q.gte('capacity', args.minCapacity))
                        : ctx.db
                            .query('properties')
                            .withIndex('by_createdAt')
                            .order('desc');
        const allProperties = await allPropertiesQuery.collect();
        const showAll = args.all === true;
        const filteredByVisibility = showAll
            ? allProperties
            : allProperties.filter((p) => p.active !== false && p.visible !== false);
        let filtered = filteredByVisibility;
        if (args.cursor) {
            filtered = filtered.filter((p) => p._id > args.cursor);
        }
        if (args.minCapacity && !args.location && !args.type && !args.category) {
        }
        else if (args.minCapacity) {
            filtered = filtered.filter((p) => p.capacity >= args.minCapacity);
        }
        if (args.maxPrice) {
            filtered = filtered.filter((p) => p.priceBase <= args.maxPrice);
        }
        if (args.isFavorite !== undefined) {
            filtered = filtered.filter((p) => p.isFavorite === args.isFavorite);
        }
        const hasMore = filtered.length > limit;
        const propertiesToReturn = hasMore ? filtered.slice(0, limit) : filtered;
        const propertiesWithDetails = await Promise.all(propertiesToReturn.map(async (property) => {
            const images = await ctx.db
                .query('propertyImages')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .collect();
            const features = await ctx.db
                .query('propertyFeatures')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .collect();
            const enrichedFeatures = await Promise.all(features.map(async (f) => {
                if (f.iconId) {
                    const icon = await ctx.db.get(f.iconId);
                    return {
                        name: f.name,
                        iconId: f.iconId,
                        iconUrl: icon?.iconUrl ?? null,
                        emoji: icon?.emoji ?? null,
                    };
                }
                return { name: f.name, iconId: null, iconUrl: null, emoji: null };
            }));
            const pricingRows = await ctx.db
                .query('propertyPricing')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .collect();
            const sortedPricing = pricingRows.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            const catalogLinks = await ctx.db
                .query('propertyWhatsAppCatalog')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .collect();
            const catalogs = await Promise.all(catalogLinks.map((link) => ctx.db.get(link.catalogId)));
            const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            return {
                ...property,
                active: property.active ?? true,
                visible: property.visible ?? true,
                reservable: property.reservable ?? true,
                images: sortedImages.map((img) => img.url),
                features: enrichedFeatures,
                featuredIcons: property.featuredIcons ?? [],
                pricing: await Promise.all(sortedPricing.map(async (p) => {
                    let globalData = null;
                    if (p.globalRuleId) {
                        globalData = await ctx.db.get(p.globalRuleId);
                    }
                    let condicionesParsed;
                    if (p.condiciones) {
                        try {
                            condicionesParsed = JSON.parse(p.condiciones);
                        }
                        catch {
                            condicionesParsed = undefined;
                        }
                    }
                    let reglasParsed;
                    if (p.reglas) {
                        try {
                            reglasParsed = JSON.parse(p.reglas);
                        }
                        catch {
                            reglasParsed = undefined;
                        }
                    }
                    return {
                        id: p._id,
                        globalRuleId: p.globalRuleId,
                        nombre: globalData?.nombre || p.nombre,
                        fechaDesde: globalData?.fechaDesde || p.fechaDesde,
                        fechaHasta: globalData?.fechaHasta || p.fechaHasta,
                        fechas: globalData?.fechas || p.fechas,
                        valorUnico: p.valorUnico,
                        condiciones: condicionesParsed,
                        activa: (globalData?.activa !== false) && (p.activa ?? true),
                        reglas: reglasParsed,
                        order: p.order,
                        subReglasCapacidad: p.subReglasCapacidad,
                    };
                })),
                metaCatalogs: catalogLinks.map((link, index) => {
                    const catalog = catalogs[index];
                    return {
                        catalogId: link.catalogId,
                        productRetailerId: link.productRetailerId,
                        whatsappCatalogId: catalog?.whatsappCatalogId ?? null,
                        catalogName: catalog?.name ?? null,
                    };
                }),
            };
        }));
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
exports.getById = (0, server_1.query)({
    args: { id: values_1.v.id('properties') },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.id);
        if (!property) {
            return null;
        }
        const images = await ctx.db
            .query('propertyImages')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        const features = await ctx.db
            .query('propertyFeatures')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        const enrichedFeatures = await Promise.all(features.map(async (f) => {
            if (f.iconId) {
                const icon = await ctx.db.get(f.iconId);
                return {
                    name: f.name,
                    iconId: f.iconId,
                    iconUrl: icon?.iconUrl ?? null,
                    emoji: icon?.emoji ?? null,
                    zone: f.zone,
                };
            }
            return {
                name: f.name,
                iconId: null,
                iconUrl: null,
                emoji: null,
                zone: f.zone,
            };
        }));
        const additionalCosts = await ctx.db
            .query('additionalCosts')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        const pricing = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        const sortedPricing = pricing.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return {
            ...property,
            images: sortedImages.map((img) => img.url),
            imageItems: sortedImages.map((img) => ({ id: img._id, url: img.url })),
            features: enrichedFeatures,
            featuredIcons: property.featuredIcons ?? [],
            additionalCosts,
            pricing: await Promise.all(sortedPricing.map(async (p) => {
                let globalData = null;
                if (p.globalRuleId) {
                    globalData = await ctx.db.get(p.globalRuleId);
                }
                let condicionesParsed;
                if (p.condiciones) {
                    try {
                        condicionesParsed = JSON.parse(p.condiciones);
                    }
                    catch {
                        condicionesParsed = undefined;
                    }
                }
                let reglasParsed;
                if (p.reglas) {
                    try {
                        reglasParsed = JSON.parse(p.reglas);
                    }
                    catch {
                        reglasParsed = undefined;
                    }
                }
                return {
                    id: p._id,
                    globalRuleId: p.globalRuleId,
                    nombre: globalData?.nombre || p.nombre,
                    fechaDesde: globalData?.fechaDesde || p.fechaDesde,
                    fechaHasta: globalData?.fechaHasta || p.fechaHasta,
                    fechas: globalData?.fechas || p.fechas,
                    valorUnico: p.valorUnico,
                    condiciones: condicionesParsed,
                    activa: (globalData?.activa !== false) && (p.activa ?? true),
                    reglas: reglasParsed,
                    order: p.order,
                    subReglasCapacidad: p.subReglasCapacidad,
                };
            })),
        };
    },
});
async function getActivePricingRules(ctx, propertyId) {
    const pricingRules = await ctx.db
        .query('propertyPricing')
        .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
        .collect();
    const activeRules = [];
    for (const rule of pricingRules) {
        let globalData = null;
        if (rule.globalRuleId) {
            globalData = await ctx.db.get(rule.globalRuleId);
        }
        const isActive = (globalData?.activa !== false) && (rule.activa ?? true);
        if (isActive) {
            activeRules.push({
                ...rule,
                fechaDesde: globalData?.fechaDesde || rule.fechaDesde,
                fechaHasta: globalData?.fechaHasta || rule.fechaHasta,
                fechas: globalData?.fechas || rule.fechas,
            });
        }
    }
    return activeRules.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
function getPriceForDate(dateStr, basePrice, activeRules) {
    const parts = dateStr.split('-');
    if (parts.length < 3)
        return { price: basePrice, ruleName: "Estándar" };
    const mmdd = `${parts[1]}-${parts[2]}`;
    for (const rule of activeRules) {
        if (rule.fechas?.includes(mmdd)) {
            return { price: rule.valorUnico ?? basePrice, ruleName: rule.nombre || "Especial" };
        }
        if (rule.fechaDesde && rule.fechaHasta) {
            if (rule.fechaDesde <= rule.fechaHasta) {
                if (mmdd >= rule.fechaDesde && mmdd <= rule.fechaHasta) {
                    return { price: rule.valorUnico ?? basePrice, ruleName: rule.nombre || "Especial" };
                }
            }
            else {
                if (mmdd >= rule.fechaDesde || mmdd <= rule.fechaHasta) {
                    return { price: rule.valorUnico ?? basePrice, ruleName: rule.nombre || "Especial" };
                }
            }
        }
    }
    return { price: basePrice, ruleName: "Estándar" };
}
exports.calculateSuggestedPrice = (0, server_1.query)({
    args: {
        propertyId: values_1.v.id('properties'),
        checkInDate: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.propertyId);
        if (!property)
            return null;
        const activeRules = await getActivePricingRules(ctx, args.propertyId);
        const result = getPriceForDate(args.checkInDate, property.priceBase, activeRules);
        return result.price;
    },
});
exports.findBySearchTerm = (0, server_1.query)({
    args: { term: values_1.v.string() },
    handler: async (ctx, args) => {
        const rawTerm = args.term.toLowerCase().trim();
        if (!rawTerm)
            return null;
        const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const term = normalize(rawTerm);
        const all = await ctx.db.query('properties').collect();
        const exact = all.find((p) => (p.slug && normalize(p.slug) === term) ||
            (p.code && normalize(p.code) === term) ||
            normalize(p.title) === term);
        if (exact)
            return exact;
        const termWords = term.split(/\s+/).filter(w => w.length > 2 && !SEARCH_STOPWORDS.has(w));
        if (termWords.length === 0) {
            return all.find((p) => normalize(p.title).includes(term)) ?? null;
        }
        let bestMatch = null;
        let highestScore = 0;
        for (const p of all) {
            const pTitle = normalize(p.title);
            const pSlug = p.slug ? normalize(p.slug) : "";
            const pCode = p.code ? normalize(p.code) : "";
            let score = 0;
            let matchedWords = 0;
            const pWords = new Set([...pTitle.split(/\s+/), ...pSlug.split("-"), pCode].filter(w => w.length > 2));
            for (const word of termWords) {
                if (pWords.has(word)) {
                    matchedWords++;
                    score += 10;
                    if (pTitle.startsWith(word) || pSlug.startsWith(word) || pCode === word) {
                        score += 5;
                    }
                }
                else if (pTitle.includes(word) || pSlug.includes(word) || pCode.includes(word)) {
                    matchedWords++;
                    score += 3;
                }
            }
            if (matchedWords > 0) {
                const coverage = matchedWords / termWords.length;
                const coverageMultiplier = coverage === 1 ? 3 : coverage >= 0.5 ? 1.5 : 1;
                const finalScore = score * coverageMultiplier;
                if (finalScore > highestScore) {
                    highestScore = finalScore;
                    bestMatch = p;
                }
            }
        }
        if (!bestMatch || highestScore < 15) {
            const condensedTerm = term.replace(/\s+/g, "");
            if (condensedTerm.length >= 4) {
                for (const p of all) {
                    const condensedTitle = normalize(p.title).replace(/\s+/g, "");
                    const condensedSlug = (p.slug ? normalize(p.slug) : "").replace(/[^a-z0-9]/g, "");
                    if (condensedTitle.includes(condensedTerm) || condensedSlug.includes(condensedTerm) || condensedTerm.includes(condensedTitle)) {
                        bestMatch = p;
                        highestScore = 20;
                        break;
                    }
                }
            }
        }
        if (!bestMatch) {
            bestMatch = all.find((p) => normalize(p.title).includes(term) || (p.slug && normalize(p.slug).includes(term)));
        }
        return bestMatch ?? null;
    },
});
exports.getPropertyImage = (0, server_1.query)({
    args: { propertyId: values_1.v.id('properties') },
    handler: async (ctx, args) => {
        const images = await ctx.db
            .query('propertyImages')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .first();
        return images;
    },
});
exports.calculateStayPrice = (0, server_1.query)({
    args: {
        propertyId: values_1.v.id('properties'),
        fechaEntrada: values_1.v.string(),
        fechaSalida: values_1.v.string(),
        numeroPersonas: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.propertyId);
        if (!property)
            return { total: 0, nights: [] };
        const activeRules = await getActivePricingRules(ctx, args.propertyId);
        const start = new Date(args.fechaEntrada + "T12:00:00");
        const end = new Date(args.fechaSalida + "T12:00:00");
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
            return { total: 0, nights: [] };
        }
        const nights = [];
        let current = new Date(start);
        let total = 0;
        while (current < end) {
            const dateStr = current.toISOString().split('T')[0];
            const { price, ruleName } = getPriceForDate(dateStr, property.priceBase, activeRules);
            nights.push({
                date: dateStr,
                price: price,
                ruleName: ruleName
            });
            total += price;
            current.setDate(current.getDate() + 1);
        }
        return {
            total,
            nightsCount: nights.length,
            nights,
            basePrice: property.priceBase
        };
    },
});
exports.getByCode = (0, server_1.query)({
    args: { code: values_1.v.string() },
    handler: async (ctx, args) => {
        const property = await ctx.db
            .query('properties')
            .withIndex('by_code', (q) => q.eq('code', args.code))
            .first();
        if (!property) {
            return null;
        }
        const images = await ctx.db
            .query('propertyImages')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const features = await ctx.db
            .query('propertyFeatures')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const enrichedFeatures = await Promise.all(features.map(async (f) => {
            if (f.iconId) {
                const icon = await ctx.db.get(f.iconId);
                return {
                    name: f.name,
                    iconId: f.iconId,
                    iconUrl: icon?.iconUrl ?? null,
                    emoji: icon?.emoji ?? null,
                    zone: f.zone,
                };
            }
            return {
                name: f.name,
                iconId: null,
                iconUrl: null,
                emoji: null,
                zone: f.zone,
            };
        }));
        const additionalCosts = await ctx.db
            .query('additionalCosts')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const pricing = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const sortedPricing = pricing.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return {
            ...property,
            images: sortedImages.map((img) => img.url),
            imageItems: sortedImages.map((img) => ({ id: img._id, url: img.url })),
            features: enrichedFeatures,
            featuredIcons: property.featuredIcons ?? [],
            additionalCosts,
            pricing: await Promise.all(sortedPricing.map(async (p) => {
                let globalData = null;
                if (p.globalRuleId) {
                    globalData = await ctx.db.get(p.globalRuleId);
                }
                let condicionesParsed;
                if (p.condiciones) {
                    try {
                        condicionesParsed = JSON.parse(p.condiciones);
                    }
                    catch {
                        condicionesParsed = undefined;
                    }
                }
                let reglasParsed;
                if (p.reglas) {
                    try {
                        reglasParsed = JSON.parse(p.reglas);
                    }
                    catch {
                        reglasParsed = undefined;
                    }
                }
                return {
                    id: p._id,
                    globalRuleId: p.globalRuleId,
                    nombre: globalData?.nombre || p.nombre,
                    fechaDesde: globalData?.fechaDesde || p.fechaDesde,
                    fechaHasta: globalData?.fechaHasta || p.fechaHasta,
                    fechas: globalData?.fechas || p.fechas,
                    valorUnico: p.valorUnico,
                    condiciones: condicionesParsed,
                    activa: (globalData?.activa !== false) && (p.activa ?? true),
                    reglas: reglasParsed,
                    order: p.order,
                    subReglasCapacidad: p.subReglasCapacidad,
                };
            })),
        };
    },
});
exports.getBySlug = (0, server_1.query)({
    args: { slug: values_1.v.string() },
    handler: async (ctx, args) => {
        let property = await ctx.db
            .query('properties')
            .withIndex('by_slug', (q) => q.eq('slug', args.slug))
            .first();
        if (!property) {
            property = await ctx.db
                .query('properties')
                .withIndex('by_code', (q) => q.eq('code', args.slug))
                .first();
        }
        if (!property) {
            return null;
        }
        const images = await ctx.db
            .query('propertyImages')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const features = await ctx.db
            .query('propertyFeatures')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const enrichedFeatures = await Promise.all(features.map(async (f) => {
            if (f.iconId) {
                const icon = await ctx.db.get(f.iconId);
                return {
                    name: f.name,
                    iconId: f.iconId,
                    iconUrl: icon?.iconUrl ?? null,
                    emoji: icon?.emoji ?? null,
                    zone: f.zone,
                };
            }
            return {
                name: f.name,
                iconId: null,
                iconUrl: null,
                emoji: null,
                zone: f.zone,
            };
        }));
        const additionalCosts = await ctx.db
            .query('additionalCosts')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const pricing = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
        const sortedPricing = pricing.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        const sortedImages = images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return {
            ...property,
            images: sortedImages.map((img) => img.url),
            imageItems: sortedImages.map((img) => ({ id: img._id, url: img.url })),
            features: enrichedFeatures,
            featuredIcons: property.featuredIcons ?? [],
            additionalCosts,
            pricing: await Promise.all(sortedPricing.map(async (p) => {
                let globalData = null;
                if (p.globalRuleId) {
                    globalData = await ctx.db.get(p.globalRuleId);
                }
                let condicionesParsed;
                if (p.condiciones) {
                    try {
                        condicionesParsed = JSON.parse(p.condiciones);
                    }
                    catch {
                        condicionesParsed = undefined;
                    }
                }
                let reglasParsed;
                if (p.reglas) {
                    try {
                        reglasParsed = JSON.parse(p.reglas);
                    }
                    catch {
                        reglasParsed = undefined;
                    }
                }
                return {
                    id: p._id,
                    globalRuleId: p.globalRuleId,
                    nombre: globalData?.nombre || p.nombre,
                    fechaDesde: globalData?.fechaDesde || p.fechaDesde,
                    fechaHasta: globalData?.fechaHasta || p.fechaHasta,
                    fechas: globalData?.fechas || p.fechas,
                    valorUnico: p.valorUnico,
                    condiciones: condicionesParsed,
                    activa: (globalData?.activa !== false) && (p.activa ?? true),
                    reglas: reglasParsed,
                    order: p.order,
                    subReglasCapacidad: p.subReglasCapacidad,
                };
            })),
        };
    },
});
exports.search = (0, server_1.query)({
    args: {
        query: values_1.v.string(),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 20;
        const input = args.query
            .toLowerCase()
            .replace(/[^\wáéíóúñ\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const words = input
            .split(' ')
            .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
        const searchTerms = words.length > 0 ? words : [input.slice(0, 50)];
        const allProperties = await ctx.db.query('properties').collect();
        const lower = (s) => s.toLowerCase();
        const matchesTerm = (p, term) => lower(p.title).includes(term) ||
            lower(p.description ?? '').includes(term) ||
            lower(p.location).includes(term) ||
            (p.code && lower(p.code).includes(term));
        const countMatches = (p) => searchTerms.filter((term) => matchesTerm(p, term)).length;
        const visibleProperties = allProperties.filter((p) => p.active !== false && p.visible !== false);
        const filtered = visibleProperties
            .filter((p) => searchTerms.some((term) => matchesTerm(p, term)))
            .sort((a, b) => countMatches(b) - countMatches(a))
            .slice(0, limit);
        const propertiesWithDetails = await Promise.all(filtered.map(async (property) => {
            const images = await ctx.db
                .query('propertyImages')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .first();
            return {
                ...property,
                image: images?.url,
            };
        }));
        return propertiesWithDetails;
    },
});
exports.searchAvailableByLocationAndDates = (0, server_1.query)({
    args: {
        location: values_1.v.string(),
        fechaEntrada: values_1.v.number(),
        fechaSalida: values_1.v.number(),
        limit: values_1.v.optional(values_1.v.number()),
        minCapacity: values_1.v.optional(values_1.v.number()),
        excludePropertyIds: values_1.v.optional(values_1.v.array(values_1.v.id('properties'))),
        sortByPrice: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 30;
        const locLower = args.location.trim().toLowerCase();
        if (!locLower)
            return [];
        const excludeSet = new Set(args.excludePropertyIds ?? []);
        const all = await ctx.db.query('properties').collect();
        let byLocation = all.filter((p) => p.active !== false &&
            p.visible !== false &&
            p.location.toLowerCase().includes(locLower) &&
            !excludeSet.has(p._id));
        if (args.minCapacity != null) {
            byLocation = byLocation.filter((p) => p.capacity >= args.minCapacity);
        }
        const available = [];
        for (const property of byLocation) {
            const overlapping = await ctx.db
                .query('propertyAvailability')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .filter((q) => q.and(q.lt(q.field('fechaEntrada'), args.fechaSalida), q.gt(q.field('fechaSalida'), args.fechaEntrada)))
                .first();
            if (!overlapping) {
                available.push(property);
            }
            if (available.length >= limit * 2)
                break;
        }
        if (args.sortByPrice) {
            available.sort((a, b) => a.priceBase - b.priceBase);
        }
        const filteredAvailable = available.slice(0, limit);
        const withDetails = await Promise.all(filteredAvailable.map(async (property) => {
            const image = await ctx.db
                .query('propertyImages')
                .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                .first();
            return {
                ...property,
                image: image?.url,
            };
        }));
        return withDetails;
    },
});
exports.getAllUniqueLocations = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const properties = await ctx.db
            .query('properties')
            .withIndex('by_createdAt')
            .collect();
        const filtered = properties.filter(p => p.active !== false && p.visible !== false);
        const locations = filtered.map(p => p.location.trim().toUpperCase());
        const unique = [...new Set(locations)]
            .map(loc => loc.charAt(0).toUpperCase() + loc.slice(1).toLowerCase())
            .sort();
        return unique;
    },
});
exports.getPropertyPricingRules = (0, server_1.query)({
    args: {
        propertyId: values_1.v.id('properties'),
    },
    handler: async (ctx, args) => {
        const rules = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .collect();
        return rules
            .filter((r) => r.activa !== false)
            .map((r) => ({
            nombre: r.nombre,
            fechaDesde: r.fechaDesde,
            fechaHasta: r.fechaHasta,
            fechas: r.fechas,
            valorUnico: r.valorUnico,
            condiciones: r.condiciones,
        }));
    },
});
exports.getPropertyAvailability = (0, server_1.query)({
    args: {
        propertyId: values_1.v.id('properties'),
        monthsAhead: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const months = args.monthsAhead ?? 3;
        const futureLimit = now + (months * 30 * 24 * 60 * 60 * 1000);
        const bookings = await ctx.db
            .query('propertyAvailability')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .filter((q) => q.gt(q.field('fechaSalida'), now))
            .collect();
        return bookings
            .filter(b => b.fechaEntrada < futureLimit)
            .sort((a, b) => a.fechaEntrada - b.fechaEntrada)
            .map(b => ({
            fechaEntrada: b.fechaEntrada,
            fechaSalida: b.fechaSalida,
            blocked: b.blocked,
            reason: b.reason || (b.bookingId ? "Reservada" : "Bloqueada"),
        }));
    },
});
exports.create = (0, server_1.mutation)({
    args: {
        title: values_1.v.string(),
        description: values_1.v.string(),
        location: values_1.v.string(),
        capacity: values_1.v.number(),
        lat: values_1.v.number(),
        lng: values_1.v.number(),
        priceBase: values_1.v.number(),
        priceBaja: values_1.v.number(),
        priceMedia: values_1.v.number(),
        priceAlta: values_1.v.number(),
        priceEspeciales: values_1.v.optional(values_1.v.number()),
        code: values_1.v.optional(values_1.v.string()),
        slug: values_1.v.optional(values_1.v.string()),
        category: values_1.v.optional(values_1.v.union(values_1.v.literal('ECONOMICA'), values_1.v.literal('ESTANDAR'), values_1.v.literal('PREMIUM'), values_1.v.literal('LUJO'), values_1.v.literal('ECOTURISMO'), values_1.v.literal('CON_PISCINA'), values_1.v.literal('CERCA_BOGOTA'), values_1.v.literal('GRUPOS_GRANDES'), values_1.v.literal('VIP'))),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal('FINCA'), values_1.v.literal('CASA_CAMPESTRE'), values_1.v.literal('VILLA'), values_1.v.literal('HACIENDA'), values_1.v.literal('QUINTA'), values_1.v.literal('APARTAMENTO'), values_1.v.literal('CASA'), values_1.v.literal('CASA_PRIVADA'), values_1.v.literal('CASA_EN_CONJUNTO_CERRADO'), values_1.v.literal('VILLA_PRIVADA'), values_1.v.literal('CONDOMINIO'), values_1.v.literal('YATE'), values_1.v.literal('ISLA'), values_1.v.literal('GLAMPING'))),
        rating: values_1.v.optional(values_1.v.number()),
        images: values_1.v.optional(values_1.v.array(values_1.v.string())),
        features: values_1.v.optional(values_1.v.array(values_1.v.object({
            name: values_1.v.string(),
            iconId: values_1.v.optional(values_1.v.id('iconography')),
            zone: values_1.v.optional(values_1.v.string()),
        }))),
        video: values_1.v.optional(values_1.v.string()),
        contractTemplateUrl: values_1.v.optional(values_1.v.string()),
        pricing: values_1.v.optional(values_1.v.array(values_1.v.object({
            nombre: values_1.v.string(),
            fechaDesde: values_1.v.optional(values_1.v.string()),
            fechaHasta: values_1.v.optional(values_1.v.string()),
            fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
            valorUnico: values_1.v.optional(values_1.v.number()),
            globalRuleId: values_1.v.optional(values_1.v.id('globalPricing')),
            condiciones: values_1.v.optional(values_1.v.string()),
            activa: values_1.v.optional(values_1.v.boolean()),
            reglas: values_1.v.optional(values_1.v.string()),
            order: values_1.v.optional(values_1.v.number()),
        }))),
        catalogIds: values_1.v.optional(values_1.v.array(values_1.v.string())),
        active: values_1.v.optional(values_1.v.boolean()),
        visible: values_1.v.optional(values_1.v.boolean()),
        reservable: values_1.v.optional(values_1.v.boolean()),
        isFavorite: values_1.v.optional(values_1.v.boolean()),
        priceOriginal: values_1.v.optional(values_1.v.number()),
        featuredIcons: values_1.v.optional(values_1.v.array(values_1.v.id('iconography'))),
        zoneOrder: values_1.v.optional(values_1.v.array(values_1.v.string())),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        if (args.code) {
            const existingByCode = await ctx.db
                .query('properties')
                .withIndex('by_code', (q) => q.eq('code', args.code))
                .first();
            if (existingByCode) {
                throw new Error(`Ya existe una finca con el código "${args.code}". El código debe ser único.`);
            }
        }
        const propertyId = await ctx.db.insert('properties', {
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
            slug: args.slug || slugify(args.title),
            category: args.category ?? 'ESTANDAR',
            type: args.type ?? 'FINCA',
            rating: args.rating ?? 0,
            reviewsCount: 0,
            video: args.video,
            active: args.active ?? true,
            visible: args.visible ?? true,
            reservable: args.reservable ?? true,
            isFavorite: args.isFavorite ?? false,
            contractTemplateUrl: args.contractTemplateUrl,
            priceOriginal: args.priceOriginal,
            featuredIcons: args.featuredIcons,
            zoneOrder: args.zoneOrder,
            createdAt: now,
            updatedAt: now,
        });
        if (args.images && args.images.length > 0) {
            await Promise.all(args.images.map((url, index) => ctx.db.insert('propertyImages', {
                propertyId,
                url,
                order: index,
            })));
        }
        if (args.features && args.features.length > 0) {
            await Promise.all(args.features.map((f) => {
                return ctx.db.insert('propertyFeatures', {
                    propertyId,
                    name: f.name,
                    iconId: f.iconId,
                    zone: f.zone,
                });
            }));
        }
        if (args.pricing && args.pricing.length > 0) {
            await Promise.all(args.pricing.map((p, index) => ctx.db.insert('propertyPricing', {
                propertyId,
                nombre: p.nombre,
                fechaDesde: p.fechaDesde,
                fechaHasta: p.fechaHasta,
                fechas: p.fechas,
                globalRuleId: p.globalRuleId,
                valorUnico: p.valorUnico,
                condiciones: p.condiciones,
                activa: p.activa ?? true,
                reglas: p.reglas,
                order: p.order ?? index,
                createdAt: now,
                updatedAt: now,
            })));
        }
        if (args.catalogIds && args.catalogIds.length > 0) {
            const allCatalogs = await ctx.db.query('whatsappCatalogs').collect();
            for (const rawId of args.catalogIds) {
                const catalog = allCatalogs.find((c) => c._id === rawId || c.whatsappCatalogId === rawId);
                if (!catalog)
                    continue;
                await ctx.db.insert('propertyWhatsAppCatalog', {
                    propertyId,
                    catalogId: catalog._id,
                    productRetailerId: propertyId,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }
        return propertyId;
    },
});
exports.update = (0, server_1.mutation)({
    args: {
        id: values_1.v.id('properties'),
        featuredIcons: values_1.v.optional(values_1.v.array(values_1.v.id('iconography'))),
        title: values_1.v.optional(values_1.v.string()),
        description: values_1.v.optional(values_1.v.string()),
        location: values_1.v.optional(values_1.v.string()),
        capacity: values_1.v.optional(values_1.v.number()),
        lat: values_1.v.optional(values_1.v.number()),
        lng: values_1.v.optional(values_1.v.number()),
        priceBase: values_1.v.optional(values_1.v.number()),
        priceBaja: values_1.v.optional(values_1.v.number()),
        priceMedia: values_1.v.optional(values_1.v.number()),
        priceAlta: values_1.v.optional(values_1.v.number()),
        priceEspeciales: values_1.v.optional(values_1.v.number()),
        code: values_1.v.optional(values_1.v.string()),
        category: values_1.v.optional(values_1.v.union(values_1.v.literal('ECONOMICA'), values_1.v.literal('ESTANDAR'), values_1.v.literal('PREMIUM'), values_1.v.literal('LUJO'), values_1.v.literal('ECOTURISMO'), values_1.v.literal('CON_PISCINA'), values_1.v.literal('CERCA_BOGOTA'), values_1.v.literal('GRUPOS_GRANDES'), values_1.v.literal('VIP'))),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal('FINCA'), values_1.v.literal('CASA_CAMPESTRE'), values_1.v.literal('VILLA'), values_1.v.literal('HACIENDA'), values_1.v.literal('QUINTA'), values_1.v.literal('APARTAMENTO'), values_1.v.literal('CASA'), values_1.v.literal('CASA_PRIVADA'), values_1.v.literal('CASA_EN_CONJUNTO_CERRADO'), values_1.v.literal('VILLA_PRIVADA'), values_1.v.literal('CONDOMINIO'), values_1.v.literal('YATE'), values_1.v.literal('ISLA'), values_1.v.literal('GLAMPING'))),
        rating: values_1.v.optional(values_1.v.number()),
        video: values_1.v.optional(values_1.v.string()),
        contractTemplateUrl: values_1.v.optional(values_1.v.string()),
        active: values_1.v.optional(values_1.v.boolean()),
        visible: values_1.v.optional(values_1.v.boolean()),
        reservable: values_1.v.optional(values_1.v.boolean()),
        isFavorite: values_1.v.optional(values_1.v.boolean()),
        priceOriginal: values_1.v.optional(values_1.v.number()),
        features: values_1.v.optional(values_1.v.array(values_1.v.object({
            name: values_1.v.string(),
            iconId: values_1.v.optional(values_1.v.id('iconography')),
            zone: values_1.v.optional(values_1.v.string()),
        }))),
        catalogIds: values_1.v.optional(values_1.v.array(values_1.v.string())),
        slug: values_1.v.optional(values_1.v.string()),
        zoneOrder: values_1.v.optional(values_1.v.array(values_1.v.string())),
        pricing: values_1.v.optional(values_1.v.array(values_1.v.object({
            nombre: values_1.v.string(),
            fechaDesde: values_1.v.optional(values_1.v.string()),
            fechaHasta: values_1.v.optional(values_1.v.string()),
            fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
            globalRuleId: values_1.v.optional(values_1.v.id('globalPricing')),
            valorUnico: values_1.v.optional(values_1.v.number()),
            condiciones: values_1.v.optional(values_1.v.string()),
            activa: values_1.v.optional(values_1.v.boolean()),
            reglas: values_1.v.optional(values_1.v.string()),
            order: values_1.v.optional(values_1.v.number()),
            subReglasCapacidad: values_1.v.optional(values_1.v.array(values_1.v.object({
                capacidadMin: values_1.v.number(),
                capacidadMax: values_1.v.number(),
                valorUnico: values_1.v.number(),
            }))),
        }))),
    },
    handler: async (ctx, args) => {
        const { id, features, catalogIds, featuredIcons, pricing, ...updates } = args;
        const property = await ctx.db.get(id);
        if (!property) {
            throw new Error('Propiedad no encontrada');
        }
        await ctx.db.patch(id, {
            ...updates,
            ...(updates.title !== undefined && updates.slug === undefined ? { slug: slugify(updates.title) } : {}),
            ...(featuredIcons !== undefined ? { featuredIcons } : {}),
            updatedAt: Date.now(),
        });
        if (features !== undefined) {
            const existingFeatures = await ctx.db
                .query('propertyFeatures')
                .withIndex('by_property', (q) => q.eq('propertyId', id))
                .collect();
            for (const ef of existingFeatures) {
                await ctx.db.delete(ef._id);
            }
            if (features.length > 0) {
                await Promise.all(features.map((f) => {
                    return ctx.db.insert('propertyFeatures', {
                        propertyId: id,
                        name: f.name,
                        iconId: f.iconId,
                        zone: f.zone,
                    });
                }));
            }
        }
        if (pricing !== undefined) {
            const existingPricing = await ctx.db
                .query('propertyPricing')
                .withIndex('by_property', (q) => q.eq('propertyId', id))
                .collect();
            for (const ep of existingPricing) {
                await ctx.db.delete(ep._id);
            }
            const now = Date.now();
            if (pricing.length > 0) {
                await Promise.all(pricing.map((p, index) => ctx.db.insert('propertyPricing', {
                    propertyId: id,
                    nombre: p.nombre,
                    fechaDesde: p.fechaDesde,
                    fechaHasta: p.fechaHasta,
                    fechas: p.fechas,
                    globalRuleId: p.globalRuleId,
                    valorUnico: p.valorUnico,
                    condiciones: p.condiciones,
                    activa: p.activa ?? true,
                    reglas: p.reglas,
                    order: p.order ?? index,
                    createdAt: now,
                    updatedAt: now,
                })));
            }
        }
        if (catalogIds !== undefined) {
            const existingLnks = await ctx.db
                .query('propertyWhatsAppCatalog')
                .withIndex('by_property', (q) => q.eq('propertyId', id))
                .collect();
            for (const lnk of existingLnks) {
                await ctx.db.delete(lnk._id);
            }
            if (catalogIds.length > 0) {
                const allCatalogs = await ctx.db.query('whatsappCatalogs').collect();
                const now = Date.now();
                for (const rawId of catalogIds) {
                    const catalog = allCatalogs.find((c) => c._id === rawId || c.whatsappCatalogId === rawId);
                    if (!catalog)
                        continue;
                    await ctx.db.insert('propertyWhatsAppCatalog', {
                        propertyId: id,
                        catalogId: catalog._id,
                        productRetailerId: id,
                        createdAt: now,
                        updatedAt: now,
                    });
                }
            }
        }
        await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.syncPropertyToAllCatalogs, {
            propertyId: id,
        });
        return id;
    },
});
exports.setPricing = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        pricing: values_1.v.array(values_1.v.object({
            nombre: values_1.v.string(),
            fechaDesde: values_1.v.optional(values_1.v.string()),
            fechaHasta: values_1.v.optional(values_1.v.string()),
            fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
            globalRuleId: values_1.v.optional(values_1.v.id('globalPricing')),
            valorUnico: values_1.v.optional(values_1.v.number()),
            condiciones: values_1.v.optional(values_1.v.string()),
            activa: values_1.v.optional(values_1.v.boolean()),
            reglas: values_1.v.optional(values_1.v.string()),
            order: values_1.v.optional(values_1.v.number()),
            subReglasCapacidad: values_1.v.optional(values_1.v.array(values_1.v.object({
                capacidadMin: values_1.v.number(),
                capacidadMax: values_1.v.number(),
                valorUnico: values_1.v.number(),
            }))),
        })),
    },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.propertyId);
        if (!property) {
            throw new Error('Propiedad no encontrada');
        }
        const existing = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .collect();
        for (const p of existing) {
            await ctx.db.delete(p._id);
        }
        const now = Date.now();
        for (let i = 0; i < args.pricing.length; i++) {
            const p = args.pricing[i];
            await ctx.db.insert('propertyPricing', {
                propertyId: args.propertyId,
                nombre: p.nombre,
                fechaDesde: p.fechaDesde,
                fechaHasta: p.fechaHasta,
                fechas: p.fechas,
                globalRuleId: p.globalRuleId,
                valorUnico: p.valorUnico,
                condiciones: p.condiciones,
                activa: p.activa ?? true,
                reglas: p.reglas,
                order: p.order ?? i,
                subReglasCapacidad: p.subReglasCapacidad,
                createdAt: now,
                updatedAt: now,
            });
        }
        return { success: true };
    },
});
exports.addTemporada = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        nombre: values_1.v.string(),
        fechaDesde: values_1.v.optional(values_1.v.string()),
        fechaHasta: values_1.v.optional(values_1.v.string()),
        fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
        globalRuleId: values_1.v.optional(values_1.v.id('globalPricing')),
        valorUnico: values_1.v.optional(values_1.v.number()),
        condiciones: values_1.v.optional(values_1.v.string()),
        activa: values_1.v.optional(values_1.v.boolean()),
        reglas: values_1.v.optional(values_1.v.string()),
        order: values_1.v.optional(values_1.v.number()),
        subReglasCapacidad: values_1.v.optional(values_1.v.array(values_1.v.object({
            capacidadMin: values_1.v.number(),
            capacidadMax: values_1.v.number(),
            valorUnico: values_1.v.number(),
        }))),
    },
    handler: async (ctx, args) => {
        const { propertyId, ...rest } = args;
        const property = await ctx.db.get(propertyId);
        if (!property) {
            throw new Error('Propiedad no encontrada');
        }
        const existing = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
            .collect();
        const nextOrder = args.order ?? existing.length;
        const now = Date.now();
        const id = await ctx.db.insert('propertyPricing', {
            propertyId,
            ...rest,
            activa: args.activa ?? true,
            order: nextOrder,
            createdAt: now,
            updatedAt: now,
        });
        return id;
    },
});
exports.updateTemporada = (0, server_1.mutation)({
    args: {
        pricingId: values_1.v.id('propertyPricing'),
        nombre: values_1.v.optional(values_1.v.string()),
        fechaDesde: values_1.v.optional(values_1.v.string()),
        fechaHasta: values_1.v.optional(values_1.v.string()),
        fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
        globalRuleId: values_1.v.optional(values_1.v.id('globalPricing')),
        valorUnico: values_1.v.optional(values_1.v.number()),
        condiciones: values_1.v.optional(values_1.v.string()),
        activa: values_1.v.optional(values_1.v.boolean()),
        reglas: values_1.v.optional(values_1.v.string()),
        order: values_1.v.optional(values_1.v.number()),
        subReglasCapacidad: values_1.v.optional(values_1.v.array(values_1.v.object({
            capacidadMin: values_1.v.number(),
            capacidadMax: values_1.v.number(),
            valorUnico: values_1.v.number(),
        }))),
    },
    handler: async (ctx, args) => {
        const { pricingId, ...updates } = args;
        const row = await ctx.db.get(pricingId);
        if (!row) {
            throw new Error('Temporada no encontrada');
        }
        await ctx.db.patch(pricingId, {
            ...updates,
            updatedAt: Date.now(),
        });
        return pricingId;
    },
});
exports.removeTemporada = (0, server_1.mutation)({
    args: { pricingId: values_1.v.id('propertyPricing') },
    handler: async (ctx, args) => {
        const row = await ctx.db.get(args.pricingId);
        if (!row) {
            throw new Error('Temporada no encontrada');
        }
        await ctx.db.delete(args.pricingId);
        return { success: true };
    },
});
exports.remove = (0, server_1.mutation)({
    args: { id: values_1.v.id('properties') },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.id);
        if (!property) {
            throw new Error('Propiedad no encontrada');
        }
        const catalogLinks = await ctx.db
            .query('propertyWhatsAppCatalog')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        const metaItems = [];
        for (const link of catalogLinks) {
            const catalog = await ctx.db.get(link.catalogId);
            if (catalog) {
                metaItems.push({
                    whatsappCatalogId: catalog.whatsappCatalogId,
                    retailer_id: link.productRetailerId,
                });
            }
        }
        for (const link of catalogLinks) {
            await ctx.db.delete(link._id);
        }
        const images = await ctx.db
            .query('propertyImages')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        await Promise.all(images.map((img) => ctx.db.delete(img._id)));
        const features = await ctx.db
            .query('propertyFeatures')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        await Promise.all(features.map((f) => ctx.db.delete(f._id)));
        const additionalCosts = await ctx.db
            .query('additionalCosts')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        await Promise.all(additionalCosts.map((cost) => ctx.db.delete(cost._id)));
        const pricing = await ctx.db
            .query('propertyPricing')
            .withIndex('by_property', (q) => q.eq('propertyId', args.id))
            .collect();
        await Promise.all(pricing.map((p) => ctx.db.delete(p._id)));
        await ctx.db.delete(args.id);
        if (metaItems.length > 0) {
            await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.deleteFromMetaCatalogs, {
                items: metaItems,
            });
        }
        return { success: true };
    },
});
exports.addImage = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        url: values_1.v.string(),
        order: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const imageId = await ctx.db.insert('propertyImages', {
            propertyId: args.propertyId,
            url: args.url,
            order: args.order ?? 0,
        });
        return imageId;
    },
});
exports.getImageById = (0, server_1.query)({
    args: { imageId: values_1.v.id('propertyImages') },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.imageId);
    },
});
exports.removeImage = (0, server_1.mutation)({
    args: { imageId: values_1.v.id('propertyImages') },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.imageId);
        return { success: true };
    },
});
exports.addFeature = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        name: values_1.v.string(),
        iconId: values_1.v.optional(values_1.v.id('iconography')),
        zone: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const featureId = await ctx.db.insert('propertyFeatures', {
            propertyId: args.propertyId,
            name: args.name,
            iconId: args.iconId,
            zone: args.zone,
        });
        return featureId;
    },
});
exports.unlinkFeature = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        name: values_1.v.optional(values_1.v.string()),
        iconId: values_1.v.optional(values_1.v.id('iconography')),
    },
    handler: async (ctx, args) => {
        const property = await ctx.db.get(args.propertyId);
        if (!property)
            throw new Error('Propiedad no encontrada');
        let targetName = args.name;
        if (!targetName && args.iconId) {
            const iconEntry = await ctx.db.get(args.iconId);
            if (iconEntry)
                targetName = iconEntry.name;
        }
        const records = await ctx.db
            .query('propertyFeatures')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .collect();
        let deletedCount = 0;
        for (const r of records) {
            let shouldDelete = false;
            if (args.iconId && r.iconId === args.iconId) {
                shouldDelete = true;
            }
            else if (targetName &&
                r.name &&
                r.name.toLowerCase() === targetName.toLowerCase()) {
                shouldDelete = true;
            }
            if (shouldDelete) {
                await ctx.db.delete(r._id);
                deletedCount++;
            }
        }
        return { success: true, count: deletedCount };
    },
});
exports.removeFeature = (0, server_1.mutation)({
    args: { featureId: values_1.v.id('propertyFeatures') },
    handler: async (ctx, args) => {
        return { success: true };
    },
});
exports.updateImageOrder = (0, server_1.mutation)({
    args: {
        imageOrders: values_1.v.array(values_1.v.object({
            id: values_1.v.id('propertyImages'),
            order: values_1.v.number(),
        })),
    },
    handler: async (ctx, args) => {
        await Promise.all(args.imageOrders.map(({ id, order }) => ctx.db.patch(id, { order })));
        return { success: true };
    },
});
exports.getTabOrders = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query('tabOrders').collect();
    },
});
exports.getTabOrder = (0, server_1.query)({
    args: { tabId: values_1.v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query('tabOrders')
            .withIndex('by_tab', (q) => q.eq('tabId', args.tabId))
            .unique();
    },
});
exports.updateTabOrder = (0, server_1.mutation)({
    args: {
        tabId: values_1.v.string(),
        propertyIds: values_1.v.array(values_1.v.id('properties')),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query('tabOrders')
            .withIndex('by_tab', (q) => q.eq('tabId', args.tabId))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                propertyIds: args.propertyIds,
                updatedAt: Date.now(),
            });
            return existing._id;
        }
        else {
            const id = await ctx.db.insert('tabOrders', {
                tabId: args.tabId,
                propertyIds: args.propertyIds,
                updatedAt: Date.now(),
            });
            return id;
        }
    },
});
//# sourceMappingURL=fincas.js.map