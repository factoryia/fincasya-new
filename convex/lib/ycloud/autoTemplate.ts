/**
 * Detección de la PLANTILLA DE SALUDO AUTOMÁTICA de WhatsApp.
 *
 * FincasYa tiene configurado en WhatsApp Business (o YCloud) un mensaje de
 * bienvenida que se envía SOLO cuando el cliente escribe (ej. "Gracias por
 * comunicarte con FINCASYA.COM… En breve te brindaremos atención personalizada…").
 *
 * Ese saliente llega por el webhook de YCloud y, por defecto, el sistema lo
 * registraba como si un ASESOR HUMANO hubiera contestado (`markOutboundAsHuman`
 * + `source: ycloud_outbound_webhook`). Eso hacía que el detector "asesor
 * activo" BLOQUEARA al bot: el cliente escribía "hola", la plantilla salía sola,
 * y el bot creía que ya lo atendía un humano → se quedaba mudo.
 *
 * Este helper reconoce esa plantilla por frases distintivas y estables para
 * tratarla como AUTOMÁTICA (no humana). Match en minúsculas. Los marcadores se
 * eligieron sin acentos para que el match sea robusto. Si el equipo cambia el
 * texto del saludo, actualizar los marcadores.
 */
const AUTO_REPLY_TEMPLATE_MARKERS = [
  "gracias por comunicarte con fincasya",
  "en breve te brindaremos",
];

/** True si el contenido es la plantilla de saludo automática (no un humano). */
export function isAutomatedGreetingTemplate(content: string): boolean {
  const c = String(content ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (c.length < 10) return false;
  return AUTO_REPLY_TEMPLATE_MARKERS.some((m) => c.includes(m));
}

/** Fuente de metadata para el saliente automático (≠ ycloud_outbound_webhook,
 *  para que `hasRecentHumanAdvisorMessages` NO lo cuente como asesor). */
export const AUTO_TEMPLATE_METADATA_SOURCE = "whatsapp_auto_template" as const;
