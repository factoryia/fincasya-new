"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("convex/server");
const values_1 = require("convex/values");
const schema_1 = require("./betterAuth/schema");
exports.default = (0, server_1.defineSchema)({
    ...schema_1.tables,
    properties: (0, server_1.defineTable)({
        title: values_1.v.string(),
        description: values_1.v.string(),
        location: values_1.v.string(),
        capacity: values_1.v.number(),
        rating: values_1.v.optional(values_1.v.number()),
        reviewsCount: values_1.v.optional(values_1.v.number()),
        video: values_1.v.optional(values_1.v.string()),
        lat: values_1.v.number(),
        lng: values_1.v.number(),
        priceBase: values_1.v.number(),
        priceOriginal: values_1.v.optional(values_1.v.number()),
        priceBaja: values_1.v.number(),
        priceMedia: values_1.v.number(),
        priceAlta: values_1.v.number(),
        priceEspeciales: values_1.v.optional(values_1.v.number()),
        priceRawBase: values_1.v.optional(values_1.v.string()),
        priceRawBaja: values_1.v.optional(values_1.v.string()),
        priceRawMedia: values_1.v.optional(values_1.v.string()),
        priceRawAlta: values_1.v.optional(values_1.v.string()),
        priceRawEspeciales: values_1.v.optional(values_1.v.string()),
        code: values_1.v.optional(values_1.v.string()),
        slug: values_1.v.optional(values_1.v.string()),
        category: values_1.v.union(values_1.v.literal('ECONOMICA'), values_1.v.literal('ESTANDAR'), values_1.v.literal('PREMIUM'), values_1.v.literal('LUJO'), values_1.v.literal('ECOTURISMO'), values_1.v.literal('CON_PISCINA'), values_1.v.literal('CERCA_BOGOTA'), values_1.v.literal('GRUPOS_GRANDES'), values_1.v.literal('VIP')),
        type: values_1.v.union(values_1.v.literal('FINCA'), values_1.v.literal('CASA_CAMPESTRE'), values_1.v.literal('VILLA'), values_1.v.literal('HACIENDA'), values_1.v.literal('QUINTA'), values_1.v.literal('APARTAMENTO'), values_1.v.literal('CASA'), values_1.v.literal('CASA_PRIVADA'), values_1.v.literal('CASA_EN_CONJUNTO_CERRADO'), values_1.v.literal('VILLA_PRIVADA'), values_1.v.literal('CONDOMINIO'), values_1.v.literal('CASA_BOUTIQUE'), values_1.v.literal('YATE'), values_1.v.literal('ISLA'), values_1.v.literal('GLAMPING')),
        visible: values_1.v.optional(values_1.v.boolean()),
        active: values_1.v.optional(values_1.v.boolean()),
        reservable: values_1.v.optional(values_1.v.boolean()),
        contractTemplateUrl: values_1.v.optional(values_1.v.string()),
        isFavorite: values_1.v.optional(values_1.v.boolean()),
        featuredIcons: values_1.v.optional(values_1.v.array(values_1.v.id('iconography'))),
        zoneOrder: values_1.v.optional(values_1.v.array(values_1.v.string())),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_location', ['location'])
        .index('by_capacity', ['capacity'])
        .index('by_rating', ['rating'])
        .index('by_type', ['type'])
        .index('by_category', ['category'])
        .index('by_code', ['code'])
        .index('by_slug', ['slug'])
        .index('by_createdAt', ['createdAt']),
    propertyImages: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        url: values_1.v.string(),
        order: values_1.v.optional(values_1.v.number()),
    }).index('by_property', ['propertyId']),
    iconography: (0, server_1.defineTable)({
        name: values_1.v.optional(values_1.v.string()),
        iconUrl: values_1.v.optional(values_1.v.string()),
        emoji: values_1.v.optional(values_1.v.string()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    }).index('by_name', ['name']),
    propertyFeatures: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        name: values_1.v.string(),
        iconId: values_1.v.optional(values_1.v.id('iconography')),
        featureId: values_1.v.optional(values_1.v.string()),
        zone: values_1.v.optional(values_1.v.string()),
    })
        .index('by_property', ['propertyId'])
        .index('by_icon', ['iconId']),
    globalPricing: (0, server_1.defineTable)({
        nombre: values_1.v.string(),
        fechaDesde: values_1.v.optional(values_1.v.string()),
        fechaHasta: values_1.v.optional(values_1.v.string()),
        fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
        activa: values_1.v.optional(values_1.v.boolean()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    }).index('by_nombre', ['nombre']),
    propertyPricing: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        globalRuleId: values_1.v.optional(values_1.v.id('globalPricing')),
        nombre: values_1.v.string(),
        fechaDesde: values_1.v.optional(values_1.v.string()),
        fechaHasta: values_1.v.optional(values_1.v.string()),
        fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
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
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_property', ['propertyId'])
        .index('by_global_rule', ['globalRuleId']),
    bookings: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        userId: values_1.v.optional(values_1.v.id('contacts')),
        nombreCompleto: values_1.v.string(),
        cedula: values_1.v.string(),
        celular: values_1.v.string(),
        correo: values_1.v.string(),
        fechaEntrada: values_1.v.number(),
        fechaSalida: values_1.v.number(),
        horaEntrada: values_1.v.optional(values_1.v.string()),
        horaSalida: values_1.v.optional(values_1.v.string()),
        address: values_1.v.optional(values_1.v.string()),
        numeroNoches: values_1.v.number(),
        numeroPersonas: values_1.v.number(),
        personasAdicionales: values_1.v.optional(values_1.v.number()),
        tieneMascotas: values_1.v.optional(values_1.v.boolean()),
        numeroMascotas: values_1.v.optional(values_1.v.number()),
        detallesMascotas: values_1.v.optional(values_1.v.string()),
        subtotal: values_1.v.number(),
        costoPersonasAdicionales: values_1.v.optional(values_1.v.number()),
        costoMascotas: values_1.v.optional(values_1.v.number()),
        costoPersonalServicio: values_1.v.optional(values_1.v.number()),
        depositoGarantia: values_1.v.optional(values_1.v.number()),
        depositoAseo: values_1.v.optional(values_1.v.number()),
        discountCode: values_1.v.optional(values_1.v.string()),
        discountAmount: values_1.v.optional(values_1.v.number()),
        precioTotal: values_1.v.number(),
        currency: values_1.v.optional(values_1.v.string()),
        temporada: values_1.v.string(),
        status: values_1.v.union(values_1.v.literal('PENDING'), values_1.v.literal('PENDING_PAYMENT'), values_1.v.literal('CONFIRMED'), values_1.v.literal('PAID'), values_1.v.literal('CANCELLED'), values_1.v.literal('COMPLETED')),
        paymentStatus: values_1.v.union(values_1.v.literal('PENDING'), values_1.v.literal('PARTIAL'), values_1.v.literal('PAID'), values_1.v.literal('REFUNDED')),
        transactionId: values_1.v.optional(values_1.v.string()),
        reference: values_1.v.optional(values_1.v.string()),
        observaciones: values_1.v.optional(values_1.v.string()),
        city: values_1.v.optional(values_1.v.string()),
        purpose: values_1.v.optional(values_1.v.string()),
        isDirect: values_1.v.optional(values_1.v.boolean()),
        isDirectBooking: values_1.v.optional(values_1.v.boolean()),
        googleEventId: values_1.v.optional(values_1.v.string()),
        googleCalendarId: values_1.v.optional(values_1.v.string()),
        multimedia: values_1.v.optional(values_1.v.array(values_1.v.object({
            url: values_1.v.string(),
            name: values_1.v.string(),
            type: values_1.v.string(),
        }))),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.optional(values_1.v.number()),
    })
        .index('by_property', ['propertyId'])
        .index('by_status', ['status'])
        .index('by_cedula', ['cedula'])
        .index('by_reference', ['reference'])
        .index('by_is_direct', ['isDirect'])
        .index('by_user', ['userId'])
        .index('by_dates', ['fechaEntrada', 'fechaSalida']),
    payments: (0, server_1.defineTable)({
        bookingId: values_1.v.id('bookings'),
        type: values_1.v.union(values_1.v.literal('ABONO_50'), values_1.v.literal('SALDO_50'), values_1.v.literal('COMPLETO'), values_1.v.literal('REEMBOLSO')),
        amount: values_1.v.number(),
        currency: values_1.v.optional(values_1.v.string()),
        transactionId: values_1.v.optional(values_1.v.string()),
        reference: values_1.v.optional(values_1.v.string()),
        paymentMethod: values_1.v.optional(values_1.v.string()),
        checkoutUrl: values_1.v.optional(values_1.v.string()),
        status: values_1.v.optional(values_1.v.string()),
        wompiData: values_1.v.optional(values_1.v.any()),
        boldData: values_1.v.optional(values_1.v.any()),
        receiptUrl: values_1.v.optional(values_1.v.string()),
        verifiedBy: values_1.v.optional(values_1.v.string()),
        verifiedAt: values_1.v.optional(values_1.v.number()),
        notes: values_1.v.optional(values_1.v.string()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_booking', ['bookingId'])
        .index('by_transaction', ['transactionId'])
        .index('by_status', ['status']),
    additionalCosts: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        name: values_1.v.string(),
        description: values_1.v.optional(values_1.v.string()),
        amount: values_1.v.number(),
        type: values_1.v.union(values_1.v.literal('FIXED'), values_1.v.literal('PER_PERSON'), values_1.v.literal('PER_NIGHT'), values_1.v.literal('PERCENTAGE')),
        required: values_1.v.optional(values_1.v.boolean()),
    }).index('by_property', ['propertyId']),
    propertyAvailability: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        bookingId: values_1.v.optional(values_1.v.id('bookings')),
        fechaEntrada: values_1.v.number(),
        fechaSalida: values_1.v.number(),
        blocked: values_1.v.optional(values_1.v.boolean()),
        reason: values_1.v.optional(values_1.v.string()),
        googleEventId: values_1.v.optional(values_1.v.string()),
    })
        .index('by_property', ['propertyId'])
        .index('by_dates', ['fechaEntrada', 'fechaSalida'])
        .index('by_booking', ['bookingId']),
    discountCodes: (0, server_1.defineTable)({
        code: values_1.v.string(),
        propertyId: values_1.v.optional(values_1.v.id('properties')),
        type: values_1.v.union(values_1.v.literal('PERCENTAGE'), values_1.v.literal('FIXED_AMOUNT')),
        value: values_1.v.number(),
        maxUses: values_1.v.optional(values_1.v.number()),
        currentUses: values_1.v.optional(values_1.v.number()),
        validFrom: values_1.v.optional(values_1.v.number()),
        validUntil: values_1.v.optional(values_1.v.number()),
        active: values_1.v.optional(values_1.v.boolean()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_code', ['code'])
        .index('by_property', ['propertyId']),
    favorites: (0, server_1.defineTable)({
        userId: values_1.v.string(),
        propertyId: values_1.v.id('properties'),
        createdAt: values_1.v.number(),
    })
        .index('by_user', ['userId'])
        .index('by_property', ['propertyId'])
        .index('by_user_and_property', ['userId', 'propertyId']),
    pendingKnowledgeUploads: (0, server_1.defineTable)({
        storageId: values_1.v.id('_storage'),
        filename: values_1.v.string(),
        mimeType: values_1.v.string(),
        category: values_1.v.optional(values_1.v.string()),
        namespace: values_1.v.string(),
        userId: values_1.v.string(),
        createdAt: values_1.v.number(),
    }).index('by_created', ['createdAt']),
    contacts: (0, server_1.defineTable)({
        phone: values_1.v.string(),
        name: values_1.v.string(),
        email: values_1.v.optional(values_1.v.string()),
        cedula: values_1.v.optional(values_1.v.string()),
        city: values_1.v.optional(values_1.v.string()),
        lastReservationAt: values_1.v.optional(values_1.v.number()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.optional(values_1.v.number()),
    })
        .index('by_phone', ['phone'])
        .index('by_cedula', ['cedula']),
    conversations: (0, server_1.defineTable)({
        contactId: values_1.v.id('contacts'),
        channel: values_1.v.union(values_1.v.literal('whatsapp')),
        status: values_1.v.union(values_1.v.literal('ai'), values_1.v.literal('human'), values_1.v.literal('resolved')),
        priority: values_1.v.optional(values_1.v.union(values_1.v.literal('urgent'), values_1.v.literal('low'), values_1.v.literal('medium'), values_1.v.literal('resolved'))),
        lastMessageAt: values_1.v.optional(values_1.v.number()),
        lastSentCatalogPropertyIds: values_1.v.optional(values_1.v.array(values_1.v.id('properties'))),
        lastCatalogSearch: values_1.v.optional(values_1.v.object({
            location: values_1.v.string(),
            fechaEntrada: values_1.v.number(),
            fechaSalida: values_1.v.number(),
            minCapacity: values_1.v.optional(values_1.v.number()),
            sortByPrice: values_1.v.optional(values_1.v.boolean()),
        })),
        createdAt: values_1.v.number(),
        attended: values_1.v.optional(values_1.v.boolean()),
    })
        .index('by_contact', ['contactId'])
        .index('by_status', ['status'])
        .index('by_priority', ['priority'])
        .index('by_last_message', ['lastMessageAt']),
    messages: (0, server_1.defineTable)({
        conversationId: values_1.v.id('conversations'),
        sender: values_1.v.union(values_1.v.literal('user'), values_1.v.literal('assistant')),
        content: values_1.v.string(),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal('text'), values_1.v.literal('image'), values_1.v.literal('audio'), values_1.v.literal('video'), values_1.v.literal('document'), values_1.v.literal('product'))),
        mediaUrl: values_1.v.optional(values_1.v.string()),
        metadata: values_1.v.optional(values_1.v.any()),
        createdAt: values_1.v.number(),
    }).index('by_conversation', ['conversationId', 'createdAt']),
    ycloudProcessedEvents: (0, server_1.defineTable)({
        eventId: values_1.v.string(),
    }).index('by_event_id', ['eventId']),
    whatsappCatalogs: (0, server_1.defineTable)({
        name: values_1.v.string(),
        whatsappCatalogId: values_1.v.string(),
        isDefault: values_1.v.optional(values_1.v.boolean()),
        locationKeyword: values_1.v.optional(values_1.v.string()),
        order: values_1.v.optional(values_1.v.number()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_name', ['name'])
        .index('by_location_keyword', ['locationKeyword'])
        .index('by_is_default', ['isDefault']),
    propertyWhatsAppCatalog: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        catalogId: values_1.v.id('whatsappCatalogs'),
        productRetailerId: values_1.v.string(),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_property', ['propertyId'])
        .index('by_catalog', ['catalogId'])
        .index('by_property_and_catalog', ['propertyId', 'catalogId']),
    reviews: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        bookingId: values_1.v.optional(values_1.v.id('bookings')),
        userId: values_1.v.optional(values_1.v.string()),
        rating: values_1.v.number(),
        comment: values_1.v.optional(values_1.v.string()),
        verified: values_1.v.optional(values_1.v.boolean()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    })
        .index('by_property', ['propertyId'])
        .index('by_booking', ['bookingId'])
        .index('by_user', ['userId']),
    tabOrders: (0, server_1.defineTable)({
        tabId: values_1.v.string(),
        propertyIds: values_1.v.array(values_1.v.id('properties')),
        updatedAt: values_1.v.number(),
    }).index('by_tab', ['tabId']),
    propertyOwnerInfo: (0, server_1.defineTable)({
        propertyId: values_1.v.id('properties'),
        ownerUserId: values_1.v.string(),
        rutNumber: values_1.v.string(),
        bankName: values_1.v.string(),
        accountNumber: values_1.v.string(),
        rntNumber: values_1.v.string(),
        bankCertificationUrl: values_1.v.optional(values_1.v.string()),
        idCopyUrl: values_1.v.optional(values_1.v.string()),
        rntPdfUrl: values_1.v.optional(values_1.v.string()),
        chamberOfCommerceUrl: values_1.v.optional(values_1.v.string()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    }).index('by_property', ['propertyId'])
        .index('by_owner', ['ownerUserId']),
    quienes_somos: (0, server_1.defineTable)({
        queEsFincasYa: values_1.v.string(),
        mision: values_1.v.string(),
        vision: values_1.v.string(),
        objetivos: values_1.v.union(values_1.v.string(), values_1.v.array(values_1.v.string())),
        politicas: values_1.v.union(values_1.v.string(), values_1.v.array(values_1.v.string())),
        trayectoriaTitle: values_1.v.string(),
        trayectoriaParagraphs: values_1.v.string(),
        stats: values_1.v.array(values_1.v.object({
            label: values_1.v.string(),
            value: values_1.v.string(),
        })),
        recognitionTitle: values_1.v.string(),
        recognitionSubtitle: values_1.v.string(),
        presenciaInstitucional: values_1.v.string(),
        carouselImages: values_1.v.optional(values_1.v.array(values_1.v.string())),
        videoUrl: values_1.v.optional(values_1.v.string()),
        videoTitle: values_1.v.optional(values_1.v.string()),
        videoDescription: values_1.v.optional(values_1.v.string()),
        videoBadge: values_1.v.optional(values_1.v.string()),
        updatedAt: values_1.v.number(),
    }),
    googleCalendarIntegrations: (0, server_1.defineTable)({
        accessToken: values_1.v.optional(values_1.v.string()),
        refreshToken: values_1.v.optional(values_1.v.string()),
        expiresAt: values_1.v.optional(values_1.v.number()),
        calendarId: values_1.v.optional(values_1.v.string()),
        connected: values_1.v.boolean(),
        connectedEmail: values_1.v.optional(values_1.v.string()),
        connectedName: values_1.v.optional(values_1.v.string()),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    }),
});
//# sourceMappingURL=schema.js.map