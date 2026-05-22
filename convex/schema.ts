import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { tables as betterAuthTables } from './betterAuth/schema';

export default defineSchema({
  ...betterAuthTables,
  // Customizing user table to include city and address
  user: defineTable({
    ...betterAuthTables.user.validator.fields,
    city: v.optional(v.string()),
    address: v.optional(v.string()),
  })
    .index('email_name', ['email', 'name'])
    .index('name', ['name'])
    .index('userId', ['userId']),

  // Tabla de propiedades (fincas) - Actualizado por Antigravity para soportar featuredIcons
  properties: defineTable({
    title: v.string(),
    description: v.string(),
    location: v.string(),
    capacity: v.number(),
    /**
     * Máximo de personas para evento/celebración (invitados totales), puede ser mayor que `capacity`
     * (hospedaje). Solo aplica si `allowsEventsContent === true` y el cliente busca con evento.
     */
    eventCapacity: v.optional(v.number()),
    /**
     * Precio de referencia en COP para evento/celebración hasta `eventCapacity` invitados
     * (orientador para bot y catálogo; opcional).
     */
    eventPackagePrice: v.optional(v.number()),
    rating: v.optional(v.number()),
    reviewsCount: v.optional(v.number()),
    video: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
    priceBase: v.number(),
    /** Precio original antes de descuentos/promos (legacy, usado para catálogos). */
    priceOriginal: v.optional(v.number()),
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
    slug: v.optional(v.string()),
    category: v.union(
      v.literal('ECONOMICA'),
      v.literal('ESTANDAR'),
      v.literal('PREMIUM'),
      v.literal('LUJO'),
      v.literal('ECOTURISMO'),
      v.literal('CON_PISCINA'),
      v.literal('CERCA_BOGOTA'),
      v.literal('GRUPOS_GRANDES'),
      v.literal('VIP'),
    ),
    type: v.union(
      v.literal('FINCA'),
      v.literal('CASA_CAMPESTRE'),
      v.literal('VILLA'),
      v.literal('HACIENDA'),
      v.literal('QUINTA'),
      v.literal('APARTAMENTO'),
      v.literal('CASA'),
      v.literal('CASA_PRIVADA'),
      v.literal('CASA_EN_CONJUNTO_CERRADO'),
      v.literal('VILLA_PRIVADA'),
      v.literal('CONDOMINIO'),
      v.literal('CASA_BOUTIQUE'),
      v.literal('YATE'),
      v.literal('ISLA'),
      v.literal('GLAMPING'),
    ),
    /** Si true, la finca aparece en el listado público. */
    visible: v.optional(v.boolean()),
    /** Si false, la finca está desactivada y no se muestra en la web principal. Default true. */
    active: v.optional(v.boolean()),
    /** Si true, se puede reservar desde la página web. */
    reservable: v.optional(v.boolean()),
    /** Si true, aparece en /marketplace (fincas en venta) y el detalle ofrece contacto por WhatsApp. */
    marketplaceForSale: v.optional(v.boolean()),
    /** Valor de venta de referencia en COP (marketplace). */
    salePriceCop: v.optional(v.number()),
    /** URL de la plantilla del contrato en PDF. */
    contractTemplateUrl: v.optional(v.string()),
    /**
     * Etiquetas de filtros del sitio (pestañas del home): luxury, eventos, cerca-bogota, melgar, etc.
     * Si el campo falta, la web usa reglas legacy por ubicación/texto. Si existe (puede ser []), aplica modo explícito.
     */
    catalogFilterTags: v.optional(v.array(v.string())),
    /** Bandera legacy para favoritos (para compatibilidad con documentos existentes). */
    isFavorite: v.optional(v.boolean()),
    /** Lista de IDs de la iconografía para mostrar en la card de la finca (máximo 4). */
    featuredIcons: v.optional(v.array(v.id('iconography'))),
    /** Lista ordenada de nombres de zonas para renderizado. */
    zoneOrder: v.optional(v.array(v.string())),
    /** Si true, la finca permite mascotas. */
    allowsPets: v.optional(v.boolean()),
    /** Si true, se permite bafles, sonido profesional o decoración para eventos. */
    allowsEventsContent: v.optional(v.boolean()),
    /** Si true, la finca solo permite estadías exclusivamente para descanso familiar. */
    familyOnly: v.optional(v.boolean()),
    /** Si true, la finca tiene personal de servicio disponible para contratación. */
    serviceStaffAvailable: v.optional(v.boolean()),
    /** Si true, el personal de servicio es obligatorio para la finca. */
    serviceStaffMandatory: v.optional(v.boolean()),
    /** Precio por estadía del personal de servicio. */
    serviceStaffPrice: v.optional(v.number()),
    /**
     * Depósito reembolsable por daños a la propiedad (COP). Se muestra en el
     * resumen del chat y se precarga al generar contrato.
     */
    depositoDanosReembolsable: v.optional(v.number()),
    /**
     * Valor de la manilla de ingreso al condominio (COP). Aplica a fincas en
     * conjunto cerrado / condominio.
     */
    manillaCondominio: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_location', ['location'])
    .index('by_capacity', ['capacity'])
    .index('by_rating', ['rating'])
    .index('by_type', ['type'])
    .index('by_category', ['category'])
    .index('by_code', ['code'])
    .index('by_slug', ['slug'])
    .index('by_createdAt', ['createdAt']),

  // Tabla de imágenes de propiedades
  propertyImages: defineTable({
    propertyId: v.id('properties'),
    url: v.string(),
    order: v.optional(v.number()),
  }).index('by_property', ['propertyId']),

  // Catálogo de iconografía (nombre + icono SVG + emoji)
  iconography: defineTable({
    name: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    emoji: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_name', ['name']),

  // Tabla de características de propiedades (enlaza propiedad con icono de la iconografía)
  propertyFeatures: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    iconId: v.optional(v.id('iconography')),
    featureId: v.optional(v.string()), // Legacy field to allow Convex dev to pass validation
    /** Cantidad (ej. 2 hamacas, 3 duchas). Por defecto 1 si no se envía. */
    quantity: v.optional(v.number()),
    zone: v.optional(v.string()),
    /**
     * Si proviene de una plantilla de zona por categoría, permite re-aplicar la plantilla
     * sin borrar características añadidas solo a esta finca (sin este campo).
     */
    zoneTemplateSourceId: v.optional(
      v.id('propertyCategoryZoneTemplates'),
    ),
  })
    .index('by_property', ['propertyId'])
    .index('by_icon', ['iconId']),

  /**
   * Zona "tipo" por categoría de propiedad (ECONOMICA, PREMIUM, etc.): plantilla reutilizable.
   * No sustituye al catálogo global de iconografía; solo agrupa referencias con alias opcional.
   */
  propertyCategoryZoneTemplates: defineTable({
    propertyCategory: v.union(
      v.literal('ECONOMICA'),
      v.literal('ESTANDAR'),
      v.literal('PREMIUM'),
      v.literal('LUJO'),
      v.literal('ECOTURISMO'),
      v.literal('CON_PISCINA'),
      v.literal('CERCA_BOGOTA'),
      v.literal('GRUPOS_GRANDES'),
      v.literal('VIP'),
    ),
    name: v.string(),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_category', ['propertyCategory']),

  /** Características de la plantilla de zona: icono del catálogo + nombre mostrado (alias). */
  propertyCategoryZoneFeatures: defineTable({
    zoneTemplateId: v.id('propertyCategoryZoneTemplates'),
    iconographyId: v.id('iconography'),
    alias: v.optional(v.string()),
    /** Cantidad por defecto al importar la plantilla a una finca (≥1). */
    quantity: v.optional(v.number()),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_zone_template', ['zoneTemplateId'])
    .index('by_iconography', ['iconographyId']),

  // Temporadas y precios generales: el admin las crea para reutilizarlas en múltiples fincas
  globalPricing: defineTable({
    nombre: v.string(),
    /** Formato: MM-DD (ej: 04-01 para 1ro de abril). Independiente del año. */
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    /** Lista de fechas específicas en formato MM-DD. */
    fechas: v.optional(v.array(v.string())),
    activa: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_nombre', ['nombre']),

  // Temporadas y precios por propiedad: el admin crea las que quiera y marca cuáles están activas para el cliente
  propertyPricing: defineTable({
    propertyId: v.id('properties'),
    /** ID de la regla global (opcional). Si existe, los datos de nombre/fechas pueden heredarse. */
    globalRuleId: v.optional(v.id('globalPricing')),
    nombre: v.string(),
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    fechas: v.optional(v.array(v.string())),
    /** Precio base (usado cuando no hay sub-reglas de capacidad) */
    valorUnico: v.optional(v.number()),
    condiciones: v.optional(v.string()),
    /** Si true, el cliente final ve esta temporada; el admin puede activar/desactivar */
    activa: v.optional(v.boolean()),
    /** JSON: reglas de la temporada (rangos fechas, días semana, mín noches, excepciones, descripción) */
    reglas: v.optional(v.string()),
    order: v.optional(v.number()),
    /** Sub-reglas de precio por capacidad (cada una con su propio precio) */
    subReglasCapacidad: v.optional(
      v.array(
        v.object({
          capacidadMin: v.number(),
          capacidadMax: v.number(),
          valorUnico: v.number(),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property', ['propertyId'])
    .index('by_global_rule', ['globalRuleId']),

  // Tabla de reservas (bookings)
  bookings: defineTable({
    propertyId: v.id('properties'),
    userId: v.optional(v.id('contacts')),
    nombreCompleto: v.string(),
    cedula: v.string(),
    celular: v.string(),
    correo: v.string(),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    horaEntrada: v.optional(v.string()), // Ej: "15:00"
    horaSalida: v.optional(v.string()), // Ej: "11:00"
    address: v.optional(v.string()),
    numeroNoches: v.number(),
    numeroPersonas: v.number(),
    personasAdicionales: v.optional(v.number()),
    tieneMascotas: v.optional(v.boolean()),
    numeroMascotas: v.optional(v.number()),
    detallesMascotas: v.optional(v.string()),
    subtotal: v.number(),
    costoPersonasAdicionales: v.optional(v.number()),
    costoMascotas: v.optional(v.number()),
    depositoMascotas: v.optional(v.number()),
    sobrecargoMascotas: v.optional(v.number()),
    costoPersonalServicio: v.optional(v.number()),
    depositoGarantia: v.optional(v.number()),
    depositoAseo: v.optional(v.number()),
    discountCode: v.optional(v.string()),
    discountAmount: v.optional(v.number()),
    precioTotal: v.number(),
    currency: v.optional(v.string()),
    temporada: v.string(),
    status: v.union(
      v.literal('PENDING'),
      v.literal('PENDING_PAYMENT'),
      v.literal('CONFIRMED'),
      v.literal('PAID'),
      v.literal('CANCELLED'),
      v.literal('COMPLETED'),
    ),
    paymentStatus: v.union(
      v.literal('PENDING'),
      v.literal('PARTIAL'),
      v.literal('PAID'),
      v.literal('REFUNDED'),
    ),
    transactionId: v.optional(v.string()),
    reference: v.optional(v.string()),
    observaciones: v.optional(v.string()),
    city: v.optional(v.string()),
    purpose: v.optional(v.string()),
    groupType: v.optional(v.string()),
    isEvento: v.optional(v.boolean()),
    detallesEvento: v.optional(
      v.union(
        v.null(),
        v.object({
          extraSound: v.optional(v.string()),
          liveMusic: v.optional(v.string()),
          dj: v.optional(v.string()),
          decoration: v.optional(v.string()),
          additionalGuests: v.optional(v.string()),
        }),
      )
    ),
    isDirect: v.optional(v.boolean()),
    isDirectBooking: v.optional(v.boolean()),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    multimedia: v.optional(
      v.array(
        v.object({
          url: v.string(),
          name: v.string(),
          type: v.string(),
          size: v.optional(v.number()),
          uploadedAt: v.optional(v.number()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    reminderSent: v.optional(v.boolean()),
  })
    .index('by_property', ['propertyId'])
    .index('by_status', ['status'])
    .index('by_cedula', ['cedula'])
    .index('by_reference', ['reference'])
    .index('by_is_direct', ['isDirect'])
    .index('by_user', ['userId'])
    .index('by_dates', ['fechaEntrada', 'fechaSalida']),

  /**
   * Borrador de contrato desde admin: no bloquea calendario ni cuenta como reserva
   * hasta que en «Confirmar pago» se genera la confirmación y se crea la reserva.
   */
  adminContractSnapshots: defineTable({
    contractNumber: v.string(),
    propertyId: v.id('properties'),
    /** Campos compatibles con bookings-sync.createBooking (sin propertyId). */
    payload: v.any(),
    createdAt: v.number(),
  }).index('by_contract_number', ['contractNumber']),

  /**
   * Ajustes globales del contrato (administrador, cuentas bancarias, cláusulas, etc.).
   * Un solo documento por deployment (`scope === "global"`).
   */
  adminContractSettings: defineTable({
    scope: v.literal('global'),
    /** Snapshot JSON alineado con `ContractSettingsPersistedSnapshot` en el front. */
    payload: v.any(),
    updatedAt: v.number(),
  }).index('by_scope', ['scope']),

  // Tabla de pagos
  payments: defineTable({
    bookingId: v.id('bookings'),
    type: v.union(
      v.literal('ABONO_50'),
      v.literal('SALDO_50'),
      v.literal('COMPLETO'),
      v.literal('REEMBOLSO'),
    ),
    amount: v.number(),
    currency: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    reference: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    status: v.optional(v.string()),
    wompiData: v.optional(v.any()),
    boldData: v.optional(v.any()),
    receiptUrl: v.optional(v.string()),
    verifiedBy: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_booking', ['bookingId'])
    .index('by_transaction', ['transactionId'])
    .index('by_status', ['status']),

  // Tabla de costos adicionales
  additionalCosts: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    type: v.union(
      v.literal('FIXED'),
      v.literal('PER_PERSON'),
      v.literal('PER_NIGHT'),
      v.literal('PERCENTAGE'),
    ),
    required: v.optional(v.boolean()),
  }).index('by_property', ['propertyId']),

  // Tabla de disponibilidad
  propertyAvailability: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.optional(v.id('bookings')),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    blocked: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    googleEventId: v.optional(v.string()),
  })
    .index('by_property', ['propertyId'])
    .index('by_dates', ['fechaEntrada', 'fechaSalida'])
    .index('by_booking', ['bookingId']),

  // Tabla de códigos de descuento
  discountCodes: defineTable({
    code: v.string(),
    propertyId: v.optional(v.id('properties')),
    type: v.union(v.literal('PERCENTAGE'), v.literal('FIXED_AMOUNT')),
    value: v.number(),
    maxUses: v.optional(v.number()),
    currentUses: v.optional(v.number()),
    validFrom: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    active: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_code', ['code'])
    .index('by_property', ['propertyId']),

  // Tabla de favoritos
  favorites: defineTable({
    userId: v.string(),
    propertyId: v.id('properties'),
    createdAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_property', ['propertyId'])
    .index('by_user_and_property', ['userId', 'propertyId']),

  // Cola de subidas de conocimiento (procesamiento en background para evitar timeout 524)
  pendingKnowledgeUploads: defineTable({
    storageId: v.id('_storage'),
    filename: v.string(),
    mimeType: v.string(),
    category: v.optional(v.string()),
    namespace: v.string(),
    userId: v.string(),
    createdAt: v.number(),
  }).index('by_created', ['createdAt']),

  // === WhatsApp / YCloud: conversaciones y mensajes ===
  contacts: defineTable({
    phone: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    cedula: v.optional(v.string()),
    city: v.optional(v.string()),
    /** Lead: en seguimiento. Cliente: ya con reserva o relación comercial. */
    crmType: v.optional(v.union(v.literal('lead'), v.literal('client'))),
    lastReservationAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_phone', ['phone'])
    .index('by_cedula', ['cedula']),

  /**
   * Eventos de cambio de estado operativo (trazabilidad).
   * La entidad extensible es el literal en `operationalState` en `conversations` (mismos valores).
   */
  conversationOperationalStateEvents: defineTable({
    conversationId: v.id('conversations'),
    fromState: v.optional(
      v.union(
        v.literal('requires_advisor'),
        v.literal('validate_availability'),
        v.literal('ready_to_book'),
        v.literal('pending_payment'),
        v.literal('pending_data'),
      ),
    ),
    toState: v.union(
      v.literal('requires_advisor'),
      v.literal('validate_availability'),
      v.literal('ready_to_book'),
      v.literal('pending_payment'),
      v.literal('pending_data'),
    ),
    source: v.union(v.literal('bot'), v.literal('user')),
    userId: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_conversation', ['conversationId', 'createdAt']),

  conversations: defineTable({
    contactId: v.id('contacts'),
    channel: v.union(v.literal('whatsapp'), v.literal('web')),
    /** ai = responde la IA; human = solo humano; resolved = cerrada */
    status: v.union(v.literal('ai'), v.literal('human'), v.literal('resolved')),
    /**
     * Estado operativo del embudo (visible en inbox). Extensible añadiendo literales + migración.
     * Default lógico: pending_data.
     */
    operationalState: v.optional(
      v.union(
        v.literal('requires_advisor'),
        v.literal('validate_availability'),
        v.literal('ready_to_book'),
        v.literal('pending_payment'),
        v.literal('pending_data'),
      ),
    ),
    /** Prioridad para el inbox: urgente, baja, media, resuelto */
    priority: v.optional(
      v.union(
        v.literal('urgent'),
        v.literal('low'),
        v.literal('medium'),
        v.literal('resolved'),
      ),
    ),
    lastMessageAt: v.optional(v.number()),
    /** Últimas fincas enviadas en catálogo (para "otras opciones") */
    lastSentCatalogPropertyIds: v.optional(v.array(v.id('properties'))),
    /** Filtros de la última búsqueda que envió catálogo (para repetir con otras fincas) */
    lastCatalogSearch: v.optional(
      v.object({
        location: v.string(),
        fechaEntrada: v.number(),
        fechaSalida: v.number(),
        minCapacity: v.optional(v.number()),
        sortByPrice: v.optional(v.boolean()),
        hasPets: v.optional(v.boolean()),
      }),
    ),
    createdAt: v.number(),
    attended: v.optional(v.boolean()),
    /** Convex `user._id` del asesor asignado (inbox). */
    assignedUserId: v.optional(v.string()),
    /**
     * Etiquetas de negocio (inbox): varias por conversación; strings libres
     * (predefinidas en UI + personalizadas).
     */
    tags: v.optional(v.array(v.string())),
    /**
     * Mensajes del cliente sin marcar como leídos en el panel (incrementa con
     * cada mensaje `user`; se pone a 0 al abrir/marcar leído).
     */
    inboxUnreadCount: v.optional(v.number()),
  })
    .index('by_contact', ['contactId'])
    .index('by_status', ['status'])
    .index('by_priority', ['priority'])
    .index('by_last_message', ['lastMessageAt'])
    .index('by_operational_state', ['operationalState'])
    .index('by_assigned_user', ['assignedUserId']),

  messages: defineTable({
    conversationId: v.id('conversations'),
    /** system = solo inbox (alertas internas); no se envía a WhatsApp. */
    sender: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('system'),
    ),
    content: v.string(),
    /** Tipo de mensaje: texto (default), imagen, audio, video, documento */
    type: v.optional(
      v.union(
        v.literal('text'),
        v.literal('image'),
        v.literal('audio'),
        v.literal('video'),
        v.literal('document'),
        v.literal('product'),
      ),
    ),
    /** URL de media cuando type es image/audio/document */
    mediaUrl: v.optional(v.string()),
    /** Metadatos del mensaje (ej: para catálogos, datos de finca) */
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    /** Convex user._id del asesor que envió el mensaje manualmente (trazabilidad). */
    sentByUserId: v.optional(v.string()),
  }).index('by_conversation', ['conversationId', 'createdAt']),

  /** Plantillas rápidas configurables por intención para respuestas del inbox/IA. */
  quickReplyTemplates: defineTable({
    title: v.string(),
    /** Trigger corto para slash command (ej: /mascotas). */
    slashCommand: v.string(),
    /** Intención de negocio detectada por IA para usar esta plantilla. */
    intentKey: v.string(),
    /** Texto exacto a enviar cuando mediaType = text. */
    content: v.optional(v.string()),
    /** text o audio. Audio usa mediaUrl en S3. */
    mediaType: v.union(v.literal('text'), v.literal('audio')),
    /** URL pública del audio en S3 cuando mediaType = audio. */
    mediaUrl: v.optional(v.string()),
    language: v.optional(v.string()),
    active: v.optional(v.boolean()),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_intent', ['intentKey'])
    .index('by_slash', ['slashCommand'])
    .index('by_active', ['active']),

  /** Trazabilidad de quién atiende cada conversación (asignaciones, transferencias, mensajes, cierres). */
  conversationAuditEvents: defineTable({
    conversationId: v.id('conversations'),
    eventType: v.union(
      v.literal('assigned'),
      v.literal('unassigned'),
      v.literal('transferred'),
      v.literal('resolved'),
      v.literal('message_sent'),
    ),
    userId: v.string(),
    previousUserId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_conversation', ['conversationId', 'createdAt'])
    .index('by_user', ['userId', 'createdAt']),

  ycloudProcessedEvents: defineTable({
    eventId: v.string(),
  }).index('by_event_id', ['eventId']),

  /**
   * Mensajes de catálogo enviados por el bot (interactive product): wamid → product_retailer_id.
   * Permite resolver cuando el cliente responde citando una ficha (“Quiero esta”).
   */
  ycloudCatalogMessageWamids: defineTable({
    conversationId: v.id('conversations'),
    wamid: v.string(),
    productRetailerId: v.string(),
    createdAt: v.number(),
  })
    .index('by_wamid', ['wamid'])
    .index('by_conversation', ['conversationId', 'createdAt']),

  /** Catálogos de WhatsApp (Meta). Se configuran desde el front; sin env vars. */
  whatsappCatalogs: defineTable({
    name: v.string(),
    /** ID del catálogo en Meta/WhatsApp (ej. 1560075992300705). */
    whatsappCatalogId: v.string(),
    /** Si true, se usa cuando no coincide ninguna ubicación (ej. "Todas las unidades"). */
    isDefault: v.optional(v.boolean()),
    /** Si la ubicación del usuario contiene esta palabra, se usa este catálogo (ej. "tolima"). */
    locationKeyword: v.optional(v.string()),
    order: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_location_keyword', ['locationKeyword'])
    .index('by_is_default', ['isDefault']),

  /** Relación N-N: una finca puede estar en varios catálogos; cada entrada guarda el product_retailer_id en ese catálogo. */
  propertyWhatsAppCatalog: defineTable({
    propertyId: v.id('properties'),
    catalogId: v.id('whatsappCatalogs'),
    /** ID del producto (finca) en ese catálogo en Meta (identificador de contenido). */
    productRetailerId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property', ['propertyId'])
    .index('by_catalog', ['catalogId'])
    .index('by_property_and_catalog', ['propertyId', 'catalogId']),

  // Tabla de reseñas
  reviews: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.optional(v.id('bookings')),
    userId: v.optional(v.string()),
    rating: v.number(),
    comment: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property', ['propertyId'])
    .index('by_booking', ['bookingId'])
    .index('by_user', ['userId']),

  /** Orden manual de propiedades por cada "Tab" o categoría del front */
  tabOrders: defineTable({
    tabId: v.string(), // e.g. "melgar", "cerca-bogota", "favoritas", "todas"
    propertyIds: v.array(v.id('properties')),
    updatedAt: v.number(),
  }).index('by_tab', ['tabId']),

  /** Información legal y bancaria del propietario de la finca */
  propertyOwnerInfo: defineTable({
    propertyId: v.id('properties'),
    /** Usuario con rol 'propietario' enlazado */
    ownerUserId: v.string(),
    rutNumber: v.string(),
    bankName: v.string(),
    accountNumber: v.string(),
    rntNumber: v.string(),
    /** URLs de documentos cargados (PDF) */
    bankCertificationUrl: v.optional(v.string()),
    idCopyUrl: v.optional(v.string()),
    rntPdfUrl: v.optional(v.string()),
    chamberOfCommerceUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property', ['propertyId'])
    .index('by_owner', ['ownerUserId']),

  // Tabla para gestionar el contenido de la página "¿Quiénes Somos?"
  quienes_somos: defineTable({
    queEsFincasYa: v.string(),
    mision: v.string(),
    vision: v.string(),
    objetivos: v.union(v.string(), v.array(v.string())),
    politicas: v.union(v.string(), v.array(v.string())),
    trayectoriaTitle: v.string(),
    trayectoriaParagraphs: v.string(),
    stats: v.array(
      v.object({
        label: v.string(),
        value: v.string(),
      }),
    ),
    recognitionTitle: v.string(),
    recognitionSubtitle: v.string(),
    presenciaInstitucional: v.string(),
    carouselImages: v.optional(v.array(v.string())),
    videoUrl: v.optional(v.string()),
    videoTitle: v.optional(v.string()),
    videoDescription: v.optional(v.string()),
    videoBadge: v.optional(v.string()),
    updatedAt: v.number(),
  }),

  /** Contenido editable para páginas internas (blog, centro-de-ayuda, contacto, etc.) */
  internalPages: defineTable({
    pageId: v.string(),
    content: v.any(),
    updatedAt: v.number(),
  }).index('by_pageId', ['pageId']),

  // Integración con Google Calendar (Tokens y configuración)
  googleCalendarIntegrations: defineTable({
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    calendarId: v.optional(v.string()),
    connected: v.boolean(),
    connectedEmail: v.optional(v.string()),
    connectedName: v.optional(v.string()),
    needsReauth: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  /** Gestión de encargados contables */
  accountingManagers: defineTable({
    name: v.string(),
    idNumber: v.string(),
    idIssuancePlace: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    bankName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_idNumber', ['idNumber']),

  /**
   * Sesiones del bot FSM (estado + entidades por conversación).
   * Cada conversación tiene como máximo una sesión activa.
   */
  botSessions: defineTable({
    conversationId: v.id('conversations'),
    /** E.164 del cliente (para lookup rápido sin JOIN). */
    phone: v.string(),
    /**
     * Fase actual del FSM:
     * new → collecting → catalog_sent → pet_check → contract → done (quote_shown legado)
     */
    phase: v.string(),
    entities: v.object({
      location: v.optional(v.string()),
      checkIn: v.optional(v.string()),
      checkOut: v.optional(v.string()),
      cupo: v.optional(v.number()),
      isEvento: v.optional(v.boolean()),
      planType: v.optional(v.string()),
      excludedRegions: v.optional(v.array(v.string())),
      selectedPropertyRetailerId: v.optional(v.string()),
      selectedPropertyName: v.optional(v.string()),
      catalogUserPickedReply: v.optional(v.boolean()),
      puenteAcknowledged: v.optional(v.boolean()),
      hasPets: v.optional(v.boolean()),
      petCount: v.optional(v.number()),
      eventPeopleCount: v.optional(v.number()),
      eventLogistics: v.optional(v.string()),
      contractName: v.optional(v.string()),
      contractCedula: v.optional(v.string()),
      contractEmail: v.optional(v.string()),
      contractPhone: v.optional(v.string()),
      contractAddress: v.optional(v.string()),
    }),
    turnCount: v.number(),
    /** Timestamp en que se entró a la fase actual (para detectar bucles). */
    phaseEnteredAt: v.optional(v.number()),
    /** Turnos consecutivos en la misma fase sin avanzar. */
    samePhaseTurnCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_phone', ['phone']),

  // Permisos por rol
  rolePermissions: defineTable({
    role: v.string(),
    module: v.string(),
    permissions: v.array(v.string()),
    isCustom: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index('by_role', ['role'])
    .index('by_role_module', ['role', 'module']),
});
