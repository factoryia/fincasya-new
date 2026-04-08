export declare const list: import("convex/server").RegisteredQuery<"public", {
    type?: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "YATE" | "ISLA" | "GLAMPING";
    limit?: number;
    location?: string;
    category?: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    isFavorite?: boolean;
    cursor?: import("convex/values").GenericId<"properties">;
    minCapacity?: number;
    maxPrice?: number;
    all?: boolean;
}, Promise<{
    properties: {
        active: boolean;
        visible: boolean;
        reservable: boolean;
        images: string[];
        features: {
            name: string;
            iconId: import("convex/values").GenericId<"iconography">;
            iconUrl: string;
            emoji: string;
        }[];
        featuredIcons: import("convex/values").GenericId<"iconography">[];
        pricing: {
            id: import("convex/values").GenericId<"propertyPricing">;
            globalRuleId: import("convex/values").GenericId<"globalPricing">;
            nombre: any;
            fechaDesde: any;
            fechaHasta: any;
            fechas: any;
            valorUnico: number;
            condiciones: unknown;
            activa: boolean;
            reglas: unknown;
            order: number;
            subReglasCapacidad: {
                valorUnico: number;
                capacidadMin: number;
                capacidadMax: number;
            }[];
        }[];
        metaCatalogs: {
            catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
            productRetailerId: string;
            whatsappCatalogId: string;
            catalogName: string;
        }[];
        _id: import("convex/values").GenericId<"properties">;
        _creationTime: number;
        code?: string;
        rating?: number;
        priceEspeciales?: number;
        isFavorite?: boolean;
        priceOriginal?: number;
        video?: string;
        contractTemplateUrl?: string;
        zoneOrder?: string[];
        slug?: string;
        reviewsCount?: number;
        priceRawBase?: string;
        priceRawBaja?: string;
        priceRawMedia?: string;
        priceRawAlta?: string;
        priceRawEspeciales?: string;
        type: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "CASA_BOUTIQUE" | "YATE" | "ISLA" | "GLAMPING";
        title: string;
        description: string;
        location: string;
        capacity: number;
        lat: number;
        lng: number;
        priceBase: number;
        priceBaja: number;
        priceMedia: number;
        priceAlta: number;
        category: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
        createdAt: number;
        updatedAt: number;
    }[];
    hasMore: boolean;
    nextCursor: import("convex/values").GenericId<"properties">;
}>>;
export declare const getById: import("convex/server").RegisteredQuery<"public", {
    id: import("convex/values").GenericId<"properties">;
}, Promise<{
    images: string[];
    imageItems: {
        id: import("convex/values").GenericId<"propertyImages">;
        url: string;
    }[];
    features: {
        name: string;
        iconId: import("convex/values").GenericId<"iconography">;
        iconUrl: string;
        emoji: string;
        zone: string;
    }[];
    featuredIcons: import("convex/values").GenericId<"iconography">[];
    additionalCosts: {
        _id: import("convex/values").GenericId<"additionalCosts">;
        _creationTime: number;
        description?: string;
        required?: boolean;
        name: string;
        type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
        propertyId: import("convex/values").GenericId<"properties">;
        amount: number;
    }[];
    pricing: {
        id: import("convex/values").GenericId<"propertyPricing">;
        globalRuleId: import("convex/values").GenericId<"globalPricing">;
        nombre: any;
        fechaDesde: any;
        fechaHasta: any;
        fechas: any;
        valorUnico: number;
        condiciones: unknown;
        activa: boolean;
        reglas: unknown;
        order: number;
        subReglasCapacidad: {
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }[];
    }[];
    _id: import("convex/values").GenericId<"properties">;
    _creationTime: number;
    code?: string;
    rating?: number;
    priceEspeciales?: number;
    active?: boolean;
    visible?: boolean;
    reservable?: boolean;
    isFavorite?: boolean;
    priceOriginal?: number;
    video?: string;
    contractTemplateUrl?: string;
    zoneOrder?: string[];
    slug?: string;
    reviewsCount?: number;
    priceRawBase?: string;
    priceRawBaja?: string;
    priceRawMedia?: string;
    priceRawAlta?: string;
    priceRawEspeciales?: string;
    type: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "CASA_BOUTIQUE" | "YATE" | "ISLA" | "GLAMPING";
    title: string;
    description: string;
    location: string;
    capacity: number;
    lat: number;
    lng: number;
    priceBase: number;
    priceBaja: number;
    priceMedia: number;
    priceAlta: number;
    category: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    createdAt: number;
    updatedAt: number;
}>>;
export declare const calculateSuggestedPrice: import("convex/server").RegisteredQuery<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
    checkInDate: string;
}, Promise<any>>;
export declare const findBySearchTerm: import("convex/server").RegisteredQuery<"public", {
    term: string;
}, Promise<any>>;
export declare const getPropertyImage: import("convex/server").RegisteredQuery<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    _id: import("convex/values").GenericId<"propertyImages">;
    _creationTime: number;
    order?: number;
    url: string;
    propertyId: import("convex/values").GenericId<"properties">;
}>>;
export declare const calculateStayPrice: import("convex/server").RegisteredQuery<"public", {
    numeroPersonas?: number;
    fechaEntrada: string;
    fechaSalida: string;
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    total: number;
    nights: any[];
    nightsCount?: undefined;
    basePrice?: undefined;
} | {
    total: number;
    nightsCount: number;
    nights: any[];
    basePrice: number;
}>>;
export declare const getByCode: import("convex/server").RegisteredQuery<"public", {
    code: string;
}, Promise<{
    images: string[];
    imageItems: {
        id: import("convex/values").GenericId<"propertyImages">;
        url: string;
    }[];
    features: {
        name: string;
        iconId: import("convex/values").GenericId<"iconography">;
        iconUrl: string;
        emoji: string;
        zone: string;
    }[];
    featuredIcons: import("convex/values").GenericId<"iconography">[];
    additionalCosts: {
        _id: import("convex/values").GenericId<"additionalCosts">;
        _creationTime: number;
        description?: string;
        required?: boolean;
        name: string;
        type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
        propertyId: import("convex/values").GenericId<"properties">;
        amount: number;
    }[];
    pricing: {
        id: import("convex/values").GenericId<"propertyPricing">;
        globalRuleId: import("convex/values").GenericId<"globalPricing">;
        nombre: any;
        fechaDesde: any;
        fechaHasta: any;
        fechas: any;
        valorUnico: number;
        condiciones: unknown;
        activa: boolean;
        reglas: unknown;
        order: number;
        subReglasCapacidad: {
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }[];
    }[];
    _id: import("convex/values").GenericId<"properties">;
    _creationTime: number;
    code?: string;
    rating?: number;
    priceEspeciales?: number;
    active?: boolean;
    visible?: boolean;
    reservable?: boolean;
    isFavorite?: boolean;
    priceOriginal?: number;
    video?: string;
    contractTemplateUrl?: string;
    zoneOrder?: string[];
    slug?: string;
    reviewsCount?: number;
    priceRawBase?: string;
    priceRawBaja?: string;
    priceRawMedia?: string;
    priceRawAlta?: string;
    priceRawEspeciales?: string;
    type: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "CASA_BOUTIQUE" | "YATE" | "ISLA" | "GLAMPING";
    title: string;
    description: string;
    location: string;
    capacity: number;
    lat: number;
    lng: number;
    priceBase: number;
    priceBaja: number;
    priceMedia: number;
    priceAlta: number;
    category: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    createdAt: number;
    updatedAt: number;
}>>;
export declare const getBySlug: import("convex/server").RegisteredQuery<"public", {
    slug: string;
}, Promise<{
    images: string[];
    imageItems: {
        id: import("convex/values").GenericId<"propertyImages">;
        url: string;
    }[];
    features: {
        name: string;
        iconId: import("convex/values").GenericId<"iconography">;
        iconUrl: string;
        emoji: string;
        zone: string;
    }[];
    featuredIcons: import("convex/values").GenericId<"iconography">[];
    additionalCosts: {
        _id: import("convex/values").GenericId<"additionalCosts">;
        _creationTime: number;
        description?: string;
        required?: boolean;
        name: string;
        type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
        propertyId: import("convex/values").GenericId<"properties">;
        amount: number;
    }[];
    pricing: {
        id: import("convex/values").GenericId<"propertyPricing">;
        globalRuleId: import("convex/values").GenericId<"globalPricing">;
        nombre: any;
        fechaDesde: any;
        fechaHasta: any;
        fechas: any;
        valorUnico: number;
        condiciones: unknown;
        activa: boolean;
        reglas: unknown;
        order: number;
        subReglasCapacidad: {
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }[];
    }[];
    _id: import("convex/values").GenericId<"properties">;
    _creationTime: number;
    code?: string;
    rating?: number;
    priceEspeciales?: number;
    active?: boolean;
    visible?: boolean;
    reservable?: boolean;
    isFavorite?: boolean;
    priceOriginal?: number;
    video?: string;
    contractTemplateUrl?: string;
    zoneOrder?: string[];
    slug?: string;
    reviewsCount?: number;
    priceRawBase?: string;
    priceRawBaja?: string;
    priceRawMedia?: string;
    priceRawAlta?: string;
    priceRawEspeciales?: string;
    type: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "CASA_BOUTIQUE" | "YATE" | "ISLA" | "GLAMPING";
    title: string;
    description: string;
    location: string;
    capacity: number;
    lat: number;
    lng: number;
    priceBase: number;
    priceBaja: number;
    priceMedia: number;
    priceAlta: number;
    category: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    createdAt: number;
    updatedAt: number;
}>>;
export declare const search: import("convex/server").RegisteredQuery<"public", {
    limit?: number;
    query: string;
}, Promise<{
    image: string;
    _id: import("convex/values").GenericId<"properties">;
    _creationTime: number;
    code?: string;
    rating?: number;
    priceEspeciales?: number;
    active?: boolean;
    visible?: boolean;
    reservable?: boolean;
    isFavorite?: boolean;
    priceOriginal?: number;
    video?: string;
    contractTemplateUrl?: string;
    featuredIcons?: import("convex/values").GenericId<"iconography">[];
    zoneOrder?: string[];
    slug?: string;
    reviewsCount?: number;
    priceRawBase?: string;
    priceRawBaja?: string;
    priceRawMedia?: string;
    priceRawAlta?: string;
    priceRawEspeciales?: string;
    type: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "CASA_BOUTIQUE" | "YATE" | "ISLA" | "GLAMPING";
    title: string;
    description: string;
    location: string;
    capacity: number;
    lat: number;
    lng: number;
    priceBase: number;
    priceBaja: number;
    priceMedia: number;
    priceAlta: number;
    category: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    createdAt: number;
    updatedAt: number;
}[]>>;
export declare const searchAvailableByLocationAndDates: import("convex/server").RegisteredQuery<"public", {
    limit?: number;
    minCapacity?: number;
    sortByPrice?: boolean;
    excludePropertyIds?: import("convex/values").GenericId<"properties">[];
    fechaEntrada: number;
    fechaSalida: number;
    location: string;
}, Promise<any[]>>;
export declare const getAllUniqueLocations: import("convex/server").RegisteredQuery<"public", {}, Promise<string[]>>;
export declare const getPropertyPricingRules: import("convex/server").RegisteredQuery<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    nombre: string;
    fechaDesde: string;
    fechaHasta: string;
    fechas: string[];
    valorUnico: number;
    condiciones: string;
}[]>>;
export declare const getPropertyAvailability: import("convex/server").RegisteredQuery<"public", {
    monthsAhead?: number;
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    fechaEntrada: number;
    fechaSalida: number;
    blocked: boolean;
    reason: string;
}[]>>;
export declare const create: import("convex/server").RegisteredMutation<"public", {
    images?: string[];
    code?: string;
    type?: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "YATE" | "ISLA" | "GLAMPING";
    features?: {
        iconId?: import("convex/values").GenericId<"iconography">;
        zone?: string;
        name: string;
    }[];
    rating?: number;
    priceEspeciales?: number;
    category?: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    active?: boolean;
    visible?: boolean;
    reservable?: boolean;
    isFavorite?: boolean;
    priceOriginal?: number;
    video?: string;
    contractTemplateUrl?: string;
    catalogIds?: string[];
    pricing?: {
        fechaDesde?: string;
        fechaHasta?: string;
        fechas?: string[];
        globalRuleId?: import("convex/values").GenericId<"globalPricing">;
        valorUnico?: number;
        condiciones?: string;
        activa?: boolean;
        reglas?: string;
        order?: number;
        nombre: string;
    }[];
    featuredIcons?: import("convex/values").GenericId<"iconography">[];
    zoneOrder?: string[];
    slug?: string;
    title: string;
    description: string;
    location: string;
    capacity: number;
    lat: number;
    lng: number;
    priceBase: number;
    priceBaja: number;
    priceMedia: number;
    priceAlta: number;
}, Promise<import("convex/values").GenericId<"properties">>>;
export declare const update: import("convex/server").RegisteredMutation<"public", {
    code?: string;
    type?: "FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "YATE" | "ISLA" | "GLAMPING";
    features?: {
        iconId?: import("convex/values").GenericId<"iconography">;
        zone?: string;
        name: string;
    }[];
    title?: string;
    description?: string;
    location?: string;
    capacity?: number;
    rating?: number;
    lat?: number;
    lng?: number;
    priceBase?: number;
    priceBaja?: number;
    priceMedia?: number;
    priceAlta?: number;
    priceEspeciales?: number;
    category?: "ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP";
    active?: boolean;
    visible?: boolean;
    reservable?: boolean;
    isFavorite?: boolean;
    priceOriginal?: number;
    video?: string;
    contractTemplateUrl?: string;
    catalogIds?: string[];
    pricing?: {
        fechaDesde?: string;
        fechaHasta?: string;
        fechas?: string[];
        globalRuleId?: import("convex/values").GenericId<"globalPricing">;
        valorUnico?: number;
        condiciones?: string;
        activa?: boolean;
        reglas?: string;
        order?: number;
        subReglasCapacidad?: {
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }[];
        nombre: string;
    }[];
    featuredIcons?: import("convex/values").GenericId<"iconography">[];
    zoneOrder?: string[];
    slug?: string;
    id: import("convex/values").GenericId<"properties">;
}, Promise<import("convex/values").GenericId<"properties">>>;
export declare const setPricing: import("convex/server").RegisteredMutation<"public", {
    propertyId: import("convex/values").GenericId<"properties">;
    pricing: {
        fechaDesde?: string;
        fechaHasta?: string;
        fechas?: string[];
        globalRuleId?: import("convex/values").GenericId<"globalPricing">;
        valorUnico?: number;
        condiciones?: string;
        activa?: boolean;
        reglas?: string;
        order?: number;
        subReglasCapacidad?: {
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }[];
        nombre: string;
    }[];
}, Promise<{
    success: boolean;
}>>;
export declare const addTemporada: import("convex/server").RegisteredMutation<"public", {
    fechaDesde?: string;
    fechaHasta?: string;
    fechas?: string[];
    globalRuleId?: import("convex/values").GenericId<"globalPricing">;
    valorUnico?: number;
    condiciones?: string;
    activa?: boolean;
    reglas?: string;
    order?: number;
    subReglasCapacidad?: {
        valorUnico: number;
        capacidadMin: number;
        capacidadMax: number;
    }[];
    propertyId: import("convex/values").GenericId<"properties">;
    nombre: string;
}, Promise<import("convex/values").GenericId<"propertyPricing">>>;
export declare const updateTemporada: import("convex/server").RegisteredMutation<"public", {
    nombre?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    fechas?: string[];
    globalRuleId?: import("convex/values").GenericId<"globalPricing">;
    valorUnico?: number;
    condiciones?: string;
    activa?: boolean;
    reglas?: string;
    order?: number;
    subReglasCapacidad?: {
        valorUnico: number;
        capacidadMin: number;
        capacidadMax: number;
    }[];
    pricingId: import("convex/values").GenericId<"propertyPricing">;
}, Promise<import("convex/values").GenericId<"propertyPricing">>>;
export declare const removeTemporada: import("convex/server").RegisteredMutation<"public", {
    pricingId: import("convex/values").GenericId<"propertyPricing">;
}, Promise<{
    success: boolean;
}>>;
export declare const remove: import("convex/server").RegisteredMutation<"public", {
    id: import("convex/values").GenericId<"properties">;
}, Promise<{
    success: boolean;
}>>;
export declare const addImage: import("convex/server").RegisteredMutation<"public", {
    order?: number;
    url: string;
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<import("convex/values").GenericId<"propertyImages">>>;
export declare const getImageById: import("convex/server").RegisteredQuery<"public", {
    imageId: import("convex/values").GenericId<"propertyImages">;
}, Promise<{
    _id: import("convex/values").GenericId<"propertyImages">;
    _creationTime: number;
    order?: number;
    url: string;
    propertyId: import("convex/values").GenericId<"properties">;
}>>;
export declare const removeImage: import("convex/server").RegisteredMutation<"public", {
    imageId: import("convex/values").GenericId<"propertyImages">;
}, Promise<{
    success: boolean;
}>>;
export declare const addFeature: import("convex/server").RegisteredMutation<"public", {
    iconId?: import("convex/values").GenericId<"iconography">;
    zone?: string;
    name: string;
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<import("convex/values").GenericId<"propertyFeatures">>>;
export declare const unlinkFeature: import("convex/server").RegisteredMutation<"public", {
    name?: string;
    iconId?: import("convex/values").GenericId<"iconography">;
    propertyId: import("convex/values").GenericId<"properties">;
}, Promise<{
    success: boolean;
    count: number;
}>>;
export declare const removeFeature: import("convex/server").RegisteredMutation<"public", {
    featureId: import("convex/values").GenericId<"propertyFeatures">;
}, Promise<{
    success: boolean;
}>>;
export declare const updateImageOrder: import("convex/server").RegisteredMutation<"public", {
    imageOrders: {
        id: import("convex/values").GenericId<"propertyImages">;
        order: number;
    }[];
}, Promise<{
    success: boolean;
}>>;
export declare const getTabOrders: import("convex/server").RegisteredQuery<"public", {}, Promise<{
    _id: import("convex/values").GenericId<"tabOrders">;
    _creationTime: number;
    tabId: string;
    propertyIds: import("convex/values").GenericId<"properties">[];
    updatedAt: number;
}[]>>;
export declare const getTabOrder: import("convex/server").RegisteredQuery<"public", {
    tabId: string;
}, Promise<{
    _id: import("convex/values").GenericId<"tabOrders">;
    _creationTime: number;
    tabId: string;
    propertyIds: import("convex/values").GenericId<"properties">[];
    updatedAt: number;
}>>;
export declare const updateTabOrder: import("convex/server").RegisteredMutation<"public", {
    tabId: string;
    propertyIds: import("convex/values").GenericId<"properties">[];
}, Promise<import("convex/values").GenericId<"tabOrders">>>;
