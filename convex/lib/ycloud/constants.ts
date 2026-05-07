export const SESSION_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_REACTIVATE_TTL_MS = 72 * 60 * 60 * 1000;
export const FALLBACK_CATALOG_ID = "1560075992300705";

/** Máximo de fichas de catálogo WhatsApp por envío (una tarjeta por finca, no lista agrupada). */
export const MAX_CATALOG_PRODUCTS_PER_SEND = 10;

/**
 * Espera antes de procesar un inbound: da tiempo a que el usuario mande 2+ burbujas seguidas.
 * Luego `inbound.ts` vuelve a comprobar que este mensaje siga siendo el último (y tras runBotTurn).
 */
export const INBOUND_DEBOUNCE_MS = 4000;
