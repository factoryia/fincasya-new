/**
 * Bot v2 — Tipos base del FSM.
 *
 * Fases (en orden estricto):
 *   welcome → collecting → catalog_sent → pet_check → contract → done
 *   (quote_shown solo por sesiones antiguas)
 *   (property_selected se mantiene por compatibilidad con sesiones antiguas)
 *
 * No se puede saltar fases hacia atrás (salvo reset explícito).
 */

export type BotPhase =
  | "welcome"          // primer mensaje: bienvenida oficial
  | "collecting"       // location, fechas, cupo, planType, isEvento (descanso vs evento en finca)
  | "catalog_sent"     // catálogo enviado, esperando que el cliente elija finca
  | "property_selected"// cliente nombró/tocó una finca
  | "pet_check"        // preguntando mascotas + reglas
  | "quote_shown"      // cotización con precio+temporada enviada, esperando confirmación
  | "contract"         // recolectando datos del contrato
  | "done";            // contrato recibido, escalado a humano

/** Datos de negocio que vamos acumulando turno a turno. */
export interface BotEntities {
  location?: string;          // municipio exacto del cliente o "RECOMENDADAS"
  checkIn?: string;           // YYYY-MM-DD
  checkOut?: string;          // YYYY-MM-DD
  cupo?: number;              // personas (niños 2+ cuentan)
  isEvento?: boolean;         // true=evento, false=descanso (undefined=no confirmado)
  planType?: string;          // "familia" | "amigos" | "pareja" | "empresa" | "otro"
  selectedPropertyRetailerId?: string;
  selectedPropertyName?: string;
  /** Cliente eligió una ficha del catálogo (ej. "quiero esta") aunque no haya nombre/retailer en texto. */
  catalogUserPickedReply?: boolean;
  hasPets?: boolean;
  petCount?: number;
  contractName?: string;
  contractCedula?: string;
  contractEmail?: string;
  contractPhone?: string;
  contractAddress?: string;
}

/** Datos mínimos para poder enviar el catálogo. */
export interface CatalogReadyEntities {
  location: string;
  checkIn: string;
  checkOut: string;
  cupo: number;
  isEvento: boolean;
}

/** Lo que el extractor devuelve tras analizar 1 mensaje del cliente. */
export interface ExtractedEntities {
  location?: string;
  checkIn?: string;
  checkOut?: string;
  cupo?: number;
  isEvento?: boolean;
  planType?: string;
  selectedPropertyName?: string;   // si el cliente nombró una finca
  hasPets?: boolean;
  petCount?: number;
  contractFields?: Partial<Pick<BotEntities, "contractName"|"contractCedula"|"contractEmail"|"contractPhone"|"contractAddress">>;
  wantsRecomendadas?: boolean;     // dijo "no sé", "recomiéndame", etc.
}

/** Qué acción debe ejecutar el orquestador después de generar el reply. */
export type BotAction =
  | { type: "reply_only" }
  | { type: "send_catalog"; location: string; checkIn: string; checkOut: string; cupo: number; isEvento: boolean }
  | { type: "escalate_human" };

/** Resultado que devuelve el orquestador por turno. */
export interface BotTurnResult {
  replyText: string;
  action: BotAction;
  nextPhase: BotPhase;
  updatedEntities: BotEntities;
}
