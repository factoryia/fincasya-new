declare const _default: import("convex/server").SchemaDefinition<{
    properties: import("convex/server").TableDefinition<import("convex/values").VObject<{
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
    }, {
        title: import("convex/values").VString<string, "required">;
        description: import("convex/values").VString<string, "required">;
        location: import("convex/values").VString<string, "required">;
        capacity: import("convex/values").VFloat64<number, "required">;
        rating: import("convex/values").VFloat64<number, "optional">;
        reviewsCount: import("convex/values").VFloat64<number, "optional">;
        video: import("convex/values").VString<string, "optional">;
        lat: import("convex/values").VFloat64<number, "required">;
        lng: import("convex/values").VFloat64<number, "required">;
        priceBase: import("convex/values").VFloat64<number, "required">;
        priceOriginal: import("convex/values").VFloat64<number, "optional">;
        priceBaja: import("convex/values").VFloat64<number, "required">;
        priceMedia: import("convex/values").VFloat64<number, "required">;
        priceAlta: import("convex/values").VFloat64<number, "required">;
        priceEspeciales: import("convex/values").VFloat64<number, "optional">;
        priceRawBase: import("convex/values").VString<string, "optional">;
        priceRawBaja: import("convex/values").VString<string, "optional">;
        priceRawMedia: import("convex/values").VString<string, "optional">;
        priceRawAlta: import("convex/values").VString<string, "optional">;
        priceRawEspeciales: import("convex/values").VString<string, "optional">;
        code: import("convex/values").VString<string, "optional">;
        slug: import("convex/values").VString<string, "optional">;
        category: import("convex/values").VUnion<"ECONOMICA" | "ESTANDAR" | "PREMIUM" | "LUJO" | "ECOTURISMO" | "CON_PISCINA" | "CERCA_BOGOTA" | "GRUPOS_GRANDES" | "VIP", [import("convex/values").VLiteral<"ECONOMICA", "required">, import("convex/values").VLiteral<"ESTANDAR", "required">, import("convex/values").VLiteral<"PREMIUM", "required">, import("convex/values").VLiteral<"LUJO", "required">, import("convex/values").VLiteral<"ECOTURISMO", "required">, import("convex/values").VLiteral<"CON_PISCINA", "required">, import("convex/values").VLiteral<"CERCA_BOGOTA", "required">, import("convex/values").VLiteral<"GRUPOS_GRANDES", "required">, import("convex/values").VLiteral<"VIP", "required">], "required", never>;
        type: import("convex/values").VUnion<"FINCA" | "CASA_CAMPESTRE" | "VILLA" | "HACIENDA" | "QUINTA" | "APARTAMENTO" | "CASA" | "CASA_PRIVADA" | "CASA_EN_CONJUNTO_CERRADO" | "VILLA_PRIVADA" | "CONDOMINIO" | "CASA_BOUTIQUE" | "YATE" | "ISLA" | "GLAMPING", [import("convex/values").VLiteral<"FINCA", "required">, import("convex/values").VLiteral<"CASA_CAMPESTRE", "required">, import("convex/values").VLiteral<"VILLA", "required">, import("convex/values").VLiteral<"HACIENDA", "required">, import("convex/values").VLiteral<"QUINTA", "required">, import("convex/values").VLiteral<"APARTAMENTO", "required">, import("convex/values").VLiteral<"CASA", "required">, import("convex/values").VLiteral<"CASA_PRIVADA", "required">, import("convex/values").VLiteral<"CASA_EN_CONJUNTO_CERRADO", "required">, import("convex/values").VLiteral<"VILLA_PRIVADA", "required">, import("convex/values").VLiteral<"CONDOMINIO", "required">, import("convex/values").VLiteral<"CASA_BOUTIQUE", "required">, import("convex/values").VLiteral<"YATE", "required">, import("convex/values").VLiteral<"ISLA", "required">, import("convex/values").VLiteral<"GLAMPING", "required">], "required", never>;
        visible: import("convex/values").VBoolean<boolean, "optional">;
        active: import("convex/values").VBoolean<boolean, "optional">;
        reservable: import("convex/values").VBoolean<boolean, "optional">;
        contractTemplateUrl: import("convex/values").VString<string, "optional">;
        isFavorite: import("convex/values").VBoolean<boolean, "optional">;
        featuredIcons: import("convex/values").VArray<import("convex/values").GenericId<"iconography">[], import("convex/values").VId<import("convex/values").GenericId<"iconography">, "required">, "optional">;
        zoneOrder: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales">, {
        by_location: ["location", "_creationTime"];
        by_capacity: ["capacity", "_creationTime"];
        by_rating: ["rating", "_creationTime"];
        by_type: ["type", "_creationTime"];
        by_category: ["category", "_creationTime"];
        by_code: ["code", "_creationTime"];
        by_slug: ["slug", "_creationTime"];
        by_createdAt: ["createdAt", "_creationTime"];
    }, {}, {}>;
    propertyImages: import("convex/server").TableDefinition<import("convex/values").VObject<{
        order?: number;
        url: string;
        propertyId: import("convex/values").GenericId<"properties">;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        url: import("convex/values").VString<string, "required">;
        order: import("convex/values").VFloat64<number, "optional">;
    }, "required", "url" | "propertyId" | "order">, {
        by_property: ["propertyId", "_creationTime"];
    }, {}, {}>;
    iconography: import("convex/server").TableDefinition<import("convex/values").VObject<{
        name?: string;
        iconUrl?: string;
        emoji?: string;
        createdAt: number;
        updatedAt: number;
    }, {
        name: import("convex/values").VString<string, "optional">;
        iconUrl: import("convex/values").VString<string, "optional">;
        emoji: import("convex/values").VString<string, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt">, {
        by_name: ["name", "_creationTime"];
    }, {}, {}>;
    propertyFeatures: import("convex/server").TableDefinition<import("convex/values").VObject<{
        iconId?: import("convex/values").GenericId<"iconography">;
        zone?: string;
        featureId?: string;
        name: string;
        propertyId: import("convex/values").GenericId<"properties">;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        name: import("convex/values").VString<string, "required">;
        iconId: import("convex/values").VId<import("convex/values").GenericId<"iconography">, "optional">;
        featureId: import("convex/values").VString<string, "optional">;
        zone: import("convex/values").VString<string, "optional">;
    }, "required", "name" | "propertyId" | "iconId" | "zone" | "featureId">, {
        by_property: ["propertyId", "_creationTime"];
        by_icon: ["iconId", "_creationTime"];
    }, {}, {}>;
    globalPricing: import("convex/server").TableDefinition<import("convex/values").VObject<{
        fechaDesde?: string;
        fechaHasta?: string;
        fechas?: string[];
        activa?: boolean;
        nombre: string;
        createdAt: number;
        updatedAt: number;
    }, {
        nombre: import("convex/values").VString<string, "required">;
        fechaDesde: import("convex/values").VString<string, "optional">;
        fechaHasta: import("convex/values").VString<string, "optional">;
        fechas: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "optional">;
        activa: import("convex/values").VBoolean<boolean, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt">, {
        by_nombre: ["nombre", "_creationTime"];
    }, {}, {}>;
    propertyPricing: import("convex/server").TableDefinition<import("convex/values").VObject<{
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
        createdAt: number;
        updatedAt: number;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        globalRuleId: import("convex/values").VId<import("convex/values").GenericId<"globalPricing">, "optional">;
        nombre: import("convex/values").VString<string, "required">;
        fechaDesde: import("convex/values").VString<string, "optional">;
        fechaHasta: import("convex/values").VString<string, "optional">;
        fechas: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "optional">;
        valorUnico: import("convex/values").VFloat64<number, "optional">;
        condiciones: import("convex/values").VString<string, "optional">;
        activa: import("convex/values").VBoolean<boolean, "optional">;
        reglas: import("convex/values").VString<string, "optional">;
        order: import("convex/values").VFloat64<number, "optional">;
        subReglasCapacidad: import("convex/values").VArray<{
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }[], import("convex/values").VObject<{
            valorUnico: number;
            capacidadMin: number;
            capacidadMax: number;
        }, {
            capacidadMin: import("convex/values").VFloat64<number, "required">;
            capacidadMax: import("convex/values").VFloat64<number, "required">;
            valorUnico: import("convex/values").VFloat64<number, "required">;
        }, "required", "valorUnico" | "capacidadMin" | "capacidadMax">, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt">, {
        by_property: ["propertyId", "_creationTime"];
        by_global_rule: ["globalRuleId", "_creationTime"];
    }, {}, {}>;
    bookings: import("convex/server").TableDefinition<import("convex/values").VObject<{
        numeroMascotas?: number;
        costoMascotas?: number;
        observaciones?: string;
        horaEntrada?: string;
        horaSalida?: string;
        city?: string;
        purpose?: string;
        reference?: string;
        address?: string;
        isDirect?: boolean;
        currency?: string;
        userId?: import("convex/values").GenericId<"contacts">;
        multimedia?: {
            name: string;
            type: string;
            url: string;
        }[];
        updatedAt?: number;
        personasAdicionales?: number;
        tieneMascotas?: boolean;
        detallesMascotas?: string;
        costoPersonasAdicionales?: number;
        costoPersonalServicio?: number;
        depositoGarantia?: number;
        depositoAseo?: number;
        discountCode?: string;
        discountAmount?: number;
        transactionId?: string;
        isDirectBooking?: boolean;
        googleEventId?: string;
        googleCalendarId?: string;
        status: "PAID" | "PENDING" | "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
        fechaEntrada: number;
        fechaSalida: number;
        propertyId: import("convex/values").GenericId<"properties">;
        temporada: string;
        nombreCompleto: string;
        cedula: string;
        celular: string;
        correo: string;
        numeroPersonas: number;
        precioTotal: number;
        createdAt: number;
        numeroNoches: number;
        subtotal: number;
        paymentStatus: "PAID" | "PENDING" | "PARTIAL" | "REFUNDED";
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        userId: import("convex/values").VId<import("convex/values").GenericId<"contacts">, "optional">;
        nombreCompleto: import("convex/values").VString<string, "required">;
        cedula: import("convex/values").VString<string, "required">;
        celular: import("convex/values").VString<string, "required">;
        correo: import("convex/values").VString<string, "required">;
        fechaEntrada: import("convex/values").VFloat64<number, "required">;
        fechaSalida: import("convex/values").VFloat64<number, "required">;
        horaEntrada: import("convex/values").VString<string, "optional">;
        horaSalida: import("convex/values").VString<string, "optional">;
        address: import("convex/values").VString<string, "optional">;
        numeroNoches: import("convex/values").VFloat64<number, "required">;
        numeroPersonas: import("convex/values").VFloat64<number, "required">;
        personasAdicionales: import("convex/values").VFloat64<number, "optional">;
        tieneMascotas: import("convex/values").VBoolean<boolean, "optional">;
        numeroMascotas: import("convex/values").VFloat64<number, "optional">;
        detallesMascotas: import("convex/values").VString<string, "optional">;
        subtotal: import("convex/values").VFloat64<number, "required">;
        costoPersonasAdicionales: import("convex/values").VFloat64<number, "optional">;
        costoMascotas: import("convex/values").VFloat64<number, "optional">;
        costoPersonalServicio: import("convex/values").VFloat64<number, "optional">;
        depositoGarantia: import("convex/values").VFloat64<number, "optional">;
        depositoAseo: import("convex/values").VFloat64<number, "optional">;
        discountCode: import("convex/values").VString<string, "optional">;
        discountAmount: import("convex/values").VFloat64<number, "optional">;
        precioTotal: import("convex/values").VFloat64<number, "required">;
        currency: import("convex/values").VString<string, "optional">;
        temporada: import("convex/values").VString<string, "required">;
        status: import("convex/values").VUnion<"PAID" | "PENDING" | "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "COMPLETED", [import("convex/values").VLiteral<"PENDING", "required">, import("convex/values").VLiteral<"PENDING_PAYMENT", "required">, import("convex/values").VLiteral<"CONFIRMED", "required">, import("convex/values").VLiteral<"PAID", "required">, import("convex/values").VLiteral<"CANCELLED", "required">, import("convex/values").VLiteral<"COMPLETED", "required">], "required", never>;
        paymentStatus: import("convex/values").VUnion<"PAID" | "PENDING" | "PARTIAL" | "REFUNDED", [import("convex/values").VLiteral<"PENDING", "required">, import("convex/values").VLiteral<"PARTIAL", "required">, import("convex/values").VLiteral<"PAID", "required">, import("convex/values").VLiteral<"REFUNDED", "required">], "required", never>;
        transactionId: import("convex/values").VString<string, "optional">;
        reference: import("convex/values").VString<string, "optional">;
        observaciones: import("convex/values").VString<string, "optional">;
        city: import("convex/values").VString<string, "optional">;
        purpose: import("convex/values").VString<string, "optional">;
        isDirect: import("convex/values").VBoolean<boolean, "optional">;
        isDirectBooking: import("convex/values").VBoolean<boolean, "optional">;
        googleEventId: import("convex/values").VString<string, "optional">;
        googleCalendarId: import("convex/values").VString<string, "optional">;
        multimedia: import("convex/values").VArray<{
            name: string;
            type: string;
            url: string;
        }[], import("convex/values").VObject<{
            name: string;
            type: string;
            url: string;
        }, {
            url: import("convex/values").VString<string, "required">;
            name: import("convex/values").VString<string, "required">;
            type: import("convex/values").VString<string, "required">;
        }, "required", "name" | "type" | "url">, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "optional">;
    }, "required", "status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId">, {
        by_property: ["propertyId", "_creationTime"];
        by_status: ["status", "_creationTime"];
        by_cedula: ["cedula", "_creationTime"];
        by_reference: ["reference", "_creationTime"];
        by_is_direct: ["isDirect", "_creationTime"];
        by_user: ["userId", "_creationTime"];
        by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
    }, {}, {}>;
    payments: import("convex/server").TableDefinition<import("convex/values").VObject<{
        status?: string;
        reference?: string;
        currency?: string;
        transactionId?: string;
        paymentMethod?: string;
        checkoutUrl?: string;
        wompiData?: any;
        boldData?: any;
        receiptUrl?: string;
        verifiedBy?: string;
        verifiedAt?: number;
        notes?: string;
        type: "ABONO_50" | "SALDO_50" | "COMPLETO" | "REEMBOLSO";
        bookingId: import("convex/values").GenericId<"bookings">;
        createdAt: number;
        updatedAt: number;
        amount: number;
    }, {
        bookingId: import("convex/values").VId<import("convex/values").GenericId<"bookings">, "required">;
        type: import("convex/values").VUnion<"ABONO_50" | "SALDO_50" | "COMPLETO" | "REEMBOLSO", [import("convex/values").VLiteral<"ABONO_50", "required">, import("convex/values").VLiteral<"SALDO_50", "required">, import("convex/values").VLiteral<"COMPLETO", "required">, import("convex/values").VLiteral<"REEMBOLSO", "required">], "required", never>;
        amount: import("convex/values").VFloat64<number, "required">;
        currency: import("convex/values").VString<string, "optional">;
        transactionId: import("convex/values").VString<string, "optional">;
        reference: import("convex/values").VString<string, "optional">;
        paymentMethod: import("convex/values").VString<string, "optional">;
        checkoutUrl: import("convex/values").VString<string, "optional">;
        status: import("convex/values").VString<string, "optional">;
        wompiData: import("convex/values").VAny<any, "optional", string>;
        boldData: import("convex/values").VAny<any, "optional", string>;
        receiptUrl: import("convex/values").VString<string, "optional">;
        verifiedBy: import("convex/values").VString<string, "optional">;
        verifiedAt: import("convex/values").VFloat64<number, "optional">;
        notes: import("convex/values").VString<string, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`>, {
        by_booking: ["bookingId", "_creationTime"];
        by_transaction: ["transactionId", "_creationTime"];
        by_status: ["status", "_creationTime"];
    }, {}, {}>;
    additionalCosts: import("convex/server").TableDefinition<import("convex/values").VObject<{
        description?: string;
        required?: boolean;
        name: string;
        type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
        propertyId: import("convex/values").GenericId<"properties">;
        amount: number;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        name: import("convex/values").VString<string, "required">;
        description: import("convex/values").VString<string, "optional">;
        amount: import("convex/values").VFloat64<number, "required">;
        type: import("convex/values").VUnion<"FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE", [import("convex/values").VLiteral<"FIXED", "required">, import("convex/values").VLiteral<"PER_PERSON", "required">, import("convex/values").VLiteral<"PER_NIGHT", "required">, import("convex/values").VLiteral<"PERCENTAGE", "required">], "required", never>;
        required: import("convex/values").VBoolean<boolean, "optional">;
    }, "required", "name" | "type" | "propertyId" | "description" | "required" | "amount">, {
        by_property: ["propertyId", "_creationTime"];
    }, {}, {}>;
    propertyAvailability: import("convex/server").TableDefinition<import("convex/values").VObject<{
        bookingId?: import("convex/values").GenericId<"bookings">;
        googleEventId?: string;
        blocked?: boolean;
        reason?: string;
        fechaEntrada: number;
        fechaSalida: number;
        propertyId: import("convex/values").GenericId<"properties">;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        bookingId: import("convex/values").VId<import("convex/values").GenericId<"bookings">, "optional">;
        fechaEntrada: import("convex/values").VFloat64<number, "required">;
        fechaSalida: import("convex/values").VFloat64<number, "required">;
        blocked: import("convex/values").VBoolean<boolean, "optional">;
        reason: import("convex/values").VString<string, "optional">;
        googleEventId: import("convex/values").VString<string, "optional">;
    }, "required", "fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "googleEventId" | "blocked" | "reason">, {
        by_property: ["propertyId", "_creationTime"];
        by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
        by_booking: ["bookingId", "_creationTime"];
    }, {}, {}>;
    discountCodes: import("convex/server").TableDefinition<import("convex/values").VObject<{
        propertyId?: import("convex/values").GenericId<"properties">;
        active?: boolean;
        maxUses?: number;
        currentUses?: number;
        validFrom?: number;
        validUntil?: number;
        code: string;
        type: "PERCENTAGE" | "FIXED_AMOUNT";
        value: number;
        createdAt: number;
        updatedAt: number;
    }, {
        code: import("convex/values").VString<string, "required">;
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "optional">;
        type: import("convex/values").VUnion<"PERCENTAGE" | "FIXED_AMOUNT", [import("convex/values").VLiteral<"PERCENTAGE", "required">, import("convex/values").VLiteral<"FIXED_AMOUNT", "required">], "required", never>;
        value: import("convex/values").VFloat64<number, "required">;
        maxUses: import("convex/values").VFloat64<number, "optional">;
        currentUses: import("convex/values").VFloat64<number, "optional">;
        validFrom: import("convex/values").VFloat64<number, "optional">;
        validUntil: import("convex/values").VFloat64<number, "optional">;
        active: import("convex/values").VBoolean<boolean, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "maxUses" | "currentUses" | "validFrom" | "validUntil">, {
        by_code: ["code", "_creationTime"];
        by_property: ["propertyId", "_creationTime"];
    }, {}, {}>;
    favorites: import("convex/server").TableDefinition<import("convex/values").VObject<{
        propertyId: import("convex/values").GenericId<"properties">;
        userId: string;
        createdAt: number;
    }, {
        userId: import("convex/values").VString<string, "required">;
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "propertyId" | "userId" | "createdAt">, {
        by_user: ["userId", "_creationTime"];
        by_property: ["propertyId", "_creationTime"];
        by_user_and_property: ["userId", "propertyId", "_creationTime"];
    }, {}, {}>;
    pendingKnowledgeUploads: import("convex/server").TableDefinition<import("convex/values").VObject<{
        category?: string;
        filename: string;
        userId: string;
        mimeType: string;
        namespace: string;
        createdAt: number;
        storageId: import("convex/values").GenericId<"_storage">;
    }, {
        storageId: import("convex/values").VId<import("convex/values").GenericId<"_storage">, "required">;
        filename: import("convex/values").VString<string, "required">;
        mimeType: import("convex/values").VString<string, "required">;
        category: import("convex/values").VString<string, "optional">;
        namespace: import("convex/values").VString<string, "required">;
        userId: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "storageId">, {
        by_created: ["createdAt", "_creationTime"];
    }, {}, {}>;
    contacts: import("convex/server").TableDefinition<import("convex/values").VObject<{
        email?: string;
        cedula?: string;
        city?: string;
        updatedAt?: number;
        lastReservationAt?: number;
        name: string;
        phone: string;
        createdAt: number;
    }, {
        phone: import("convex/values").VString<string, "required">;
        name: import("convex/values").VString<string, "required">;
        email: import("convex/values").VString<string, "optional">;
        cedula: import("convex/values").VString<string, "optional">;
        city: import("convex/values").VString<string, "optional">;
        lastReservationAt: import("convex/values").VFloat64<number, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "optional">;
    }, "required", "email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "lastReservationAt">, {
        by_phone: ["phone", "_creationTime"];
        by_cedula: ["cedula", "_creationTime"];
    }, {}, {}>;
    conversations: import("convex/server").TableDefinition<import("convex/values").VObject<{
        attended?: boolean;
        priority?: "resolved" | "urgent" | "low" | "medium";
        lastMessageAt?: number;
        lastSentCatalogPropertyIds?: import("convex/values").GenericId<"properties">[];
        lastCatalogSearch?: {
            minCapacity?: number;
            sortByPrice?: boolean;
            fechaEntrada: number;
            fechaSalida: number;
            location: string;
        };
        status: "ai" | "human" | "resolved";
        contactId: import("convex/values").GenericId<"contacts">;
        createdAt: number;
        channel: "whatsapp";
    }, {
        contactId: import("convex/values").VId<import("convex/values").GenericId<"contacts">, "required">;
        channel: import("convex/values").VUnion<"whatsapp", [import("convex/values").VLiteral<"whatsapp", "required">], "required", never>;
        status: import("convex/values").VUnion<"ai" | "human" | "resolved", [import("convex/values").VLiteral<"ai", "required">, import("convex/values").VLiteral<"human", "required">, import("convex/values").VLiteral<"resolved", "required">], "required", never>;
        priority: import("convex/values").VUnion<"resolved" | "urgent" | "low" | "medium", [import("convex/values").VLiteral<"urgent", "required">, import("convex/values").VLiteral<"low", "required">, import("convex/values").VLiteral<"medium", "required">, import("convex/values").VLiteral<"resolved", "required">], "optional", never>;
        lastMessageAt: import("convex/values").VFloat64<number, "optional">;
        lastSentCatalogPropertyIds: import("convex/values").VArray<import("convex/values").GenericId<"properties">[], import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">, "optional">;
        lastCatalogSearch: import("convex/values").VObject<{
            minCapacity?: number;
            sortByPrice?: boolean;
            fechaEntrada: number;
            fechaSalida: number;
            location: string;
        }, {
            location: import("convex/values").VString<string, "required">;
            fechaEntrada: import("convex/values").VFloat64<number, "required">;
            fechaSalida: import("convex/values").VFloat64<number, "required">;
            minCapacity: import("convex/values").VFloat64<number, "optional">;
            sortByPrice: import("convex/values").VBoolean<boolean, "optional">;
        }, "optional", "fechaEntrada" | "fechaSalida" | "location" | "minCapacity" | "sortByPrice">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        attended: import("convex/values").VBoolean<boolean, "optional">;
    }, "required", "status" | "attended" | "priority" | "contactId" | "createdAt" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice">, {
        by_contact: ["contactId", "_creationTime"];
        by_status: ["status", "_creationTime"];
        by_priority: ["priority", "_creationTime"];
        by_last_message: ["lastMessageAt", "_creationTime"];
    }, {}, {}>;
    messages: import("convex/server").TableDefinition<import("convex/values").VObject<{
        metadata?: any;
        type?: "text" | "image" | "audio" | "document" | "product" | "video";
        mediaUrl?: string;
        conversationId: import("convex/values").GenericId<"conversations">;
        createdAt: number;
        sender: "user" | "assistant";
        content: string;
    }, {
        conversationId: import("convex/values").VId<import("convex/values").GenericId<"conversations">, "required">;
        sender: import("convex/values").VUnion<"user" | "assistant", [import("convex/values").VLiteral<"user", "required">, import("convex/values").VLiteral<"assistant", "required">], "required", never>;
        content: import("convex/values").VString<string, "required">;
        type: import("convex/values").VUnion<"text" | "image" | "audio" | "document" | "product" | "video", [import("convex/values").VLiteral<"text", "required">, import("convex/values").VLiteral<"image", "required">, import("convex/values").VLiteral<"audio", "required">, import("convex/values").VLiteral<"video", "required">, import("convex/values").VLiteral<"document", "required">, import("convex/values").VLiteral<"product", "required">], "optional", never>;
        mediaUrl: import("convex/values").VString<string, "optional">;
        metadata: import("convex/values").VAny<any, "optional", string>;
        createdAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "sender" | "content" | `metadata.${string}`>, {
        by_conversation: ["conversationId", "createdAt", "_creationTime"];
    }, {}, {}>;
    ycloudProcessedEvents: import("convex/server").TableDefinition<import("convex/values").VObject<{
        eventId: string;
    }, {
        eventId: import("convex/values").VString<string, "required">;
    }, "required", "eventId">, {
        by_event_id: ["eventId", "_creationTime"];
    }, {}, {}>;
    whatsappCatalogs: import("convex/server").TableDefinition<import("convex/values").VObject<{
        order?: number;
        isDefault?: boolean;
        locationKeyword?: string;
        name: string;
        createdAt: number;
        updatedAt: number;
        whatsappCatalogId: string;
    }, {
        name: import("convex/values").VString<string, "required">;
        whatsappCatalogId: import("convex/values").VString<string, "required">;
        isDefault: import("convex/values").VBoolean<boolean, "optional">;
        locationKeyword: import("convex/values").VString<string, "optional">;
        order: import("convex/values").VFloat64<number, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "name" | "order" | "createdAt" | "updatedAt" | "whatsappCatalogId" | "isDefault" | "locationKeyword">, {
        by_name: ["name", "_creationTime"];
        by_location_keyword: ["locationKeyword", "_creationTime"];
        by_is_default: ["isDefault", "_creationTime"];
    }, {}, {}>;
    propertyWhatsAppCatalog: import("convex/server").TableDefinition<import("convex/values").VObject<{
        propertyId: import("convex/values").GenericId<"properties">;
        createdAt: number;
        updatedAt: number;
        catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
        productRetailerId: string;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        catalogId: import("convex/values").VId<import("convex/values").GenericId<"whatsappCatalogs">, "required">;
        productRetailerId: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "propertyId" | "createdAt" | "updatedAt" | "catalogId" | "productRetailerId">, {
        by_property: ["propertyId", "_creationTime"];
        by_catalog: ["catalogId", "_creationTime"];
        by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
    }, {}, {}>;
    reviews: import("convex/server").TableDefinition<import("convex/values").VObject<{
        userId?: string;
        bookingId?: import("convex/values").GenericId<"bookings">;
        comment?: string;
        verified?: boolean;
        propertyId: import("convex/values").GenericId<"properties">;
        rating: number;
        createdAt: number;
        updatedAt: number;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        bookingId: import("convex/values").VId<import("convex/values").GenericId<"bookings">, "optional">;
        userId: import("convex/values").VString<string, "optional">;
        rating: import("convex/values").VFloat64<number, "required">;
        comment: import("convex/values").VString<string, "optional">;
        verified: import("convex/values").VBoolean<boolean, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt">, {
        by_property: ["propertyId", "_creationTime"];
        by_booking: ["bookingId", "_creationTime"];
        by_user: ["userId", "_creationTime"];
    }, {}, {}>;
    tabOrders: import("convex/server").TableDefinition<import("convex/values").VObject<{
        tabId: string;
        propertyIds: import("convex/values").GenericId<"properties">[];
        updatedAt: number;
    }, {
        tabId: import("convex/values").VString<string, "required">;
        propertyIds: import("convex/values").VArray<import("convex/values").GenericId<"properties">[], import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "tabId" | "propertyIds" | "updatedAt">, {
        by_tab: ["tabId", "_creationTime"];
    }, {}, {}>;
    propertyOwnerInfo: import("convex/server").TableDefinition<import("convex/values").VObject<{
        bankCertificationUrl?: string;
        idCopyUrl?: string;
        rntPdfUrl?: string;
        chamberOfCommerceUrl?: string;
        propertyId: import("convex/values").GenericId<"properties">;
        ownerUserId: string;
        rutNumber: string;
        bankName: string;
        accountNumber: string;
        rntNumber: string;
        createdAt: number;
        updatedAt: number;
    }, {
        propertyId: import("convex/values").VId<import("convex/values").GenericId<"properties">, "required">;
        ownerUserId: import("convex/values").VString<string, "required">;
        rutNumber: import("convex/values").VString<string, "required">;
        bankName: import("convex/values").VString<string, "required">;
        accountNumber: import("convex/values").VString<string, "required">;
        rntNumber: import("convex/values").VString<string, "required">;
        bankCertificationUrl: import("convex/values").VString<string, "optional">;
        idCopyUrl: import("convex/values").VString<string, "optional">;
        rntPdfUrl: import("convex/values").VString<string, "optional">;
        chamberOfCommerceUrl: import("convex/values").VString<string, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt">, {
        by_property: ["propertyId", "_creationTime"];
        by_owner: ["ownerUserId", "_creationTime"];
    }, {}, {}>;
    quienes_somos: import("convex/server").TableDefinition<import("convex/values").VObject<{
        carouselImages?: string[];
        videoUrl?: string;
        videoTitle?: string;
        videoDescription?: string;
        videoBadge?: string;
        queEsFincasYa: string;
        mision: string;
        vision: string;
        objetivos: string | string[];
        politicas: string | string[];
        trayectoriaTitle: string;
        trayectoriaParagraphs: string;
        stats: {
            value: string;
            label: string;
        }[];
        recognitionTitle: string;
        recognitionSubtitle: string;
        presenciaInstitucional: string;
        updatedAt: number;
    }, {
        queEsFincasYa: import("convex/values").VString<string, "required">;
        mision: import("convex/values").VString<string, "required">;
        vision: import("convex/values").VString<string, "required">;
        objetivos: import("convex/values").VUnion<string | string[], [import("convex/values").VString<string, "required">, import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">], "required", never>;
        politicas: import("convex/values").VUnion<string | string[], [import("convex/values").VString<string, "required">, import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "required">], "required", never>;
        trayectoriaTitle: import("convex/values").VString<string, "required">;
        trayectoriaParagraphs: import("convex/values").VString<string, "required">;
        stats: import("convex/values").VArray<{
            value: string;
            label: string;
        }[], import("convex/values").VObject<{
            value: string;
            label: string;
        }, {
            label: import("convex/values").VString<string, "required">;
            value: import("convex/values").VString<string, "required">;
        }, "required", "value" | "label">, "required">;
        recognitionTitle: import("convex/values").VString<string, "required">;
        recognitionSubtitle: import("convex/values").VString<string, "required">;
        presenciaInstitucional: import("convex/values").VString<string, "required">;
        carouselImages: import("convex/values").VArray<string[], import("convex/values").VString<string, "required">, "optional">;
        videoUrl: import("convex/values").VString<string, "optional">;
        videoTitle: import("convex/values").VString<string, "optional">;
        videoDescription: import("convex/values").VString<string, "optional">;
        videoBadge: import("convex/values").VString<string, "optional">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt">, {}, {}, {}>;
    googleCalendarIntegrations: import("convex/server").TableDefinition<import("convex/values").VObject<{
        calendarId?: string;
        connectedEmail?: string;
        connectedName?: string;
        expiresAt?: number;
        accessToken?: string;
        refreshToken?: string;
        connected: boolean;
        createdAt: number;
        updatedAt: number;
    }, {
        accessToken: import("convex/values").VString<string, "optional">;
        refreshToken: import("convex/values").VString<string, "optional">;
        expiresAt: import("convex/values").VFloat64<number, "optional">;
        calendarId: import("convex/values").VString<string, "optional">;
        connected: import("convex/values").VBoolean<boolean, "required">;
        connectedEmail: import("convex/values").VString<string, "optional">;
        connectedName: import("convex/values").VString<string, "optional">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "expiresAt" | "accessToken" | "refreshToken">, {}, {}, {}>;
    user: import("convex/server").TableDefinition<import("convex/values").VObject<{
        role?: "user" | "admin" | "assistant" | "vendedor" | "propietario";
        image?: string;
        phone?: string;
        userId?: string;
        position?: string;
        documentId?: string;
        banned?: boolean;
        email: string;
        name: string;
        emailVerified: boolean;
        createdAt: number;
        updatedAt: number;
    }, {
        name: import("convex/values").VString<string, "required">;
        email: import("convex/values").VString<string, "required">;
        emailVerified: import("convex/values").VBoolean<boolean, "required">;
        image: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
        userId: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        role: import("convex/values").VUnion<"user" | "admin" | "assistant" | "vendedor" | "propietario", [import("convex/values").VLiteral<"admin", "required">, import("convex/values").VLiteral<"assistant", "required">, import("convex/values").VLiteral<"vendedor", "required">, import("convex/values").VLiteral<"propietario", "required">, import("convex/values").VLiteral<"user", "required">, import("convex/values").VNull<null, "required">], "optional", never>;
        banned: import("convex/values").VBoolean<boolean, "optional">;
        phone: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        position: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        documentId: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
    }, "required", "email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned">, {
        email_name: ["email", "name", "_creationTime"];
        name: ["name", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    session: import("convex/server").TableDefinition<import("convex/values").VObject<{
        ipAddress?: string;
        userAgent?: string;
        token: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
    }, {
        expiresAt: import("convex/values").VFloat64<number, "required">;
        token: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
        ipAddress: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        userAgent: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        userId: import("convex/values").VString<string, "required">;
    }, "required", "token" | "userId" | "createdAt" | "updatedAt" | "expiresAt" | "ipAddress" | "userAgent">, {
        expiresAt: ["expiresAt", "_creationTime"];
        expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
        token: ["token", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    account: import("convex/server").TableDefinition<import("convex/values").VObject<{
        password?: string;
        accessToken?: string;
        refreshToken?: string;
        idToken?: string;
        accessTokenExpiresAt?: number;
        refreshTokenExpiresAt?: number;
        scope?: string;
        accountId: string;
        userId: string;
        createdAt: number;
        updatedAt: number;
        providerId: string;
    }, {
        accountId: import("convex/values").VString<string, "required">;
        providerId: import("convex/values").VString<string, "required">;
        userId: import("convex/values").VString<string, "required">;
        accessToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        refreshToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        idToken: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        accessTokenExpiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
        refreshTokenExpiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
        scope: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        password: import("convex/values").VUnion<string, [import("convex/values").VNull<null, "required">, import("convex/values").VString<string, "required">], "optional", never>;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope">, {
        accountId: ["accountId", "_creationTime"];
        accountId_providerId: ["accountId", "providerId", "_creationTime"];
        providerId_userId: ["providerId", "userId", "_creationTime"];
        userId: ["userId", "_creationTime"];
    }, {}, {}>;
    verification: import("convex/server").TableDefinition<import("convex/values").VObject<{
        value: string;
        createdAt: number;
        updatedAt: number;
        expiresAt: number;
        identifier: string;
    }, {
        identifier: import("convex/values").VString<string, "required">;
        value: import("convex/values").VString<string, "required">;
        expiresAt: import("convex/values").VFloat64<number, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        updatedAt: import("convex/values").VFloat64<number, "required">;
    }, "required", "value" | "createdAt" | "updatedAt" | "expiresAt" | "identifier">, {
        expiresAt: ["expiresAt", "_creationTime"];
        identifier: ["identifier", "_creationTime"];
    }, {}, {}>;
    jwks: import("convex/server").TableDefinition<import("convex/values").VObject<{
        expiresAt?: number;
        createdAt: number;
        publicKey: string;
        privateKey: string;
    }, {
        publicKey: import("convex/values").VString<string, "required">;
        privateKey: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        expiresAt: import("convex/values").VUnion<number, [import("convex/values").VNull<null, "required">, import("convex/values").VFloat64<number, "required">], "optional", never>;
    }, "required", "createdAt" | "expiresAt" | "publicKey" | "privateKey">, {}, {}, {}>;
}, true>;
export default _default;
