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
    /** Departamentos de Colombia donde se ubica o comercializa la finca (multi-select). */
    departamentos: v.optional(v.array(v.string())),
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
    /**
     * Si false, la finca no se incluye cuando el bot envía catálogos por Meta/WhatsApp.
     * Sigue visible en la web pero solo como ficha informativa (sin reserva en línea).
     */
    visibleInWhatsAppCatalog: v.optional(v.boolean()),
    /** Si true, aparece en /marketplace (fincas en venta) y el detalle ofrece contacto por WhatsApp. */
    marketplaceForSale: v.optional(v.boolean()),
    /** Valor de venta de referencia en COP (marketplace). */
    salePriceCop: v.optional(v.number()),
    /** Metros cuadrados construidos o del lote (marketplace / modo venta). */
    saleSquareMeters: v.optional(v.number()),
    /** Descripción comercial para venta (distinta del texto de arriendo). */
    saleDescription: v.optional(v.string()),
    /** URL de la plantilla del contrato en PDF. */
    contractTemplateUrl: v.optional(v.string()),
    /**
     * Datos de contacto del propietario y del encargado de la finca (spec §6).
     * El encargado es una persona distinta del propietario que también recibe
     * comunicaciones (recordatorios de llegada). Teléfonos en formato E.164.
     */
    propietarioNombre: v.optional(v.string()),
    /** Tratamiento para el saludo en mensajes: 'Sr' | 'Sra'. */
    propietarioTratamiento: v.optional(v.string()),
    propietarioTelefono: v.optional(v.string()),
    propietarioCedula: v.optional(v.string()),
    propietarioCorreo: v.optional(v.string()),
    encargadoNombre: v.optional(v.string()),
    encargadoTelefono: v.optional(v.string()),
    /** Reglas de salida (check-out) específicas de esta finca. Override del texto global. */
    checkoutRulesText: v.optional(v.string()),
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
    /**
     * Si true (por defecto), el check-in exige listado de invitados para el
     * propietario y el turista. Algunas fincas no requieren ese listado.
     */
    requiresGuestList: v.optional(v.boolean()),
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
    /**
     * Auxilio de aseo final (COP), cobro único por estadía. Se incluye en la
     * descripción, chat y precarga de contratos.
     */
    depositoAseo: v.optional(v.number()),
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
    /** Fecha de emisión del contrato / confirmación (yyyy-MM-dd). */
    issueDate: v.optional(v.string()),
    /**
     * Novedades económicas: incrementos o descuentos sobre el valor base
     * (alquiler + limpieza + depósito). precioTotal = base + ajustes.
     */
    economicAdjustments: v.optional(
      v.array(
        v.object({
          id: v.string(),
          date: v.string(),
          description: v.string(),
          amount: v.number(),
          type: v.union(v.literal('INCREMENT'), v.literal('DISCOUNT')),
          createdBy: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    ),
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
    /** Reserva originada en un link de venta (/venta/:token). */
    saleLinkId: v.optional(v.id('saleLinks')),
    /** El propietario aceptó el valor ofrecido en /anfitrion. */
    ownerOfferAcceptedAt: v.optional(v.number()),
    /** El propietario rechazó la oferta en /anfitrion. */
    ownerOfferRejectedAt: v.optional(v.number()),
    ownerOfferRejectedReason: v.optional(v.string()),
    /** Observación del propietario sin rechazar (sigue pendiente). */
    ownerOfferComment: v.optional(v.string()),
    ownerOfferCommentAt: v.optional(v.number()),
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
    /**
     * Etiqueta/código que reemplaza el prefijo "Reserva:" en el título del
     * evento de Google Calendar. Si está vacío, no se antepone nada.
     */
    calendarLabel: v.optional(v.string()),
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
    /**
     * Check-in del turista completado (spec §4/§5). Lo marca el portal de
     * check-in o el equipo (check-in manual). Se usa para filtrar a quién
     * recordarle el check-in pendiente (no molestar a quien ya lo hizo).
     */
    checkinCompleted: v.optional(v.boolean()),
    checkinCompletedAt: v.optional(v.number()),
    /**
     * Override manual del equipo: si es true, la lista de invitados se puede
     * editar aunque ya esté dentro de la ventana de bloqueo (24/12 h antes).
     */
    guestListUnlocked: v.optional(v.boolean()),
    /**
     * Marca manual: el equipo envió el check-in al cliente (ej. copió el
     * mensaje). Lleva la reserva a la etapa "morado / check-in enviado" en
     * el semáforo del calendario, sin esperar un envío automático.
     */
    checkinSentManualAt: v.optional(v.number()),
    /**
     * Lista de invitados que ingresan, capturada por el turista en el portal
     * público de check-in (`/checkin/:reference`). Cada persona mayor de 2 años
     * lleva nombre completo + cédula; los menores de 2 años se marcan con
     * `esMenor` y no requieren cédula. Se permite guardado parcial (el turista
     * puede llenar unos hoy y los demás otro día con el mismo link).
     */
    checkinGuests: v.optional(
      v.array(
        v.object({
          nombreCompleto: v.string(),
          /** Número de documento (cédula, TI, pasaporte, etc.). */
          cedula: v.optional(v.string()),
          /** Tipo de documento: CC, TI, RC, CE o PA. Por defecto CC en datos antiguos. */
          tipoDocumento: v.optional(v.string()),
          esMenor: v.optional(v.boolean()),
        }),
      ),
    ),
    /** El turista indicó que necesita empleada de servicio (portal de check-in). */
    checkinNeedsEmpleada: v.optional(v.boolean()),
    /** El turista indicó que necesita team (portal de check-in). */
    checkinNeedsTeam: v.optional(v.boolean()),
    /** Nota libre opcional sobre servicios (cantidad, horario, etc.). */
    checkinServiciosNota: v.optional(v.string()),
    /** Menores de 2 años (no cuentan para cupo ni van en `checkinGuests`). */
    checkinMenoresDe2: v.optional(v.number()),
    /** Mascotas indicadas/confirmadas por el huésped en el portal de check-in (0 = no van). */
    checkinMascotas: v.optional(v.number()),
    /** Placas de vehículos indicadas en el portal de check-in. */
    checkinPlacas: v.optional(v.string()),
    /** Solicitudes especiales del huésped en el portal de check-in. */
    checkinObservaciones: v.optional(v.string()),
    /** Consentimiento habeas data (Ley 1581) en el envío final del check-in. */
    checkinAceptaDatos: v.optional(v.boolean()),
    /** Última vez que el turista guardó avance o envió su check-in. */
    checkinUpdatedAt: v.optional(v.number()),
    /**
     * Check-out propietario (Fase 1). Observaciones/peticiones del cliente que el
     * equipo edita y comparte con el propietario; con log de cambios (quién/cuándo).
     */
    clientObservaciones: v.optional(v.string()),
    clientObservacionesUpdatedAt: v.optional(v.number()),
    clientObservacionesLog: v.optional(
      v.array(
        v.object({
          valor: v.string(),
          actor: v.string(),
          ts: v.number(),
        }),
      ),
    ),
    /**
     * Persona que recibe a los turistas el día de la llegada. La diligencia el
     * propietario desde su enlace público; el equipo la ve en el panel.
     */
    ownerReceiver: v.optional(
      v.object({
        nombre: v.optional(v.string()),
        contacto: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
      }),
    ),
    /** Qué ve el propietario en /anfitrion/{ref} (lo configura el equipo admin). */
    ownerPortalShare: v.optional(
      v.object({
        showGuestList: v.optional(v.boolean()),
        showPlates: v.optional(v.boolean()),
        showEmpleada: v.optional(v.boolean()),
        showInternalNotes: v.optional(v.boolean()),
      }),
    ),
    /** Pago al propietario (check-out del propietario). */
    ownerPayout: v.optional(
      v.object({
        /** Valor total acordado con el propietario por esta reserva. */
        valorAcordado: v.optional(v.number()),
        /** Abono ya pagado al propietario. El saldo = valorAcordado - abono. */
        abono: v.optional(v.number()),
        valor: v.optional(v.number()),
        fecha: v.optional(v.string()),
        medio: v.optional(v.string()),
        comprobanteUrl: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
        /** Abonos individuales al propietario (cada fila del reporte). */
        abonos: v.optional(
          v.array(
            v.object({
              id: v.string(),
              amount: v.number(),
              fecha: v.optional(v.string()),
              medio: v.optional(v.string()),
              comprobanteUrl: v.optional(v.string()),
              createdAt: v.number(),
              actor: v.optional(v.string()),
            }),
          ),
        ),
        log: v.optional(
          v.array(
            v.object({
              accion: v.string(),
              actor: v.string(),
              ts: v.number(),
            }),
          ),
        ),
      }),
    ),
    /**
     * Cuadro de rendimientos admin: casillas manuales (pagó, llegó, etc.).
     * true = sí, false = no, omitido = sin marcar.
     */
    reconciliationSheet: v.optional(
      v.object({
        turistaPago: v.optional(v.boolean()),
        turistaLlego: v.optional(v.boolean()),
        propietarioPago: v.optional(v.boolean()),
        checkinListo: v.optional(v.boolean()),
        notas: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
        updatedBy: v.optional(v.string()),
      }),
    ),
    /**
     * Check-out del cliente (Fase 2+): devolución del depósito. Estado de la
     * validación + cuenta bancaria registrada por el cliente para la devolución.
     */
    depositReturn: v.optional(
      v.object({
        // pendiente_validacion | aprobado | rechazado | en_revision | devuelto
        estado: v.optional(v.string()),
        cuenta: v.optional(
          v.object({
            titular: v.optional(v.string()),
            tipo: v.optional(v.string()),
            numero: v.optional(v.string()),
            banco: v.optional(v.string()),
            documento: v.optional(v.string()),
            observaciones: v.optional(v.string()),
          }),
        ),
        /** Validación del propietario (admin en su nombre o el propietario por su enlace). */
        aprobacion: v.optional(
          v.object({
            por: v.optional(v.string()), // 'admin' | 'propietario'
            nombre: v.optional(v.string()),
            ts: v.optional(v.number()),
          }),
        ),
        /** Retención (rechazo o devolución parcial). */
        retencion: v.optional(
          v.object({
            motivo: v.optional(v.string()),
            obsPropietario: v.optional(v.string()),
            valorRetenido: v.optional(v.number()),
            evidencias: v.optional(v.array(v.string())),
          }),
        ),
        /** Registro del pago de devolución al cliente. */
        devolucion: v.optional(
          v.object({
            valor: v.optional(v.number()),
            fecha: v.optional(v.string()),
            medio: v.optional(v.string()),
            numTransaccion: v.optional(v.string()),
            observaciones: v.optional(v.string()),
            comprobanteUrl: v.optional(v.string()),
            registradoPor: v.optional(v.string()),
            ts: v.optional(v.number()),
          }),
        ),
        updatedAt: v.optional(v.number()),
        log: v.optional(
          v.array(
            v.object({
              accion: v.string(),
              actor: v.string(),
              ts: v.number(),
            }),
          ),
        ),
      }),
    ),
    /**
     * Portal público de pago (`/pago/:reference`): cuentas seleccionadas por el
     * equipo para mostrar al cliente en el link compartido.
     */
    paymentPortalConfig: v.optional(
      v.object({
        bankAccountIds: v.array(v.string()),
        paymentMediaIds: v.optional(v.array(v.string())),
        /**
         * Cuentas propias de ESTA reserva (importadas de un propietario). No están en
         * el catálogo global; solo afectan a esta reserva. Se resuelven junto al
         * catálogo global filtrando por bankAccountIds.
         */
        extraBankAccounts: v.optional(
          v.array(
            v.object({
              id: v.string(),
              bankName: v.string(),
              accountType: v.optional(v.string()),
              accountNumber: v.string(),
              ownerName: v.string(),
              ownerCedula: v.optional(v.string()),
              imageUrl: v.optional(v.string()),
              imageUrls: v.optional(v.array(v.string())),
              qrOnly: v.optional(v.boolean()),
              brebKey: v.optional(v.boolean()),
            }),
          ),
        ),
        /** Link de pago Bold (tarjeta de crédito) para esta reserva. */
        boldLink: v.optional(v.string()),
        /** Recargo % informativo junto al link de Bold (ej. 5). */
        boldSurcharge: v.optional(v.number()),
        updatedAt: v.number(),
      }),
    ),
    /** Soportes de pago subidos por el cliente desde el portal público. */
    paymentPortalReceipts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          bankAccountId: v.optional(v.string()),
          bankName: v.optional(v.string()),
          amount: v.optional(v.number()),
          receiptUrl: v.string(),
          fileName: v.optional(v.string()),
          mimeType: v.optional(v.string()),
          status: v.union(
            v.literal('pending'),
            v.literal('approved'),
            v.literal('rejected'),
          ),
          submittedAt: v.number(),
          /** Revisión por el admin/representante legal. */
          reviewedAt: v.optional(v.number()),
          reviewedBy: v.optional(v.string()),
          /** Monto verificado al aprobar (puede diferir del reportado). */
          reviewedAmount: v.optional(v.number()),
          /** Motivo cuando status === 'rejected'. */
          rejectReason: v.optional(v.string()),
        }),
      ),
    ),
    /**
     * True si la reserva tiene algún soporte de pago PENDIENTE de revisar
     * (`paymentPortalReceipts` con status pending). Indexado para listar la
     * cola de revisión sin escanear toda la tabla.
     */
    hasPendingReceipt: v.optional(v.boolean()),
    /**
     * Etiqueta libre para agrupar reservas en envíos en lote (spec §10),
     * p. ej. "puente_festivo".
     */
    broadcastTag: v.optional(v.string()),
    /**
     * Bitácora de mensajes programados ya enviados, para dedupe por momento
     * del timeline (spec §3) y trazabilidad. `key` es la clave del momento
     * (ej. "tourist_checkin_start"), `recipient` el teléfono destino.
     */
    scheduledMessages: v.optional(
      v.array(
        v.object({
          key: v.string(),
          recipient: v.string(),
          sentAt: v.number(),
          wamid: v.optional(v.string()),
          status: v.optional(v.string()),
        }),
      ),
    ),
  })
    .index('by_property', ['propertyId'])
    .index('by_status', ['status'])
    .index('by_cedula', ['cedula'])
    .index('by_reference', ['reference'])
    .index('by_is_direct', ['isDirect'])
    .index('by_user', ['userId'])
    .index('by_dates', ['fechaEntrada', 'fechaSalida'])
    .index('by_pending_receipt', ['hasPendingReceipt']),

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

  /**
   * Registro unificado de contratos (Gestor de Contratos). Una fila por
   * `contractNumber`. Se hace upsert al generar/avanzar el contrato y se puede
   * reconstruir con `contracts:backfill` a partir de las fuentes históricas.
   */
  contracts: defineTable({
    contractNumber: v.string(),
    propertyId: v.optional(v.id('properties')),
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    clienteNombre: v.optional(v.string()),
    clienteCedula: v.optional(v.string()),
    clienteEmail: v.optional(v.string()),
    clienteTelefono: v.optional(v.string()),
    clienteCiudad: v.optional(v.string()),
    clienteDireccion: v.optional(v.string()),
    firmanteNombre: v.optional(v.string()),
    firmanteCedula: v.optional(v.string()),
    valorTotal: v.optional(v.number()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    pdfFilename: v.optional(v.string()),
    /** PDF de confirmación de reserva (solo tras confirmar pago). */
    confirmationPdfUrl: v.optional(v.string()),
    confirmationPdfFilename: v.optional(v.string()),
    /** borrador | generado | enviado | completado | pagado | expirado | anulado */
    estado: v.string(),
    /** admin = Contratos y Confirmación (solo contrato); link | inbox; confirmacion = pago confirmado */
    origen: v.optional(v.string()),
    bookingId: v.optional(v.id('bookings')),
    fillTokenId: v.optional(v.id('contractFillTokens')),
    /** Datos del contrato (form) serializados, para reabrir/editar. */
    draftJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_contract_number', ['contractNumber'])
    .index('by_status', ['estado'])
    .index('by_created', ['createdAt'])
    .index('by_property', ['propertyId']),

  /**
   * Ajustes de notificaciones administrables desde el admin. Un documento por
   * deployment (`scope === 'global'`). `payload` libre, p. ej.
   * `{ paymentReceiptEmails: string[] }` (correos que reciben la alerta de
   * soportes de pago).
   */
  notificationSettings: defineTable({
    scope: v.literal('global'),
    payload: v.any(),
    updatedAt: v.number(),
  }).index('by_scope', ['scope']),

  /** Ajustes globales de plataforma (p. ej. interruptor maestro de IA). */
  platformSettings: defineTable({
    scope: v.literal('global'),
    /** Legacy: activa/desactiva ambos canales si no hay toggles por canal. */
    aiEnabled: v.boolean(),
    webAiEnabled: v.optional(v.boolean()),
    whatsappAiEnabled: v.optional(v.boolean()),
    updatedAt: v.number(),
    updatedByUserId: v.optional(v.string()),
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
    /**
     * Dirección de residencia (cuando el cliente la dio en el contrato). Se
     * usa para auto-enriquecer el contacto en el CRM cuando el bot completa
     * el paquete de datos del contrato (vía `contacts.upsertFromContractData`).
     */
    address: v.optional(v.string()),
    /** Lead: en seguimiento. Cliente: ya con reserva o relación comercial. */
    crmType: v.optional(v.union(v.literal('lead'), v.literal('client'))),
    lastReservationAt: v.optional(v.number()),
    /**
     * Consentimiento de tratamiento de datos (Ley 1581) recogido por WhatsApp
     * vía la plantilla `tratamiento_de_datos`. Solo se pide UNA vez por usuario:
     *   - `undefined`: nunca se ha pedido / sin respuesta todavía.
     *   - `granted`: el usuario respondió "Sí, autorizo" → el bot puede operar.
     *   - `denied`: respondió "No autorizo" → el bot queda en pausa.
     */
    dataConsentStatus: v.optional(
      v.union(v.literal('granted'), v.literal('denied')),
    ),
    /** Momento (ms) en que el usuario respondió a la solicitud de consentimiento. */
    dataConsentAt: v.optional(v.number()),
    /**
     * Momento (ms) del último envío de la plantilla de consentimiento. Evita
     * reenviarla en bucle si el usuario escribe varias veces antes de responder.
     */
    dataConsentRequestedAt: v.optional(v.number()),
    /**
     * Nombre BASE del contacto (el original del perfil de WhatsApp / panel).
     * Se preserva cuando `name` se enriquece con el contexto del deal en
     * curso. Si está vacío, el name no se ha enriquecido todavía.
     */
    baseName: v.optional(v.string()),
    /**
     * Etiqueta de deal pegada al nombre cuando el bot ya tiene contexto
     * comercial significativo: finca elegida + cupo (+ fechas). Ej.:
     * "Quinta Montebello · 15pax · 07-08→10-08". El inbox lo muestra así:
     * `name = baseName + " · " + dealLabel`. Cuando se cierra el deal se
     * limpia y `crmType` pasa a 'client'.
     */
    dealLabel: v.optional(v.string()),
    /** Fecha de nacimiento (ISO yyyy-MM-dd), capturada en check-in. */
    fechaNacimiento: v.optional(v.string()),
    /** Fotos de cédula subidas desde el link de contrato (frente/reverso). */
    cedulaPhotoUrls: v.optional(v.array(v.string())),
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
    /** Última vez que un asesor abrió/marcó leída la conversación en inbox. */
    inboxLastReadAt: v.optional(v.number()),
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
    /** wamid de WhatsApp (mensajes salientes) para actualizar estado vía webhook. */
    wamid: v.optional(v.string()),
    /**
     * Estado de entrega/lectura en WhatsApp (solo mensajes `assistant` enviados por WA).
     * Orden: accepted → sent → delivered → read.
     */
    whatsappStatus: v.optional(
      v.union(
        v.literal('failed'),
        v.literal('accepted'),
        v.literal('sent'),
        v.literal('delivered'),
        v.literal('read'),
      ),
    ),
    /** Oculto en inbox (eliminar). */
    deletedAt: v.optional(v.number()),
    /** Última edición del contenido. */
    editedAt: v.optional(v.number()),
  })
    .index('by_conversation', ['conversationId', 'createdAt'])
    .index('by_wamid', ['wamid']),

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

  /** Historial de inicio/cierre de sesión en el panel admin. */
  adminSessionLogs: defineTable({
    userId: v.string(),
    userEmail: v.string(),
    userName: v.optional(v.string()),
    role: v.optional(v.string()),
    loginAt: v.number(),
    logoutAt: v.optional(v.number()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index('by_loginAt', ['loginAt'])
    .index('by_user_loginAt', ['userId', 'loginAt']),

  ycloudProcessedEvents: defineTable({
    eventId: v.string(),
  }).index('by_event_id', ['eventId']),

  /** Evita que el bot procese dos veces el mismo inbound (YCloud reintenta con otro eventId). */
  ycloudInboundBotClaims: defineTable({
    claimKey: v.string(),
    createdAt: v.number(),
  }).index('by_claim_key', ['claimKey']),

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

  /**
   * Solicitudes de Habeas Data (Ley 1581 Colombia).
   * Cada registro es una petición de un titular para ejercer sus derechos
   * ARCO (Acceso, Rectificación, Cancelación, Oposición) o revocatoria.
   *
   * Plazos legales:
   * - Consultas: 10 días hábiles + 5 prorrogables
   * - Reclamos: 15 días hábiles + 8 prorrogables
   */
  habeasDataRequests: defineTable({
    /** Nombre completo del titular como aparece en el documento. */
    fullName: v.string(),
    /** Tipo de documento: CC, CE, PA, NIT, OTRO. */
    documentType: v.string(),
    documentNumber: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    /** acceso | rectificacion | cancelacion | oposicion | revocatoria | queja */
    requestType: v.string(),
    description: v.string(),
    /** Estado interno: pending | in_review | resolved | rejected. */
    status: v.string(),
    /** Notas internas del equipo (no se muestran al titular). */
    internalNotes: v.optional(v.string()),
    /** Fecha en la que se respondió formalmente al titular (ISO). */
    resolvedAt: v.optional(v.number()),
    /** IP del solicitante (auditoría — anonimizable). */
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_email', ['email'])
    .index('by_created', ['createdAt']),

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
    /** Cuentas bancarias adicionales del propietario (la primera también se refleja en bankName/accountNumber). */
    bankAccounts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          bankName: v.string(),
          accountNumber: v.string(),
          accountType: v.optional(v.string()),
          /** Persona titular de la cuenta (puede ser distinta al propietario de la finca). */
          accountHolderName: v.optional(v.string()),
        }),
      ),
    ),
    rntNumber: v.string(),
    /** Datos de contacto del propietario (registro manual, sin usuario vinculado) */
    propietarioNombre: v.optional(v.string()),
    /** Tratamiento para el saludo en mensajes: 'Sr' | 'Sra'. */
    propietarioTratamiento: v.optional(v.string()),
    propietarioTelefono: v.optional(v.string()),
    propietarioCedula: v.optional(v.string()),
    propietarioCorreo: v.optional(v.string()),
    /** Link de Google Maps — solo check-in; no se usa en catálogo ni GPS público. */
    checkinUbicacionUrl: v.optional(v.string()),
    /** Link de Waze — solo check-in; no se usa en catálogo ni GPS público. */
    checkinWazeUrl: v.optional(v.string()),
    /** Indicaciones textuales de llegada (colores, portón, referencias). Solo check-in. */
    checkinIndicacionesLlegada: v.optional(v.string()),
    /** Recomendaciones de la finca (normas, cuidados, tips). Solo check-in. */
    checkinRecomendaciones: v.optional(v.string()),
    /** Foto/mapa de referencia para llegada (legacy: primera imagen). Solo check-in. */
    checkinUbicacionImageUrl: v.optional(v.string()),
    /** Fotos/mapas de referencia para llegada, en orden. Solo check-in. */
    checkinUbicacionImageUrls: v.optional(v.array(v.string())),
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
    /**
     * Alertas (`alertReason`) que YA se dispararon en esta sesión. Garantiza
     * idempotencia de `flagPriorityAlert`: la misma alerta no se vuelve a
     * lanzar aunque el cliente vuelva a hacer match (ej. mismo cliente con
     * estadía larga turno tras turno → alerta sola UNA vez).
     */
    firedAlerts: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_phone', ['phone']),

  /** Contador de vistas del sitio público (dashboard admin). */
  siteAnalytics: defineTable({
    metricKey: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  }).index('by_metricKey', ['metricKey']),

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

  /**
   * Tokens de push notifications de la app móvil. Un usuario puede tener
   * varios (un dispositivo por instalación).
   */
  pushTokens: defineTable({
    /** Better Auth user id (identity.subject) */
    userId: v.string(),
    /** ExponentPushToken[...] */
    token: v.string(),
    platform: v.optional(v.union(v.literal('ios'), v.literal('android'))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_token', ['token']),

  /**
   * Tokens de autorrelleno de contrato: el asesor genera el link, el cliente
   * entra y llena sus datos sin necesidad de escribirlos por WhatsApp turno a
   * turno. Token UUID único, expira en 48 h.
   */
  contractFillTokens: defineTable({
    /** Token UUID aleatorio que va en la URL pública. */
    token: v.string(),
    /** Solo links generados desde el inbox; los de admin no tienen conversación. */
    conversationId: v.optional(v.id('conversations')),
    /** inbox = chat WhatsApp; admin = módulo Link de Contrato. */
    source: v.optional(
      v.union(v.literal('inbox'), v.literal('admin')),
    ),
    /** Borrador del contrato (form admin sin datos del cliente) serializado JSON. */
    contractDraftJson: v.optional(v.string()),
    /** Snapshot de ajustes globales del contrato al crear el link. */
    contractSettingsJson: v.optional(v.string()),
    /** Metadatos de la finca (título, features, propietario, etc.). */
    propertyMetaJson: v.optional(v.string()),
    /** Datos del deal precargados en el form (para mostrarle al cliente). */
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    cupo: v.optional(v.number()),
    precioTotal: v.optional(v.number()),
    /** Unix ms de expiración (default 48 h). */
    expiresAt: v.number(),
    /** pending = esperando al cliente; filled = datos recibidos; expired = fuera de tiempo. */
    status: v.union(
      v.literal('pending'),
      v.literal('filled'),
      v.literal('expired'),
    ),
    /** Datos enviados por el cliente cuando status = filled. */
    filledData: v.optional(
      v.object({
        nombre: v.string(),
        cedula: v.string(),
        email: v.string(),
        telefono: v.string(),
        direccion: v.string(),
        ciudad: v.optional(v.string()),
        cedulaPhotoUrls: v.optional(v.array(v.string())),
        filledAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_conversation', ['conversationId']),

  /**
   * Links de venta: el vendedor crea un link con la negociación y lo comparte
   * con el cliente. El cliente completa el flujo por pasos (stepper):
   * 1-Resumen → 2-Datos+Soporte → 3-En revisión → 4-Contrato → 5-CR → 6-Check-in.
   * Al completar el paso 5 se crea la reserva (booking) automáticamente.
   */
  saleLinks: defineTable({
    /** Token UUID aleatorio que va en la URL pública /venta/:token */
    token: v.string(),
    /** Codificación manual (CR / número de contrato) definida al crear el link */
    contractCode: v.optional(v.string()),
    /** Finca seleccionada */
    propertyId: v.id('properties'),
    /** Better Auth userId del vendedor/admin que creó el link */
    createdBy: v.string(),
    /** Nombre visible del vendedor */
    createdByName: v.optional(v.string()),
    /** Fecha de entrada (Unix ms) */
    checkIn: v.number(),
    /** Fecha de salida (Unix ms) */
    checkOut: v.number(),
    /** Número de noches */
    nights: v.number(),
    /** Número de personas */
    guests: v.number(),
    /** Hora de entrada, ej: "15:00" */
    checkInTime: v.optional(v.string()),
    /** Hora de salida, ej: "11:00" */
    checkOutTime: v.optional(v.string()),
    /** Valor total acordado (todo incluido) */
    totalValue: v.number(),
    /** Subtotal alquiler */
    rentalValue: v.number(),
    /** Depósito de garantía reembolsable */
    depositAmount: v.number(),
    /** Aseo/limpieza */
    cleaningFee: v.number(),
    /** Depósito mascotas */
    petDeposit: v.optional(v.number()),
    /** Recargo mascotas */
    petSurcharge: v.optional(v.number()),
    /** Número de mascotas */
    petCount: v.optional(v.number()),
    /** IDs de cuentas bancarias del catálogo global seleccionadas para este deal */
    selectedBankAccountIds: v.array(v.string()),
    /** Notas de negociación (solo visibles para el vendedor) */
    notes: v.optional(v.string()),
    /** Paso actual del cliente (1-6). Empieza en 1. */
    clientStep: v.number(),
    /** Paso UI del portal antes de enviar comprobante (p. ej. 2 = mis datos). */
    clientPortalUiStep: v.optional(v.number()),
    /** Sub-fase del paso 2: datos personales o soporte de pago. */
    clientDraftPhase: v.optional(
      v.union(v.literal('datos'), v.literal('pago')),
    ),
    /** Monto de anticipo en borrador (paso 2). */
    clientDraftPaymentAmount: v.optional(v.number()),
    /** Estado general */
    status: v.union(
      v.literal('active'),
      v.literal('completed'),
      v.literal('cancelled'),
    ),
    /** Datos personales llenados por el cliente (paso 2) */
    clientData: v.optional(
      v.object({
        nombre: v.string(),
        cedula: v.string(),
        email: v.string(),
        telefono: v.string(),
        direccion: v.string(),
        ciudad: v.optional(v.string()),
        fechaNacimiento: v.optional(v.string()),
        cedulaPhotoUrl: v.optional(v.string()),
        cedulaPhotoFileName: v.optional(v.string()),
        cedulaPhotoMimeType: v.optional(v.string()),
        filledAt: v.number(),
      }),
    ),
    /** URL S3 del soporte de pago subido por el cliente */
    paymentProofUrl: v.optional(v.string()),
    paymentProofFileName: v.optional(v.string()),
    paymentProofMimeType: v.optional(v.string()),
    paymentProofAmount: v.optional(v.number()),
    paymentProofSubmittedAt: v.optional(v.number()),
    /** Historial de comprobantes (permite varios soportes antes de validar el pago) */
    paymentProofs: v.optional(
      v.array(
        v.object({
          url: v.string(),
          fileName: v.optional(v.string()),
          mimeType: v.optional(v.string()),
          amount: v.optional(v.number()),
          submittedAt: v.number(),
        }),
      ),
    ),
    /** Token secreto de un solo uso para validar el pago desde el email */
    paymentValidationKey: v.optional(v.string()),
    /** Pago validado por el admin */
    paymentValidated: v.optional(v.boolean()),
    paymentValidatedAt: v.optional(v.number()),
    paymentValidatedBy: v.optional(v.string()),
    /** URL S3 del contrato PDF generado */
    contractUrl: v.optional(v.string()),
    contractGeneratedAt: v.optional(v.number()),
    /** URL S3 del contrato firmado subido por el cliente */
    signedContractUrl: v.optional(v.string()),
    signedContractFileName: v.optional(v.string()),
    signedContractSubmittedAt: v.optional(v.number()),
    /** URL S3 del documento CR (Confirmación de Reserva) */
    crUrl: v.optional(v.string()),
    crGeneratedAt: v.optional(v.number()),
    /** ID de la reserva creada automáticamente al confirmar el CR */
    bookingId: v.optional(v.id('bookings')),
    /** Valor de arriendo acordado con el propietario (paso 7 admin). */
    ownerOfferAmount: v.optional(v.number()),
    /** Cuándo el equipo envió la oferta al propietario por WhatsApp. */
    ownerOfferSentAt: v.optional(v.number()),
    /** Cuándo el propietario aceptó la oferta en /anfitrion. */
    ownerOfferAcceptedAt: v.optional(v.number()),
    ownerOfferRejectedAt: v.optional(v.number()),
    ownerOfferRejectedReason: v.optional(v.string()),
    ownerOfferComment: v.optional(v.string()),
    ownerOfferCommentAt: v.optional(v.number()),
    /** Lista de huéspedes (paso 6 check-in) */
    checkinGuests: v.optional(
      v.array(
        v.object({
          nombreCompleto: v.string(),
          cedula: v.optional(v.string()),
          tipoDocumento: v.optional(v.string()),
          esMenor: v.optional(v.boolean()),
        }),
      ),
    ),
    checkinMenoresDe2: v.optional(v.number()),
    checkinMascotas: v.optional(v.number()),
    checkinPlacas: v.optional(v.string()),
    checkinObservaciones: v.optional(v.string()),
    checkinCompleted: v.optional(v.boolean()),
    checkinCompletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_contract_code', ['contractCode'])
    .index('by_property', ['propertyId'])
    .index('by_created_by', ['createdBy'])
    .index('by_status', ['status'])
    .index('by_booking', ['bookingId']),

  // CRM-1: notas manuales del asesor sobre un contacto
  contactNotes: defineTable({
    contactId: v.id('contacts'),
    content: v.string(),
    authorUserId: v.optional(v.string()),
    authorName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_contact', ['contactId']),

  // CRM: log de envíos masivos de plantillas WhatsApp
  broadcastLogs: defineTable({
    templateKey: v.string(),
    templateName: v.string(),
    totalRequested: v.number(),
    totalSent: v.number(),
    totalFailed: v.number(),
    totalSkipped: v.number(),
    sentByUserId: v.optional(v.string()),
    bodyParams: v.optional(v.array(v.string())),
    recipients: v.array(
      v.object({
        contactId: v.id('contacts'),
        phone: v.string(),
        status: v.union(v.literal('sent'), v.literal('failed'), v.literal('skipped')),
        wamid: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  })
    .index('by_created', ['createdAt']),
});
