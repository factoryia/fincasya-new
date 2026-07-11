export const SESSION_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_REACTIVATE_TTL_MS = 72 * 60 * 60 * 1000;
export const FALLBACK_CATALOG_ID = "1356998359824441";

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
export const MAX_CATALOG_PRODUCTS_PER_SEND = 20;

/** Pausa entre fichas de catálogo WhatsApp — evita que Meta las agrupe en "Catálogo enviado". */
export const CATALOG_BETWEEN_SENDS_MS = 1500;

/** Ventana para agrupar fichas del mismo envío (paginación / pick ambiguo). */
export const CATALOG_SEND_BATCH_WINDOW_MS =
  MAX_CATALOG_PRODUCTS_PER_SEND * CATALOG_BETWEEN_SENDS_MS + 4000;

/**
 * Espera antes de procesar un inbound: da tiempo a que el usuario mande 2+
 * burbujas seguidas. Luego `inbound.ts` vuelve a comprobar que este mensaje
 * siga siendo el último (y tras runBotTurn).
 *
 * 7 s (antes 4 s): los clientes de WhatsApp escriben mensaje por mensaje y
 * suelen tardar 5-10 s entre uno y otro mientras tipean. Con 4 s, un burst
 * tipo "Hola" → (escribe 6 s) → "quiero una finca en Melgar" se partía en dos
 * turnos y el bot respondía dos veces (welcome + missing fields repetido).
 * Con 7 s la mayoría de bursts se juntan en un solo turno. El costo es que la
 * respuesta a un mensaje único se demora ~7 s, lo cual es aceptable en
 * WhatsApp (el cliente está acostumbrado a un "escribiendo…").
 */
export const INBOUND_DEBOUNCE_MS = 7000;

/** Ventana para continuidad de asesor: mensajes humanos recientes en inbox. */
export const ADVISOR_ACTIVITY_WINDOW_MS = 48 * 60 * 60 * 1000;
