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
  | "pet_check"        // preguntando si lleva mascotas (y cuántas)
  | "pet_rules_shown"  // se enviaron las reglas de mascotas, esperando confirmación para mostrar resumen
  | "quote_shown"      // resumen con totales enviado, esperando confirmación para pedir datos de contrato
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
  /**
   * Macro-zonas que el cliente pidió EVITAR. Las clasifica el LLM extractor
   * interpretando la intención (cualquier fraseo: "no llanos", "todos menos
   * el llano", "que no sea Villavicencio", "lejos de la costa"…). Valores:
   * "LLANOS" | "TOLIMA" | "CUNDINAMARCA" | "COSTA". El catálogo filtra fuera
   * los municipios de estas zonas (`REGIONS` en `inbound.ts`). Persiste entre
   * turnos (el cliente lo dice una vez y aplica a toda la búsqueda).
   */
  excludedRegions?: string[];
  selectedPropertyRetailerId?: string;
  selectedPropertyName?: string;
  /** Cliente eligió una ficha del catálogo (ej. "quiero esta") aunque no haya nombre/retailer en texto. */
  catalogUserPickedReply?: boolean;
  /** El aviso de puente festivo (mínimo 2 noches en fines de semana con puente)
   *  ya se mostró para las fechas actuales: no volver a bloquearlo en el siguiente turno. */
  puenteAcknowledged?: boolean;
  hasPets?: boolean;
  petCount?: number;
  /**
   * Total de personas que asisten al evento (dormir + pasadía). Solo aplica
   * cuando `isEvento === true`. Puede ser mayor que `cupo` (que solo cuenta
   * hospedaje). Se usa para filtrar el catálogo por capacidad de evento de
   * la finca (cuando aplica), no por capacidad de hospedaje.
   */
  eventPeopleCount?: number;
  /**
   * Tipo de logística que lleva el evento, según lo declarado por el cliente:
   *   "basic" — solo el sonido básico de la finca, ambiente tranquilo.
   *   "extra" — sonido profesional, DJ, iluminación, banda en vivo, mariachis,
   *             grupos musicales o cualquier combinación de las anteriores.
   * El asesor humano confirma detalles puntuales (qué grupo, qué horario, etc.)
   * en el contrato. Para el bot basta este flag.
   */
  eventLogistics?: "basic" | "extra";
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

/** Datos numéricos de la cotización de alojamiento (no texto). Permiten al bot
 *  calcular totales extra (mascotas) y mostrar GRAN total al cliente. */
export interface StayQuoteTotals {
  propertyTitle: string;
  nightly: number;
  nightsCount: number;
  subtotal: number;
  appliedRule: string;
  /** Cupo solicitado por el cliente (de las entidades, no del precio). */
  cupo: number;
  /** Depósito reembolsable por daños (configurado en la finca). */
  damageDeposit?: number;
  /** Manilla de condominio (configurado en la finca). */
  wristbandFee?: number;
}

/** Resultado de `fetchStayQuote`: texto formateado + totales numéricos para cálculos. */
export interface StayQuoteResult {
  /** Texto ya formateado (la versión legacy que se inyecta en el system prompt del LLM). */
  text: string;
  /** Números crudos para cálculos. Puede ser undefined si la query no los devolvió. */
  totals?: StayQuoteTotals;
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
  eventPeopleCount?: number;
  eventLogistics?: "basic" | "extra";
  contractFields?: Partial<Pick<BotEntities, "contractName"|"contractCedula"|"contractEmail"|"contractPhone"|"contractAddress">>;
  wantsRecomendadas?: boolean;     // dijo "no sé", "recomiéndame", etc.
  /** Macro-zonas que el cliente pide EVITAR (ver `BotEntities.excludedRegions`). */
  excludedRegions?: string[];
  /**
   * Clasificación LLM de si el mensaje confirma/niega la última pregunta del bot.
   * "yes" → cliente confirmó (incluye typos: "si pro favor", combos "claro dale",
   *         frustración "ya te dije que sí", coloquialismos "vale", "chevere", etc.)
   * "no"  → cliente negó.
   * null  → ambiguo / no es respuesta directa.
   *
   * Reemplaza la heurística regex `clientConfirms` para casos donde el regex
   * no captura todas las variantes naturales de lenguaje.
   */
  confirmsCurrentStep?: "yes" | "no" | null;
  /**
   * Clasificación LLM de si el cliente pide EXPLÍCITAMENTE un asesor humano.
   * `true` solo cuando es inequívoco ("hablar con un asesor", "este bot no me
   * sirve", "pásame con alguien real"). `false`/omitido para mensajes que solo
   * dan datos de la reserva (ej. "somos 13 personas" — el regex viejo
   * escalaba por la palabra "persona", el LLM ahora lo entiende como cupo).
   */
  requestsHumanAgent?: boolean;
}

