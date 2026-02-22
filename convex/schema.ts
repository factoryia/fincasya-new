import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Tabla de propiedades (fincas)
  properties: defineTable({
    title: v.string(),
    description: v.string(),
    location: v.string(),
    capacity: v.number(),
    rating: v.optional(v.number()),
    reviewsCount: v.optional(v.number()),
    video: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
    priceBase: v.number(),
    priceBaja: v.number(),
    priceMedia: v.number(),
    priceAlta: v.number(),
    priceEspeciales: v.optional(v.number()),
    priceRawBase: v.optional(v.string()),
    priceRawBaja: v.optional(v.string()),
    priceRawMedia: v.optional(v.string()),
    priceRawAlta: v.optional(v.string()),
    priceRawEspeciales: v.optional(v.string()),
    code: v.optional(v.string()),
    category: v.union(
      v.literal("ECONOMICA"),
      v.literal("ESTANDAR"),
      v.literal("PREMIUM"),
      v.literal("LUJO"),
      v.literal("ECOTURISMO"),
      v.literal("CON_PISCINA"),
      v.literal("CERCA_BOGOTA"),
      v.literal("GRUPOS_GRANDES"),
      v.literal("VIP")
    ),
    type: v.union(
      v.literal("FINCA"),
      v.literal("CASA_CAMPESTRE"),
      v.literal("VILLA"),
      v.literal("HACIENDA"),
      v.literal("QUINTA"),
      v.literal("APARTAMENTO"),
      v.literal("CASA")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_location", ["location"])
    .index("by_capacity", ["capacity"])
    .index("by_rating", ["rating"])
    .index("by_type", ["type"])
    .index("by_category", ["category"])
    .index("by_code", ["code"]),

  // Tabla de imágenes de propiedades
  propertyImages: defineTable({
    propertyId: v.id("properties"),
    url: v.string(),
    order: v.optional(v.number()),
  })
    .index("by_property", ["propertyId"]),

  // Tabla de características de propiedades
  propertyFeatures: defineTable({
    propertyId: v.id("properties"),
    name: v.string(),
  })
    .index("by_property", ["propertyId"]),

  // Temporadas y precios por propiedad: el admin crea las que quiera y marca cuáles están activas para el cliente
  propertyPricing: defineTable({
    propertyId: v.id("properties"),
    nombre: v.string(),
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    valorUnico: v.optional(v.number()),
    condiciones: v.optional(v.string()),
    /** Si true, el cliente final ve esta temporada; el admin puede activar/desactivar */
    activa: v.optional(v.boolean()),
    /** JSON: reglas de la temporada (rangos fechas, días semana, mín noches, excepciones, descripción) */
    reglas: v.optional(v.string()),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_property", ["propertyId"]),

  // Tabla de reservas (bookings)
  bookings: defineTable({
    propertyId: v.id("properties"),
    userId: v.optional(v.id("users")),
    nombreCompleto: v.string(),
    cedula: v.string(),
    celular: v.string(),
    correo: v.string(),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    numeroNoches: v.number(),
    numeroPersonas: v.number(),
    personasAdicionales: v.optional(v.number()),
    tieneMascotas: v.optional(v.boolean()),
    numeroMascotas: v.optional(v.number()),
    detallesMascotas: v.optional(v.string()),
    subtotal: v.number(),
    costoPersonasAdicionales: v.optional(v.number()),
    costoMascotas: v.optional(v.number()),
    costoPersonalServicio: v.optional(v.number()),
    depositoGarantia: v.optional(v.number()),
    depositoAseo: v.optional(v.number()),
    discountCode: v.optional(v.string()),
    discountAmount: v.optional(v.number()),
    precioTotal: v.number(),
    currency: v.optional(v.string()),
    temporada: v.string(),
    status: v.union(
      v.literal("PENDING"),
      v.literal("CONFIRMED"),
      v.literal("PAID"),
      v.literal("CANCELLED"),
      v.literal("COMPLETED")
    ),
    paymentStatus: v.union(
      v.literal("PENDING"),
      v.literal("PARTIAL"),
      v.literal("PAID"),
      v.literal("REFUNDED")
    ),
    transactionId: v.optional(v.string()),
    reference: v.optional(v.string()),
    observaciones: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_status", ["status"])
    .index("by_cedula", ["cedula"])
    .index("by_reference", ["reference"])
    .index("by_user", ["userId"])
    .index("by_dates", ["fechaEntrada", "fechaSalida"]),

  // Tabla de pagos
  payments: defineTable({
    bookingId: v.id("bookings"),
    type: v.union(
      v.literal("ABONO_50"),
      v.literal("SALDO_50"),
      v.literal("COMPLETO"),
      v.literal("REEMBOLSO")
    ),
    amount: v.number(),
    currency: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    reference: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    status: v.optional(v.string()),
    wompiData: v.optional(v.any()),
    receiptUrl: v.optional(v.string()),
    verifiedBy: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_booking", ["bookingId"])
    .index("by_transaction", ["transactionId"])
    .index("by_status", ["status"]),

  // Tabla de costos adicionales
  additionalCosts: defineTable({
    propertyId: v.id("properties"),
    name: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    type: v.union(
      v.literal("FIXED"),
      v.literal("PER_PERSON"),
      v.literal("PER_NIGHT"),
      v.literal("PERCENTAGE")
    ),
    required: v.optional(v.boolean()),
  })
    .index("by_property", ["propertyId"]),

  // Tabla de disponibilidad
  propertyAvailability: defineTable({
    propertyId: v.id("properties"),
    bookingId: v.optional(v.id("bookings")),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    blocked: v.optional(v.boolean()),
    reason: v.optional(v.string()),
  })
    .index("by_property", ["propertyId"])
    .index("by_dates", ["fechaEntrada", "fechaSalida"])
    .index("by_booking", ["bookingId"]),

  // Tabla de códigos de descuento
  discountCodes: defineTable({
    code: v.string(),
    propertyId: v.optional(v.id("properties")),
    type: v.union(v.literal("PERCENTAGE"), v.literal("FIXED_AMOUNT")),
    value: v.number(),
    maxUses: v.optional(v.number()),
    currentUses: v.optional(v.number()),
    validFrom: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    active: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_property", ["propertyId"]),

  // Tabla de favoritos
  favorites: defineTable({
    userId: v.id("users"),
    propertyId: v.id("properties"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_property", ["propertyId"])
    .index("by_user_and_property", ["userId", "propertyId"]),

  // Cola de subidas de conocimiento (procesamiento en background para evitar timeout 524)
  pendingKnowledgeUploads: defineTable({
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    category: v.optional(v.string()),
    namespace: v.string(),
    userId: v.string(),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"]),

  // === WhatsApp / YCloud: conversaciones y mensajes ===
  contacts: defineTable({
    phone: v.string(),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_phone", ["phone"]),

  conversations: defineTable({
    contactId: v.id("contacts"),
    channel: v.union(v.literal("whatsapp")),
    /** ai = responde la IA; human = solo humano; resolved = cerrada */
    status: v.union(
      v.literal("ai"),
      v.literal("human"),
      v.literal("resolved")
    ),
    lastMessageAt: v.optional(v.number()),
    /** Últimas fincas enviadas en catálogo (para "otras opciones") */
    lastSentCatalogPropertyIds: v.optional(v.array(v.id("properties"))),
    /** Filtros de la última búsqueda que envió catálogo (para repetir con otras fincas) */
    lastCatalogSearch: v.optional(
      v.object({
        location: v.string(),
        fechaEntrada: v.number(),
        fechaSalida: v.number(),
        minCapacity: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_contact", ["contactId"])
    .index("by_status", ["status"])
    .index("by_last_message", ["lastMessageAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    sender: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "createdAt"]),

  ycloudProcessedEvents: defineTable({
    eventId: v.string(),
  }).index("by_event_id", ["eventId"]),

  /** Catálogos de WhatsApp (Meta). Se configuran desde el front; sin env vars. */
  whatsappCatalogs: defineTable({
    name: v.string(),
    /** ID del catálogo en Meta/WhatsApp (ej. 26198995209693859). */
    whatsappCatalogId: v.string(),
    /** Si true, se usa cuando no coincide ninguna ubicación (ej. "Todas las unidades"). */
    isDefault: v.optional(v.boolean()),
    /** Si la ubicación del usuario contiene esta palabra, se usa este catálogo (ej. "tolima"). */
    locationKeyword: v.optional(v.string()),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_location_keyword", ["locationKeyword"])
    .index("by_is_default", ["isDefault"]),

  /** Relación N-N: una finca puede estar en varios catálogos; cada entrada guarda el product_retailer_id en ese catálogo. */
  propertyWhatsAppCatalog: defineTable({
    propertyId: v.id("properties"),
    catalogId: v.id("whatsappCatalogs"),
    /** ID del producto (finca) en ese catálogo en Meta (identificador de contenido). */
    productRetailerId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_catalog", ["catalogId"])
    .index("by_property_and_catalog", ["propertyId", "catalogId"]),

  // Tabla de reseñas
  reviews: defineTable({
    propertyId: v.id("properties"),
    bookingId: v.optional(v.id("bookings")),
    userId: v.optional(v.id("users")),
    rating: v.number(),
    comment: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_booking", ["bookingId"])
    .index("by_user", ["userId"]),
});
