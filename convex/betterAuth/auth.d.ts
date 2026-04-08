import type { GenericCtx } from '@convex-dev/better-auth/utils';
import type { BetterAuthOptions } from 'better-auth';
import type { DataModel } from '../_generated/dataModel';
export declare const authComponent: {
    adapter: (ctx: GenericCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>) => import("better-auth/adapters/index.mjs").AdapterFactory;
    getAuth: <T extends import("@convex-dev/better-auth").CreateAuth<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>>(createAuth: T, ctx: GenericCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>) => Promise<{
        auth: ReturnType<T>;
        headers: Headers;
    }>;
    getHeaders: (ctx: GenericCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>) => Promise<Headers>;
    safeGetAuthUser: (ctx: GenericCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>) => Promise<{
        _id: import("convex/values").GenericId<"user">;
        _creationTime: number;
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
    }>;
    getAuthUser: (ctx: GenericCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>) => Promise<{
        _id: import("convex/values").GenericId<"user">;
        _creationTime: number;
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
    }>;
    getAnyUserById: (ctx: GenericCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>, id: string) => Promise<{
        _id: import("convex/values").GenericId<"user">;
        _creationTime: number;
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
    }>;
    setUserId: (ctx: import("convex/server").GenericMutationCtx<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>, authId: string, userId: string) => Promise<void>;
    clientApi: () => {
        getAuthUser: import("convex/server").RegisteredQuery<"public", {}, Promise<{
            _id: import("convex/values").GenericId<"user">;
            _creationTime: number;
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
        }>>;
    };
    triggersApi: () => {
        onCreate: import("convex/server").RegisteredMutation<"internal", {
            model: string;
            doc: any;
        }, Promise<void>>;
        onUpdate: import("convex/server").RegisteredMutation<"internal", {
            model: string;
            oldDoc: any;
            newDoc: any;
        }, Promise<void>>;
        onDelete: import("convex/server").RegisteredMutation<"internal", {
            model: string;
            doc: any;
        }, Promise<void>>;
    };
    registerRoutes: (http: import("convex/server").HttpRouter, createAuth: import("@convex-dev/better-auth").CreateAuth<{
        user: {
            document: {
                _id: import("convex/values").GenericId<"user">;
                _creationTime: number;
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
            };
            fieldPaths: ("email" | "name" | "role" | "image" | "phone" | "userId" | "position" | "documentId" | "emailVerified" | "createdAt" | "updatedAt" | "banned" | "_creationTime") | "_id";
            indexes: {
                email_name: ["email", "name", "_creationTime"];
                name: ["name", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        session: {
            document: {
                _id: import("convex/values").GenericId<"session">;
                _creationTime: number;
                ipAddress?: string;
                userAgent?: string;
                token: string;
                userId: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
            };
            fieldPaths: ("token" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "ipAddress" | "userAgent") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                expiresAt_userId: ["expiresAt", "userId", "_creationTime"];
                token: ["token", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        reviews: {
            document: {
                _id: import("convex/values").GenericId<"reviews">;
                _creationTime: number;
                userId?: string;
                bookingId?: import("convex/values").GenericId<"bookings">;
                comment?: string;
                verified?: boolean;
                propertyId: import("convex/values").GenericId<"properties">;
                rating: number;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("propertyId" | "rating" | "userId" | "bookingId" | "comment" | "verified" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        contacts: {
            document: {
                _id: import("convex/values").GenericId<"contacts">;
                _creationTime: number;
                email?: string;
                cedula?: string;
                city?: string;
                updatedAt?: number;
                lastReservationAt?: number;
                name: string;
                phone: string;
                createdAt: number;
            };
            fieldPaths: ("email" | "name" | "cedula" | "city" | "phone" | "createdAt" | "updatedAt" | "_creationTime" | "lastReservationAt") | "_id";
            indexes: {
                by_phone: ["phone", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        bookings: {
            document: {
                _id: import("convex/values").GenericId<"bookings">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "fechaEntrada" | "fechaSalida" | "propertyId" | "temporada" | "nombreCompleto" | "cedula" | "celular" | "correo" | "numeroPersonas" | "precioTotal" | "numeroMascotas" | "costoMascotas" | "observaciones" | "horaEntrada" | "horaSalida" | "city" | "purpose" | "reference" | "address" | "isDirect" | "currency" | "userId" | "multimedia" | "createdAt" | "updatedAt" | "_creationTime" | "numeroNoches" | "personasAdicionales" | "tieneMascotas" | "detallesMascotas" | "subtotal" | "costoPersonasAdicionales" | "costoPersonalServicio" | "depositoGarantia" | "depositoAseo" | "discountCode" | "discountAmount" | "paymentStatus" | "transactionId" | "isDirectBooking" | "googleEventId" | "googleCalendarId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_cedula: ["cedula", "_creationTime"];
                by_reference: ["reference", "_creationTime"];
                by_is_direct: ["isDirect", "_creationTime"];
                by_user: ["userId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        account: {
            document: {
                _id: import("convex/values").GenericId<"account">;
                _creationTime: number;
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
            };
            fieldPaths: ("password" | "accountId" | "userId" | "createdAt" | "updatedAt" | "_creationTime" | "providerId" | "accessToken" | "refreshToken" | "idToken" | "accessTokenExpiresAt" | "refreshTokenExpiresAt" | "scope") | "_id";
            indexes: {
                accountId: ["accountId", "_creationTime"];
                accountId_providerId: ["accountId", "providerId", "_creationTime"];
                providerId_userId: ["providerId", "userId", "_creationTime"];
                userId: ["userId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        verification: {
            document: {
                _id: import("convex/values").GenericId<"verification">;
                _creationTime: number;
                value: string;
                createdAt: number;
                updatedAt: number;
                expiresAt: number;
                identifier: string;
            };
            fieldPaths: ("value" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "identifier") | "_id";
            indexes: {
                expiresAt: ["expiresAt", "_creationTime"];
                identifier: ["identifier", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        jwks: {
            document: {
                _id: import("convex/values").GenericId<"jwks">;
                _creationTime: number;
                expiresAt?: number;
                createdAt: number;
                publicKey: string;
                privateKey: string;
            };
            fieldPaths: "_id" | ("createdAt" | "_creationTime" | "expiresAt" | "publicKey" | "privateKey");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        iconography: {
            document: {
                _id: import("convex/values").GenericId<"iconography">;
                _creationTime: number;
                name?: string;
                iconUrl?: string;
                emoji?: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("name" | "iconUrl" | "emoji" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        properties: {
            document: {
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
            };
            fieldPaths: ("code" | "type" | "title" | "description" | "location" | "capacity" | "rating" | "lat" | "lng" | "priceBase" | "priceBaja" | "priceMedia" | "priceAlta" | "priceEspeciales" | "category" | "active" | "visible" | "reservable" | "isFavorite" | "priceOriginal" | "video" | "contractTemplateUrl" | "featuredIcons" | "zoneOrder" | "slug" | "createdAt" | "updatedAt" | "_creationTime" | "reviewsCount" | "priceRawBase" | "priceRawBaja" | "priceRawMedia" | "priceRawAlta" | "priceRawEspeciales") | "_id";
            indexes: {
                by_location: ["location", "_creationTime"];
                by_capacity: ["capacity", "_creationTime"];
                by_rating: ["rating", "_creationTime"];
                by_type: ["type", "_creationTime"];
                by_category: ["category", "_creationTime"];
                by_code: ["code", "_creationTime"];
                by_slug: ["slug", "_creationTime"];
                by_createdAt: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyImages: {
            document: {
                _id: import("convex/values").GenericId<"propertyImages">;
                _creationTime: number;
                order?: number;
                url: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("url" | "propertyId" | "order" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyFeatures: {
            document: {
                _id: import("convex/values").GenericId<"propertyFeatures">;
                _creationTime: number;
                iconId?: import("convex/values").GenericId<"iconography">;
                zone?: string;
                featureId?: string;
                name: string;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("name" | "propertyId" | "iconId" | "zone" | "featureId" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_icon: ["iconId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        globalPricing: {
            document: {
                _id: import("convex/values").GenericId<"globalPricing">;
                _creationTime: number;
                fechaDesde?: string;
                fechaHasta?: string;
                fechas?: string[];
                activa?: boolean;
                nombre: string;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: ("nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "activa" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_nombre: ["nombre", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyPricing: {
            document: {
                _id: import("convex/values").GenericId<"propertyPricing">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "nombre" | "fechaDesde" | "fechaHasta" | "fechas" | "globalRuleId" | "valorUnico" | "condiciones" | "activa" | "reglas" | "order" | "subReglasCapacidad" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_global_rule: ["globalRuleId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        payments: {
            document: {
                _id: import("convex/values").GenericId<"payments">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "type" | "reference" | "currency" | "bookingId" | "createdAt" | "updatedAt" | "_creationTime" | "transactionId" | "amount" | "paymentMethod" | "checkoutUrl" | "wompiData" | "boldData" | "receiptUrl" | "verifiedBy" | "verifiedAt" | "notes" | `wompiData.${string}` | `boldData.${string}`) | "_id";
            indexes: {
                by_booking: ["bookingId", "_creationTime"];
                by_transaction: ["transactionId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        additionalCosts: {
            document: {
                _id: import("convex/values").GenericId<"additionalCosts">;
                _creationTime: number;
                description?: string;
                required?: boolean;
                name: string;
                type: "FIXED" | "PER_PERSON" | "PER_NIGHT" | "PERCENTAGE";
                propertyId: import("convex/values").GenericId<"properties">;
                amount: number;
            };
            fieldPaths: ("name" | "type" | "propertyId" | "description" | "required" | "_creationTime" | "amount") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyAvailability: {
            document: {
                _id: import("convex/values").GenericId<"propertyAvailability">;
                _creationTime: number;
                bookingId?: import("convex/values").GenericId<"bookings">;
                googleEventId?: string;
                blocked?: boolean;
                reason?: string;
                fechaEntrada: number;
                fechaSalida: number;
                propertyId: import("convex/values").GenericId<"properties">;
            };
            fieldPaths: ("fechaEntrada" | "fechaSalida" | "propertyId" | "bookingId" | "_creationTime" | "googleEventId" | "blocked" | "reason") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_dates: ["fechaEntrada", "fechaSalida", "_creationTime"];
                by_booking: ["bookingId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        discountCodes: {
            document: {
                _id: import("convex/values").GenericId<"discountCodes">;
                _creationTime: number;
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
            };
            fieldPaths: ("code" | "type" | "propertyId" | "value" | "active" | "createdAt" | "updatedAt" | "_creationTime" | "maxUses" | "currentUses" | "validFrom" | "validUntil") | "_id";
            indexes: {
                by_code: ["code", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        favorites: {
            document: {
                _id: import("convex/values").GenericId<"favorites">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                userId: string;
                createdAt: number;
            };
            fieldPaths: ("propertyId" | "userId" | "createdAt" | "_creationTime") | "_id";
            indexes: {
                by_user: ["userId", "_creationTime"];
                by_property: ["propertyId", "_creationTime"];
                by_user_and_property: ["userId", "propertyId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        pendingKnowledgeUploads: {
            document: {
                _id: import("convex/values").GenericId<"pendingKnowledgeUploads">;
                _creationTime: number;
                category?: string;
                filename: string;
                userId: string;
                mimeType: string;
                namespace: string;
                createdAt: number;
                storageId: import("convex/values").GenericId<"_storage">;
            };
            fieldPaths: ("filename" | "category" | "userId" | "mimeType" | "namespace" | "createdAt" | "_creationTime" | "storageId") | "_id";
            indexes: {
                by_created: ["createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        conversations: {
            document: {
                _id: import("convex/values").GenericId<"conversations">;
                _creationTime: number;
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
            };
            fieldPaths: ("status" | "attended" | "priority" | "contactId" | "createdAt" | "_creationTime" | "channel" | "lastMessageAt" | "lastSentCatalogPropertyIds" | "lastCatalogSearch" | "lastCatalogSearch.fechaEntrada" | "lastCatalogSearch.fechaSalida" | "lastCatalogSearch.location" | "lastCatalogSearch.minCapacity" | "lastCatalogSearch.sortByPrice") | "_id";
            indexes: {
                by_contact: ["contactId", "_creationTime"];
                by_status: ["status", "_creationTime"];
                by_priority: ["priority", "_creationTime"];
                by_last_message: ["lastMessageAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        messages: {
            document: {
                _id: import("convex/values").GenericId<"messages">;
                _creationTime: number;
                metadata?: any;
                type?: "text" | "image" | "audio" | "document" | "product" | "video";
                mediaUrl?: string;
                conversationId: import("convex/values").GenericId<"conversations">;
                createdAt: number;
                sender: "user" | "assistant";
                content: string;
            };
            fieldPaths: ("metadata" | "type" | "conversationId" | "mediaUrl" | "createdAt" | "_creationTime" | "sender" | "content" | `metadata.${string}`) | "_id";
            indexes: {
                by_conversation: ["conversationId", "createdAt", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        ycloudProcessedEvents: {
            document: {
                _id: import("convex/values").GenericId<"ycloudProcessedEvents">;
                _creationTime: number;
                eventId: string;
            };
            fieldPaths: ("_creationTime" | "eventId") | "_id";
            indexes: {
                by_event_id: ["eventId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        whatsappCatalogs: {
            document: {
                _id: import("convex/values").GenericId<"whatsappCatalogs">;
                _creationTime: number;
                order?: number;
                isDefault?: boolean;
                locationKeyword?: string;
                name: string;
                createdAt: number;
                updatedAt: number;
                whatsappCatalogId: string;
            };
            fieldPaths: ("name" | "order" | "createdAt" | "updatedAt" | "_creationTime" | "whatsappCatalogId" | "isDefault" | "locationKeyword") | "_id";
            indexes: {
                by_name: ["name", "_creationTime"];
                by_location_keyword: ["locationKeyword", "_creationTime"];
                by_is_default: ["isDefault", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyWhatsAppCatalog: {
            document: {
                _id: import("convex/values").GenericId<"propertyWhatsAppCatalog">;
                _creationTime: number;
                propertyId: import("convex/values").GenericId<"properties">;
                createdAt: number;
                updatedAt: number;
                catalogId: import("convex/values").GenericId<"whatsappCatalogs">;
                productRetailerId: string;
            };
            fieldPaths: ("propertyId" | "createdAt" | "updatedAt" | "_creationTime" | "catalogId" | "productRetailerId") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_catalog: ["catalogId", "_creationTime"];
                by_property_and_catalog: ["propertyId", "catalogId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        tabOrders: {
            document: {
                _id: import("convex/values").GenericId<"tabOrders">;
                _creationTime: number;
                tabId: string;
                propertyIds: import("convex/values").GenericId<"properties">[];
                updatedAt: number;
            };
            fieldPaths: ("tabId" | "propertyIds" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_tab: ["tabId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        propertyOwnerInfo: {
            document: {
                _id: import("convex/values").GenericId<"propertyOwnerInfo">;
                _creationTime: number;
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
            };
            fieldPaths: ("propertyId" | "ownerUserId" | "rutNumber" | "bankName" | "accountNumber" | "rntNumber" | "bankCertificationUrl" | "idCopyUrl" | "rntPdfUrl" | "chamberOfCommerceUrl" | "createdAt" | "updatedAt" | "_creationTime") | "_id";
            indexes: {
                by_property: ["propertyId", "_creationTime"];
                by_owner: ["ownerUserId", "_creationTime"];
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        quienes_somos: {
            document: {
                _id: import("convex/values").GenericId<"quienes_somos">;
                _creationTime: number;
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
            };
            fieldPaths: "_id" | ("queEsFincasYa" | "mision" | "vision" | "objetivos" | "politicas" | "trayectoriaTitle" | "trayectoriaParagraphs" | "stats" | "recognitionTitle" | "recognitionSubtitle" | "presenciaInstitucional" | "carouselImages" | "videoUrl" | "videoTitle" | "videoDescription" | "videoBadge" | "updatedAt" | "_creationTime");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
        googleCalendarIntegrations: {
            document: {
                _id: import("convex/values").GenericId<"googleCalendarIntegrations">;
                _creationTime: number;
                calendarId?: string;
                connectedEmail?: string;
                connectedName?: string;
                expiresAt?: number;
                accessToken?: string;
                refreshToken?: string;
                connected: boolean;
                createdAt: number;
                updatedAt: number;
            };
            fieldPaths: "_id" | ("connected" | "calendarId" | "connectedEmail" | "connectedName" | "createdAt" | "updatedAt" | "_creationTime" | "expiresAt" | "accessToken" | "refreshToken");
            indexes: {
                by_id: ["_id"];
                by_creation_time: ["_creationTime"];
            };
            searchIndexes: {};
            vectorIndexes: {};
        };
    }>, opts?: {
        cors?: boolean | {
            allowedOrigins?: string[];
            allowedHeaders?: string[];
            exposedHeaders?: string[];
        };
    }) => void;
};
export declare const createAuthOptions: (ctx: GenericCtx<DataModel>) => {
    appName: string;
    baseURL: string;
    basePath: string;
    secret: string;
    database: import("better-auth/adapters/index.mjs").AdapterFactory;
    trustedOrigins: string[];
    emailAndPassword: {
        enabled: true;
    };
    user: {
        additionalFields: {
            role: {
                type: "string";
                required: false;
                defaultValue: string;
                input: true;
            };
        };
    };
    session: {
        expiresIn: number;
        updateAge: number;
    };
    plugins: [{
        id: "convex";
        init: (ctx: import("better-auth").AuthContext<BetterAuthOptions>) => void;
        hooks: {
            before: ({
                matcher(context: import("better-auth").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    context: {
                        headers: Headers;
                    };
                } | undefined>;
            } | {
                matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    context: import("better-auth").MiddlewareContext<import("better-auth").MiddlewareOptions, import("better-auth").AuthContext<BetterAuthOptions> & {
                        returned?: unknown | undefined;
                        responseHeaders?: Headers | undefined;
                    }>;
                }>;
            })[];
            after: ({
                matcher(): true;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<Response | {
                    redirect: boolean;
                    url: string;
                } | undefined>;
            } | {
                matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<void>;
            })[];
        };
        endpoints: {
            getOpenIdConfig: import("better-auth").StrictEndpoint<"/convex/.well-known/openid-configuration", {
                method: "GET";
                metadata: {
                    isAction: false;
                };
            }, import("better-auth/plugins").OIDCMetadata>;
            getJwks: import("better-auth").StrictEndpoint<"/convex/jwks", {
                method: "GET";
                metadata: {
                    openapi: {
                        description: string;
                        responses: {
                            "200": {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                keys: {
                                                    type: string;
                                                    description: string;
                                                    items: {
                                                        type: string;
                                                        properties: {
                                                            kid: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            kty: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            alg: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            use: {
                                                                type: string;
                                                                description: string;
                                                                enum: string[];
                                                                nullable: boolean;
                                                            };
                                                            n: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            e: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            crv: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            x: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            y: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                        };
                                                        required: string[];
                                                    };
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, import("better-auth").JSONWebKeySet>;
            getLatestJwks: import("better-auth").StrictEndpoint<"/convex/latest-jwks", {
                isAction: boolean;
                method: "POST";
                metadata: {
                    SERVER_ONLY: true;
                    openapi: {
                        description: string;
                    };
                };
            }, any[]>;
            rotateKeys: import("better-auth").StrictEndpoint<"/convex/rotate-keys", {
                isAction: boolean;
                method: "POST";
                metadata: {
                    SERVER_ONLY: true;
                    openapi: {
                        description: string;
                    };
                };
            }, any[]>;
            getToken: import("better-auth").StrictEndpoint<"/convex/token", {
                method: "GET";
                requireHeaders: true;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        session: Record<string, any> & {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            userId: string;
                            expiresAt: Date;
                            token: string;
                            ipAddress?: string | null | undefined;
                            userAgent?: string | null | undefined;
                        };
                        user: Record<string, any> & {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            email: string;
                            emailVerified: boolean;
                            name: string;
                            image?: string | null | undefined;
                        };
                    };
                }>)[];
                metadata: {
                    openapi: {
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                token: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                token: string;
            }>;
        };
        schema: {
            jwks: {
                fields: {
                    publicKey: {
                        type: "string";
                        required: true;
                    };
                    privateKey: {
                        type: "string";
                        required: true;
                    };
                    createdAt: {
                        type: "date";
                        required: true;
                    };
                    expiresAt: {
                        type: "date";
                        required: false;
                    };
                };
            };
            user: {
                readonly fields: {
                    readonly userId: {
                        readonly type: "string";
                        readonly required: false;
                        readonly input: false;
                    };
                };
            };
        };
    }, {
        id: "admin";
        init(): {
            options: {
                databaseHooks: {
                    user: {
                        create: {
                            before(user: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                email: string;
                                emailVerified: boolean;
                                name: string;
                                image?: string | null | undefined;
                            } & Record<string, unknown>): Promise<{
                                data: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                    role: string;
                                };
                            }>;
                        };
                    };
                    session: {
                        create: {
                            before(session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            } & Record<string, unknown>, ctx: import("better-auth").GenericEndpointContext | null): Promise<void>;
                        };
                    };
                };
            };
        };
        hooks: {
            after: {
                matcher(context: import("better-auth").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<import("better-auth/plugins").SessionWithImpersonatedBy[] | undefined>;
            }[];
        };
        endpoints: {
            setRole: import("better-auth").StrictEndpoint<"/admin/set-role", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    role: import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>;
                }, import("better-auth").$strip>;
                requireHeaders: true;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: {
                            userId: string;
                            role: "user" | "admin" | ("user" | "admin")[];
                        };
                    };
                };
            }, {
                user: import("better-auth/plugins").UserWithRole;
            }>;
            getUser: import("better-auth").StrictEndpoint<"/admin/get-user", {
                method: "GET";
                query: import("better-auth").ZodObject<{
                    id: import("better-auth").ZodString;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
            createUser: import("better-auth").StrictEndpoint<"/admin/create-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    email: import("better-auth").ZodString;
                    password: import("better-auth").ZodString;
                    name: import("better-auth").ZodString;
                    role: import("better-auth").ZodOptional<import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>>;
                    data: import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodAny>>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: {
                            email: string;
                            password: string;
                            name: string;
                            role?: "user" | "admin" | ("user" | "admin")[] | undefined;
                            data?: Record<string, any> | undefined;
                        };
                    };
                };
            }, {
                user: import("better-auth/plugins").UserWithRole;
            }>;
            adminUpdateUser: import("better-auth").StrictEndpoint<"/admin/update-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    data: import("better-auth").ZodRecord<import("better-auth").ZodAny, import("better-auth").ZodAny>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, import("better-auth/plugins").UserWithRole>;
            listUsers: import("better-auth").StrictEndpoint<"/admin/list-users", {
                method: "GET";
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                query: import("better-auth").ZodObject<{
                    searchValue: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    searchField: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        name: "name";
                        email: "email";
                    }>>;
                    searchOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        contains: "contains";
                        starts_with: "starts_with";
                        ends_with: "ends_with";
                    }>>;
                    limit: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                    offset: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                    sortBy: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    sortDirection: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        asc: "asc";
                        desc: "desc";
                    }>>;
                    filterField: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    filterValue: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>, import("better-auth").ZodBoolean]>>;
                    filterOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        eq: "eq";
                        ne: "ne";
                        lt: "lt";
                        lte: "lte";
                        gt: "gt";
                        gte: "gte";
                        contains: "contains";
                    }>>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                users: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                                total: {
                                                    type: string;
                                                };
                                                limit: {
                                                    type: string;
                                                };
                                                offset: {
                                                    type: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                users: import("better-auth/plugins").UserWithRole[];
                total: number;
                limit: number | undefined;
                offset: number | undefined;
            } | {
                users: never[];
                total: number;
            }>;
            listUserSessions: import("better-auth").StrictEndpoint<"/admin/list-user-sessions", {
                method: "POST";
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                sessions: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                sessions: import("better-auth/plugins").SessionWithImpersonatedBy[];
            }>;
            unbanUser: import("better-auth").StrictEndpoint<"/admin/unban-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                user: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    email: string;
                    emailVerified: boolean;
                    name: string;
                    image?: string | null | undefined;
                } & Record<string, any>;
            }>;
            banUser: import("better-auth").StrictEndpoint<"/admin/ban-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    banReason: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    banExpiresIn: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                user: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    email: string;
                    emailVerified: boolean;
                    name: string;
                    image?: string | null | undefined;
                } & Record<string, any>;
            }>;
            impersonateUser: import("better-auth").StrictEndpoint<"/admin/impersonate-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                session: {
                                                    $ref: string;
                                                };
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                session: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    userId: string;
                    expiresAt: Date;
                    token: string;
                    ipAddress?: string | null | undefined;
                    userAgent?: string | null | undefined;
                };
                user: import("better-auth/plugins").UserWithRole;
            }>;
            stopImpersonating: import("better-auth").StrictEndpoint<"/admin/stop-impersonating", {
                method: "POST";
                requireHeaders: true;
            }, {
                session: import("better-auth").Session & Record<string, any>;
                user: import("better-auth").User & Record<string, any>;
            }>;
            revokeUserSession: import("better-auth").StrictEndpoint<"/admin/revoke-user-session", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    sessionToken: import("better-auth").ZodString;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            revokeUserSessions: import("better-auth").StrictEndpoint<"/admin/revoke-user-sessions", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            removeUser: import("better-auth").StrictEndpoint<"/admin/remove-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            setUserPassword: import("better-auth").StrictEndpoint<"/admin/set-user-password", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    newPassword: import("better-auth").ZodString;
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                status: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                status: boolean;
            }>;
            userHasPermission: import("better-auth").StrictEndpoint<"/admin/has-permission", {
                method: "POST";
                body: import("better-auth").ZodIntersection<import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodOptional<import("better-auth").ZodCoercedString<unknown>>;
                    role: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                }, import("better-auth").$strip>, import("better-auth").ZodUnion<readonly [import("better-auth").ZodObject<{
                    permission: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                    permissions: import("better-auth").ZodUndefined;
                }, import("better-auth").$strip>, import("better-auth").ZodObject<{
                    permission: import("better-auth").ZodUndefined;
                    permissions: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                }, import("better-auth").$strip>]>>;
                metadata: {
                    openapi: {
                        description: string;
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            permission: {
                                                type: string;
                                                description: string;
                                                deprecated: boolean;
                                            };
                                            permissions: {
                                                type: string;
                                                description: string;
                                            };
                                        };
                                        required: string[];
                                    };
                                };
                            };
                        };
                        responses: {
                            "200": {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                error: {
                                                    type: string;
                                                };
                                                success: {
                                                    type: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: ({
                            permission: {
                                readonly [x: string]: import("better-auth").LiteralString[];
                            };
                            permissions?: never | undefined;
                        } | {
                            permissions: {
                                readonly [x: string]: import("better-auth").LiteralString[];
                            };
                            permission?: never | undefined;
                        }) & {
                            userId?: string | undefined;
                            role?: "user" | "admin";
                        };
                    };
                };
            }, {
                error: null;
                success: boolean;
            }>;
        };
        $ERROR_CODES: {
            readonly FAILED_TO_CREATE_USER: "Failed to create user";
            readonly USER_ALREADY_EXISTS: "User already exists.";
            readonly USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "User already exists. Use another email.";
            readonly YOU_CANNOT_BAN_YOURSELF: "You cannot ban yourself";
            readonly YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: "You are not allowed to change users role";
            readonly YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS: "You are not allowed to create users";
            readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: "You are not allowed to list users";
            readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS: "You are not allowed to list users sessions";
            readonly YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: "You are not allowed to ban users";
            readonly YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: "You are not allowed to impersonate users";
            readonly YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: "You are not allowed to revoke users sessions";
            readonly YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: "You are not allowed to delete users";
            readonly YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD: "You are not allowed to set users password";
            readonly BANNED_USER: "You have been banned from this application";
            readonly YOU_ARE_NOT_ALLOWED_TO_GET_USER: "You are not allowed to get user";
            readonly NO_DATA_TO_UPDATE: "No data to update";
            readonly YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: "You are not allowed to update users";
            readonly YOU_CANNOT_REMOVE_YOURSELF: "You cannot remove yourself";
            readonly YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: "You are not allowed to set a non-existent role value";
            readonly YOU_CANNOT_IMPERSONATE_ADMINS: "You cannot impersonate admins";
            readonly INVALID_ROLE_TYPE: "Invalid role type";
        };
        schema: {
            user: {
                fields: {
                    role: {
                        type: "string";
                        required: false;
                        input: false;
                    };
                    banned: {
                        type: "boolean";
                        defaultValue: false;
                        required: false;
                        input: false;
                    };
                    banReason: {
                        type: "string";
                        required: false;
                        input: false;
                    };
                    banExpires: {
                        type: "date";
                        required: false;
                        input: false;
                    };
                };
            };
            session: {
                fields: {
                    impersonatedBy: {
                        type: "string";
                        required: false;
                    };
                };
            };
        };
        options: NoInfer<import("better-auth/plugins").AdminOptions>;
    }];
};
export declare const options: {
    appName: string;
    baseURL: string;
    basePath: string;
    secret: string;
    database: import("better-auth/adapters/index.mjs").AdapterFactory;
    trustedOrigins: string[];
    emailAndPassword: {
        enabled: true;
    };
    user: {
        additionalFields: {
            role: {
                type: "string";
                required: false;
                defaultValue: string;
                input: true;
            };
        };
    };
    session: {
        expiresIn: number;
        updateAge: number;
    };
    plugins: [{
        id: "convex";
        init: (ctx: import("better-auth").AuthContext<BetterAuthOptions>) => void;
        hooks: {
            before: ({
                matcher(context: import("better-auth").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    context: {
                        headers: Headers;
                    };
                } | undefined>;
            } | {
                matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    context: import("better-auth").MiddlewareContext<import("better-auth").MiddlewareOptions, import("better-auth").AuthContext<BetterAuthOptions> & {
                        returned?: unknown | undefined;
                        responseHeaders?: Headers | undefined;
                    }>;
                }>;
            })[];
            after: ({
                matcher(): true;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<Response | {
                    redirect: boolean;
                    url: string;
                } | undefined>;
            } | {
                matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<void>;
            })[];
        };
        endpoints: {
            getOpenIdConfig: import("better-auth").StrictEndpoint<"/convex/.well-known/openid-configuration", {
                method: "GET";
                metadata: {
                    isAction: false;
                };
            }, import("better-auth/plugins").OIDCMetadata>;
            getJwks: import("better-auth").StrictEndpoint<"/convex/jwks", {
                method: "GET";
                metadata: {
                    openapi: {
                        description: string;
                        responses: {
                            "200": {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                keys: {
                                                    type: string;
                                                    description: string;
                                                    items: {
                                                        type: string;
                                                        properties: {
                                                            kid: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            kty: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            alg: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            use: {
                                                                type: string;
                                                                description: string;
                                                                enum: string[];
                                                                nullable: boolean;
                                                            };
                                                            n: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            e: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            crv: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            x: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            y: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                        };
                                                        required: string[];
                                                    };
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, import("better-auth").JSONWebKeySet>;
            getLatestJwks: import("better-auth").StrictEndpoint<"/convex/latest-jwks", {
                isAction: boolean;
                method: "POST";
                metadata: {
                    SERVER_ONLY: true;
                    openapi: {
                        description: string;
                    };
                };
            }, any[]>;
            rotateKeys: import("better-auth").StrictEndpoint<"/convex/rotate-keys", {
                isAction: boolean;
                method: "POST";
                metadata: {
                    SERVER_ONLY: true;
                    openapi: {
                        description: string;
                    };
                };
            }, any[]>;
            getToken: import("better-auth").StrictEndpoint<"/convex/token", {
                method: "GET";
                requireHeaders: true;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        session: Record<string, any> & {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            userId: string;
                            expiresAt: Date;
                            token: string;
                            ipAddress?: string | null | undefined;
                            userAgent?: string | null | undefined;
                        };
                        user: Record<string, any> & {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            email: string;
                            emailVerified: boolean;
                            name: string;
                            image?: string | null | undefined;
                        };
                    };
                }>)[];
                metadata: {
                    openapi: {
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                token: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                token: string;
            }>;
        };
        schema: {
            jwks: {
                fields: {
                    publicKey: {
                        type: "string";
                        required: true;
                    };
                    privateKey: {
                        type: "string";
                        required: true;
                    };
                    createdAt: {
                        type: "date";
                        required: true;
                    };
                    expiresAt: {
                        type: "date";
                        required: false;
                    };
                };
            };
            user: {
                readonly fields: {
                    readonly userId: {
                        readonly type: "string";
                        readonly required: false;
                        readonly input: false;
                    };
                };
            };
        };
    }, {
        id: "admin";
        init(): {
            options: {
                databaseHooks: {
                    user: {
                        create: {
                            before(user: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                email: string;
                                emailVerified: boolean;
                                name: string;
                                image?: string | null | undefined;
                            } & Record<string, unknown>): Promise<{
                                data: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                    role: string;
                                };
                            }>;
                        };
                    };
                    session: {
                        create: {
                            before(session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            } & Record<string, unknown>, ctx: import("better-auth").GenericEndpointContext | null): Promise<void>;
                        };
                    };
                };
            };
        };
        hooks: {
            after: {
                matcher(context: import("better-auth").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<import("better-auth/plugins").SessionWithImpersonatedBy[] | undefined>;
            }[];
        };
        endpoints: {
            setRole: import("better-auth").StrictEndpoint<"/admin/set-role", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    role: import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>;
                }, import("better-auth").$strip>;
                requireHeaders: true;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: {
                            userId: string;
                            role: "user" | "admin" | ("user" | "admin")[];
                        };
                    };
                };
            }, {
                user: import("better-auth/plugins").UserWithRole;
            }>;
            getUser: import("better-auth").StrictEndpoint<"/admin/get-user", {
                method: "GET";
                query: import("better-auth").ZodObject<{
                    id: import("better-auth").ZodString;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
            createUser: import("better-auth").StrictEndpoint<"/admin/create-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    email: import("better-auth").ZodString;
                    password: import("better-auth").ZodString;
                    name: import("better-auth").ZodString;
                    role: import("better-auth").ZodOptional<import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>>;
                    data: import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodAny>>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: {
                            email: string;
                            password: string;
                            name: string;
                            role?: "user" | "admin" | ("user" | "admin")[] | undefined;
                            data?: Record<string, any> | undefined;
                        };
                    };
                };
            }, {
                user: import("better-auth/plugins").UserWithRole;
            }>;
            adminUpdateUser: import("better-auth").StrictEndpoint<"/admin/update-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    data: import("better-auth").ZodRecord<import("better-auth").ZodAny, import("better-auth").ZodAny>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, import("better-auth/plugins").UserWithRole>;
            listUsers: import("better-auth").StrictEndpoint<"/admin/list-users", {
                method: "GET";
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                query: import("better-auth").ZodObject<{
                    searchValue: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    searchField: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        name: "name";
                        email: "email";
                    }>>;
                    searchOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        contains: "contains";
                        starts_with: "starts_with";
                        ends_with: "ends_with";
                    }>>;
                    limit: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                    offset: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                    sortBy: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    sortDirection: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        asc: "asc";
                        desc: "desc";
                    }>>;
                    filterField: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    filterValue: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>, import("better-auth").ZodBoolean]>>;
                    filterOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        eq: "eq";
                        ne: "ne";
                        lt: "lt";
                        lte: "lte";
                        gt: "gt";
                        gte: "gte";
                        contains: "contains";
                    }>>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                users: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                                total: {
                                                    type: string;
                                                };
                                                limit: {
                                                    type: string;
                                                };
                                                offset: {
                                                    type: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                users: import("better-auth/plugins").UserWithRole[];
                total: number;
                limit: number | undefined;
                offset: number | undefined;
            } | {
                users: never[];
                total: number;
            }>;
            listUserSessions: import("better-auth").StrictEndpoint<"/admin/list-user-sessions", {
                method: "POST";
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                sessions: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                sessions: import("better-auth/plugins").SessionWithImpersonatedBy[];
            }>;
            unbanUser: import("better-auth").StrictEndpoint<"/admin/unban-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                user: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    email: string;
                    emailVerified: boolean;
                    name: string;
                    image?: string | null | undefined;
                } & Record<string, any>;
            }>;
            banUser: import("better-auth").StrictEndpoint<"/admin/ban-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    banReason: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    banExpiresIn: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                user: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    email: string;
                    emailVerified: boolean;
                    name: string;
                    image?: string | null | undefined;
                } & Record<string, any>;
            }>;
            impersonateUser: import("better-auth").StrictEndpoint<"/admin/impersonate-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                session: {
                                                    $ref: string;
                                                };
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                session: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    userId: string;
                    expiresAt: Date;
                    token: string;
                    ipAddress?: string | null | undefined;
                    userAgent?: string | null | undefined;
                };
                user: import("better-auth/plugins").UserWithRole;
            }>;
            stopImpersonating: import("better-auth").StrictEndpoint<"/admin/stop-impersonating", {
                method: "POST";
                requireHeaders: true;
            }, {
                session: import("better-auth").Session & Record<string, any>;
                user: import("better-auth").User & Record<string, any>;
            }>;
            revokeUserSession: import("better-auth").StrictEndpoint<"/admin/revoke-user-session", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    sessionToken: import("better-auth").ZodString;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            revokeUserSessions: import("better-auth").StrictEndpoint<"/admin/revoke-user-sessions", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            removeUser: import("better-auth").StrictEndpoint<"/admin/remove-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            setUserPassword: import("better-auth").StrictEndpoint<"/admin/set-user-password", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    newPassword: import("better-auth").ZodString;
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                status: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                status: boolean;
            }>;
            userHasPermission: import("better-auth").StrictEndpoint<"/admin/has-permission", {
                method: "POST";
                body: import("better-auth").ZodIntersection<import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodOptional<import("better-auth").ZodCoercedString<unknown>>;
                    role: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                }, import("better-auth").$strip>, import("better-auth").ZodUnion<readonly [import("better-auth").ZodObject<{
                    permission: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                    permissions: import("better-auth").ZodUndefined;
                }, import("better-auth").$strip>, import("better-auth").ZodObject<{
                    permission: import("better-auth").ZodUndefined;
                    permissions: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                }, import("better-auth").$strip>]>>;
                metadata: {
                    openapi: {
                        description: string;
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            permission: {
                                                type: string;
                                                description: string;
                                                deprecated: boolean;
                                            };
                                            permissions: {
                                                type: string;
                                                description: string;
                                            };
                                        };
                                        required: string[];
                                    };
                                };
                            };
                        };
                        responses: {
                            "200": {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                error: {
                                                    type: string;
                                                };
                                                success: {
                                                    type: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: ({
                            permission: {
                                readonly [x: string]: import("better-auth").LiteralString[];
                            };
                            permissions?: never | undefined;
                        } | {
                            permissions: {
                                readonly [x: string]: import("better-auth").LiteralString[];
                            };
                            permission?: never | undefined;
                        }) & {
                            userId?: string | undefined;
                            role?: "user" | "admin";
                        };
                    };
                };
            }, {
                error: null;
                success: boolean;
            }>;
        };
        $ERROR_CODES: {
            readonly FAILED_TO_CREATE_USER: "Failed to create user";
            readonly USER_ALREADY_EXISTS: "User already exists.";
            readonly USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "User already exists. Use another email.";
            readonly YOU_CANNOT_BAN_YOURSELF: "You cannot ban yourself";
            readonly YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: "You are not allowed to change users role";
            readonly YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS: "You are not allowed to create users";
            readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: "You are not allowed to list users";
            readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS: "You are not allowed to list users sessions";
            readonly YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: "You are not allowed to ban users";
            readonly YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: "You are not allowed to impersonate users";
            readonly YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: "You are not allowed to revoke users sessions";
            readonly YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: "You are not allowed to delete users";
            readonly YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD: "You are not allowed to set users password";
            readonly BANNED_USER: "You have been banned from this application";
            readonly YOU_ARE_NOT_ALLOWED_TO_GET_USER: "You are not allowed to get user";
            readonly NO_DATA_TO_UPDATE: "No data to update";
            readonly YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: "You are not allowed to update users";
            readonly YOU_CANNOT_REMOVE_YOURSELF: "You cannot remove yourself";
            readonly YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: "You are not allowed to set a non-existent role value";
            readonly YOU_CANNOT_IMPERSONATE_ADMINS: "You cannot impersonate admins";
            readonly INVALID_ROLE_TYPE: "Invalid role type";
        };
        schema: {
            user: {
                fields: {
                    role: {
                        type: "string";
                        required: false;
                        input: false;
                    };
                    banned: {
                        type: "boolean";
                        defaultValue: false;
                        required: false;
                        input: false;
                    };
                    banReason: {
                        type: "string";
                        required: false;
                        input: false;
                    };
                    banExpires: {
                        type: "date";
                        required: false;
                        input: false;
                    };
                };
            };
            session: {
                fields: {
                    impersonatedBy: {
                        type: "string";
                        required: false;
                    };
                };
            };
        };
        options: NoInfer<import("better-auth/plugins").AdminOptions>;
    }];
};
export declare const createAuth: (ctx: GenericCtx<DataModel>) => import("better-auth").Auth<{
    appName: string;
    baseURL: string;
    basePath: string;
    secret: string;
    database: import("better-auth/adapters/index.mjs").AdapterFactory;
    trustedOrigins: string[];
    emailAndPassword: {
        enabled: true;
    };
    user: {
        additionalFields: {
            role: {
                type: "string";
                required: false;
                defaultValue: string;
                input: true;
            };
        };
    };
    session: {
        expiresIn: number;
        updateAge: number;
    };
    plugins: [{
        id: "convex";
        init: (ctx: import("better-auth").AuthContext<BetterAuthOptions>) => void;
        hooks: {
            before: ({
                matcher(context: import("better-auth").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    context: {
                        headers: Headers;
                    };
                } | undefined>;
            } | {
                matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    context: import("better-auth").MiddlewareContext<import("better-auth").MiddlewareOptions, import("better-auth").AuthContext<BetterAuthOptions> & {
                        returned?: unknown | undefined;
                        responseHeaders?: Headers | undefined;
                    }>;
                }>;
            })[];
            after: ({
                matcher(): true;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<Response | {
                    redirect: boolean;
                    url: string;
                } | undefined>;
            } | {
                matcher: (ctx: import("better-auth").HookEndpointContext) => boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<void>;
            })[];
        };
        endpoints: {
            getOpenIdConfig: import("better-auth").StrictEndpoint<"/convex/.well-known/openid-configuration", {
                method: "GET";
                metadata: {
                    isAction: false;
                };
            }, import("better-auth/plugins").OIDCMetadata>;
            getJwks: import("better-auth").StrictEndpoint<"/convex/jwks", {
                method: "GET";
                metadata: {
                    openapi: {
                        description: string;
                        responses: {
                            "200": {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                keys: {
                                                    type: string;
                                                    description: string;
                                                    items: {
                                                        type: string;
                                                        properties: {
                                                            kid: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            kty: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            alg: {
                                                                type: string;
                                                                description: string;
                                                            };
                                                            use: {
                                                                type: string;
                                                                description: string;
                                                                enum: string[];
                                                                nullable: boolean;
                                                            };
                                                            n: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            e: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            crv: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            x: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                            y: {
                                                                type: string;
                                                                description: string;
                                                                nullable: boolean;
                                                            };
                                                        };
                                                        required: string[];
                                                    };
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, import("better-auth").JSONWebKeySet>;
            getLatestJwks: import("better-auth").StrictEndpoint<"/convex/latest-jwks", {
                isAction: boolean;
                method: "POST";
                metadata: {
                    SERVER_ONLY: true;
                    openapi: {
                        description: string;
                    };
                };
            }, any[]>;
            rotateKeys: import("better-auth").StrictEndpoint<"/convex/rotate-keys", {
                isAction: boolean;
                method: "POST";
                metadata: {
                    SERVER_ONLY: true;
                    openapi: {
                        description: string;
                    };
                };
            }, any[]>;
            getToken: import("better-auth").StrictEndpoint<"/convex/token", {
                method: "GET";
                requireHeaders: true;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        session: Record<string, any> & {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            userId: string;
                            expiresAt: Date;
                            token: string;
                            ipAddress?: string | null | undefined;
                            userAgent?: string | null | undefined;
                        };
                        user: Record<string, any> & {
                            id: string;
                            createdAt: Date;
                            updatedAt: Date;
                            email: string;
                            emailVerified: boolean;
                            name: string;
                            image?: string | null | undefined;
                        };
                    };
                }>)[];
                metadata: {
                    openapi: {
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                token: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                token: string;
            }>;
        };
        schema: {
            jwks: {
                fields: {
                    publicKey: {
                        type: "string";
                        required: true;
                    };
                    privateKey: {
                        type: "string";
                        required: true;
                    };
                    createdAt: {
                        type: "date";
                        required: true;
                    };
                    expiresAt: {
                        type: "date";
                        required: false;
                    };
                };
            };
            user: {
                readonly fields: {
                    readonly userId: {
                        readonly type: "string";
                        readonly required: false;
                        readonly input: false;
                    };
                };
            };
        };
    }, {
        id: "admin";
        init(): {
            options: {
                databaseHooks: {
                    user: {
                        create: {
                            before(user: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                email: string;
                                emailVerified: boolean;
                                name: string;
                                image?: string | null | undefined;
                            } & Record<string, unknown>): Promise<{
                                data: {
                                    id: string;
                                    createdAt: Date;
                                    updatedAt: Date;
                                    email: string;
                                    emailVerified: boolean;
                                    name: string;
                                    image?: string | null | undefined;
                                    role: string;
                                };
                            }>;
                        };
                    };
                    session: {
                        create: {
                            before(session: {
                                id: string;
                                createdAt: Date;
                                updatedAt: Date;
                                userId: string;
                                expiresAt: Date;
                                token: string;
                                ipAddress?: string | null | undefined;
                                userAgent?: string | null | undefined;
                            } & Record<string, unknown>, ctx: import("better-auth").GenericEndpointContext | null): Promise<void>;
                        };
                    };
                };
            };
        };
        hooks: {
            after: {
                matcher(context: import("better-auth").HookEndpointContext): boolean;
                handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<import("better-auth/plugins").SessionWithImpersonatedBy[] | undefined>;
            }[];
        };
        endpoints: {
            setRole: import("better-auth").StrictEndpoint<"/admin/set-role", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    role: import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>;
                }, import("better-auth").$strip>;
                requireHeaders: true;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: {
                            userId: string;
                            role: "user" | "admin" | ("user" | "admin")[];
                        };
                    };
                };
            }, {
                user: import("better-auth/plugins").UserWithRole;
            }>;
            getUser: import("better-auth").StrictEndpoint<"/admin/get-user", {
                method: "GET";
                query: import("better-auth").ZodObject<{
                    id: import("better-auth").ZodString;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                email: string;
                emailVerified: boolean;
                name: string;
                image?: string | null | undefined;
            }>;
            createUser: import("better-auth").StrictEndpoint<"/admin/create-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    email: import("better-auth").ZodString;
                    password: import("better-auth").ZodString;
                    name: import("better-auth").ZodString;
                    role: import("better-auth").ZodOptional<import("better-auth").ZodUnion<readonly [import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>]>>;
                    data: import("better-auth").ZodOptional<import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodAny>>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: {
                            email: string;
                            password: string;
                            name: string;
                            role?: "user" | "admin" | ("user" | "admin")[] | undefined;
                            data?: Record<string, any> | undefined;
                        };
                    };
                };
            }, {
                user: import("better-auth/plugins").UserWithRole;
            }>;
            adminUpdateUser: import("better-auth").StrictEndpoint<"/admin/update-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    data: import("better-auth").ZodRecord<import("better-auth").ZodAny, import("better-auth").ZodAny>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, import("better-auth/plugins").UserWithRole>;
            listUsers: import("better-auth").StrictEndpoint<"/admin/list-users", {
                method: "GET";
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                query: import("better-auth").ZodObject<{
                    searchValue: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    searchField: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        name: "name";
                        email: "email";
                    }>>;
                    searchOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        contains: "contains";
                        starts_with: "starts_with";
                        ends_with: "ends_with";
                    }>>;
                    limit: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                    offset: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>>;
                    sortBy: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    sortDirection: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        asc: "asc";
                        desc: "desc";
                    }>>;
                    filterField: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    filterValue: import("better-auth").ZodOptional<import("better-auth").ZodUnion<[import("better-auth").ZodUnion<[import("better-auth").ZodString, import("better-auth").ZodNumber]>, import("better-auth").ZodBoolean]>>;
                    filterOperator: import("better-auth").ZodOptional<import("better-auth").ZodEnum<{
                        eq: "eq";
                        ne: "ne";
                        lt: "lt";
                        lte: "lte";
                        gt: "gt";
                        gte: "gte";
                        contains: "contains";
                    }>>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                users: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                                total: {
                                                    type: string;
                                                };
                                                limit: {
                                                    type: string;
                                                };
                                                offset: {
                                                    type: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                users: import("better-auth/plugins").UserWithRole[];
                total: number;
                limit: number | undefined;
                offset: number | undefined;
            } | {
                users: never[];
                total: number;
            }>;
            listUserSessions: import("better-auth").StrictEndpoint<"/admin/list-user-sessions", {
                method: "POST";
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                sessions: {
                                                    type: string;
                                                    items: {
                                                        $ref: string;
                                                    };
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                sessions: import("better-auth/plugins").SessionWithImpersonatedBy[];
            }>;
            unbanUser: import("better-auth").StrictEndpoint<"/admin/unban-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                user: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    email: string;
                    emailVerified: boolean;
                    name: string;
                    image?: string | null | undefined;
                } & Record<string, any>;
            }>;
            banUser: import("better-auth").StrictEndpoint<"/admin/ban-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                    banReason: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                    banExpiresIn: import("better-auth").ZodOptional<import("better-auth").ZodNumber>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                user: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    email: string;
                    emailVerified: boolean;
                    name: string;
                    image?: string | null | undefined;
                } & Record<string, any>;
            }>;
            impersonateUser: import("better-auth").StrictEndpoint<"/admin/impersonate-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                session: {
                                                    $ref: string;
                                                };
                                                user: {
                                                    $ref: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                session: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    userId: string;
                    expiresAt: Date;
                    token: string;
                    ipAddress?: string | null | undefined;
                    userAgent?: string | null | undefined;
                };
                user: import("better-auth/plugins").UserWithRole;
            }>;
            stopImpersonating: import("better-auth").StrictEndpoint<"/admin/stop-impersonating", {
                method: "POST";
                requireHeaders: true;
            }, {
                session: import("better-auth").Session & Record<string, any>;
                user: import("better-auth").User & Record<string, any>;
            }>;
            revokeUserSession: import("better-auth").StrictEndpoint<"/admin/revoke-user-session", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    sessionToken: import("better-auth").ZodString;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            revokeUserSessions: import("better-auth").StrictEndpoint<"/admin/revoke-user-sessions", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            removeUser: import("better-auth").StrictEndpoint<"/admin/remove-user", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                success: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                success: boolean;
            }>;
            setUserPassword: import("better-auth").StrictEndpoint<"/admin/set-user-password", {
                method: "POST";
                body: import("better-auth").ZodObject<{
                    newPassword: import("better-auth").ZodString;
                    userId: import("better-auth").ZodCoercedString<unknown>;
                }, import("better-auth").$strip>;
                use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{
                    session: {
                        user: import("better-auth/plugins").UserWithRole;
                        session: import("better-auth").Session;
                    };
                }>)[];
                metadata: {
                    openapi: {
                        operationId: string;
                        summary: string;
                        description: string;
                        responses: {
                            200: {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                status: {
                                                    type: string;
                                                };
                                            };
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            }, {
                status: boolean;
            }>;
            userHasPermission: import("better-auth").StrictEndpoint<"/admin/has-permission", {
                method: "POST";
                body: import("better-auth").ZodIntersection<import("better-auth").ZodObject<{
                    userId: import("better-auth").ZodOptional<import("better-auth").ZodCoercedString<unknown>>;
                    role: import("better-auth").ZodOptional<import("better-auth").ZodString>;
                }, import("better-auth").$strip>, import("better-auth").ZodUnion<readonly [import("better-auth").ZodObject<{
                    permission: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                    permissions: import("better-auth").ZodUndefined;
                }, import("better-auth").$strip>, import("better-auth").ZodObject<{
                    permission: import("better-auth").ZodUndefined;
                    permissions: import("better-auth").ZodRecord<import("better-auth").ZodString, import("better-auth").ZodArray<import("better-auth").ZodString>>;
                }, import("better-auth").$strip>]>>;
                metadata: {
                    openapi: {
                        description: string;
                        requestBody: {
                            content: {
                                "application/json": {
                                    schema: {
                                        type: "object";
                                        properties: {
                                            permission: {
                                                type: string;
                                                description: string;
                                                deprecated: boolean;
                                            };
                                            permissions: {
                                                type: string;
                                                description: string;
                                            };
                                        };
                                        required: string[];
                                    };
                                };
                            };
                        };
                        responses: {
                            "200": {
                                description: string;
                                content: {
                                    "application/json": {
                                        schema: {
                                            type: "object";
                                            properties: {
                                                error: {
                                                    type: string;
                                                };
                                                success: {
                                                    type: string;
                                                };
                                            };
                                            required: string[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                    $Infer: {
                        body: ({
                            permission: {
                                readonly [x: string]: import("better-auth").LiteralString[];
                            };
                            permissions?: never | undefined;
                        } | {
                            permissions: {
                                readonly [x: string]: import("better-auth").LiteralString[];
                            };
                            permission?: never | undefined;
                        }) & {
                            userId?: string | undefined;
                            role?: "user" | "admin";
                        };
                    };
                };
            }, {
                error: null;
                success: boolean;
            }>;
        };
        $ERROR_CODES: {
            readonly FAILED_TO_CREATE_USER: "Failed to create user";
            readonly USER_ALREADY_EXISTS: "User already exists.";
            readonly USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "User already exists. Use another email.";
            readonly YOU_CANNOT_BAN_YOURSELF: "You cannot ban yourself";
            readonly YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE: "You are not allowed to change users role";
            readonly YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS: "You are not allowed to create users";
            readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS: "You are not allowed to list users";
            readonly YOU_ARE_NOT_ALLOWED_TO_LIST_USERS_SESSIONS: "You are not allowed to list users sessions";
            readonly YOU_ARE_NOT_ALLOWED_TO_BAN_USERS: "You are not allowed to ban users";
            readonly YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: "You are not allowed to impersonate users";
            readonly YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS: "You are not allowed to revoke users sessions";
            readonly YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS: "You are not allowed to delete users";
            readonly YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD: "You are not allowed to set users password";
            readonly BANNED_USER: "You have been banned from this application";
            readonly YOU_ARE_NOT_ALLOWED_TO_GET_USER: "You are not allowed to get user";
            readonly NO_DATA_TO_UPDATE: "No data to update";
            readonly YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS: "You are not allowed to update users";
            readonly YOU_CANNOT_REMOVE_YOURSELF: "You cannot remove yourself";
            readonly YOU_ARE_NOT_ALLOWED_TO_SET_NON_EXISTENT_VALUE: "You are not allowed to set a non-existent role value";
            readonly YOU_CANNOT_IMPERSONATE_ADMINS: "You cannot impersonate admins";
            readonly INVALID_ROLE_TYPE: "Invalid role type";
        };
        schema: {
            user: {
                fields: {
                    role: {
                        type: "string";
                        required: false;
                        input: false;
                    };
                    banned: {
                        type: "boolean";
                        defaultValue: false;
                        required: false;
                        input: false;
                    };
                    banReason: {
                        type: "string";
                        required: false;
                        input: false;
                    };
                    banExpires: {
                        type: "date";
                        required: false;
                        input: false;
                    };
                };
            };
            session: {
                fields: {
                    impersonatedBy: {
                        type: "string";
                        required: false;
                    };
                };
            };
        };
        options: NoInfer<import("better-auth/plugins").AdminOptions>;
    }];
}>;
