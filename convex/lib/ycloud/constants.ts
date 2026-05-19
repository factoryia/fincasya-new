export const SESSION_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_REACTIVATE_TTL_MS = 72 * 60 * 60 * 1000;
export const FALLBACK_CATALOG_ID = "1560075992300705";

/**
 * Máximo de fichas de catálogo WhatsApp por ENVÍO (una tarjeta por finca, no
 * lista agrupada). WhatsApp permite hasta 30 productos por mensaje interactivo;
 * usamos 12 como balance: el cliente ve opciones suficientes sin scroll
 * infinito, y si pide "ver más" se le envía OTRO batch de 12 distintas (ver
 * paginación con `excludeRetailerIds` en `whatsappCatalogs.ts`).
 *
 * Si el query del catálogo devuelve menos de este número, se mandan todas las
 * que haya (no se rellena artificialmente).
 */
export const MAX_CATALOG_PRODUCTS_PER_SEND = 12;

/**
 * Espera antes de procesar un inbound: da tiempo a que el usuario mande 2+ burbujas seguidas.
 * Luego `inbound.ts` vuelve a comprobar que este mensaje siga siendo el último (y tras runBotTurn).
 */
export const INBOUND_DEBOUNCE_MS = 4000;