/** Qué acción debe ejecutar el orquestador después de generar el reply. */
export type BotAction =
  | { type: "reply_only" }
  | {
      type: "send_catalog";
      location: string;
      checkIn: string;
      checkOut: string;
      cupo: number;
      isEvento: boolean;
      /**
       * True cuando el cliente pidió "ver más" / "más opciones". El orquestador
       * (`inbound.ts`) cargará TODOS los retailerIds ya enviados en esta
       * conversación y los pasará como `excludeRetailerIds` al query del
       * catálogo, devolviendo el siguiente batch de fincas distintas.
       */
      paginate?: boolean;
    }
  | {
      type: "escalate_human";
      /** Quién disparó la escalada (para alertas en inbox). */
      reason?:
        | "contract_complete"
        | "stuck_loop"
        | "pets_exceed_limit"
        | "catalog_no_results"
        | "event_after_catalog"
        | "media_post_catalog"
        | "client_requested"
        | "stage1_catalog_pick";
    };

/**
 * Etiquetas de NEGOCIO activas en la conversación, traducidas a flags que
 * el system prompt del LLM puede usar para ajustar tono y comportamiento.
 *
 * Las etiquetas en sí son strings libres en `conversations.tags`. Las
 * predefinidas (`cliente-importante`, `cliente-especial`, `cliente-complicado`,
 * `cliente-recurrente`) las mapeamos a estas flags. Las que implican handoff
 * inmediato (`cliente-grosero`, `propietario`, `reserva-activa`) NO viajan
 * en este objeto — `inbound.ts` ya escaló la conversación antes de llegar
 * al bot, así que el LLM ni se ejecuta.
 */
export interface ConversationTagFlags {
  /** `cliente-importante` o `cliente-especial`. */
  isVip?: boolean;
  /** `cliente-complicado`. */
  isDifficult?: boolean;
  /** `cliente-recurrente` (auto-set por `findRecentCommercialByPhone`). */
  isReturning?: boolean;
}

/** Resultado que devuelve el orquestador por turno. */
export interface BotTurnResult {
  /** Primer mensaje a enviar. Para WhatsApp es lo único cuando hay un solo mensaje. */
  replyText: string;
  /**
   * Mensajes adicionales que el orquestador envía DESPUÉS de `replyText`, en orden,
   * con un pequeño delay entre cada uno para que el cliente los reciba como burbujas
   * separadas. Útil para descomponer paquetes largos (ej. tras `pet_check` mandamos
   * mascotas / resumen / contrato como 3 burbujas distintas en lugar de un muro
   * de texto). Vacío o undefined cuando solo hay un mensaje.
   */
  additionalMessages?: string[];
  action: BotAction;
  nextPhase: BotPhase;
  updatedEntities: BotEntities;
  /** Turnos consecutivos en la misma fase (incluyendo este). 0 si cambió de fase. */
  samePhaseTurnCount: number;
  /** Timestamp cuando se entró a la fase actual. */
  phaseEnteredAt: number;
  /** true si este turno inyectó ejemplos del playbook en el LLM. */
  playbookUsed?: boolean;
}
