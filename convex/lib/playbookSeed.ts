/**
 * PLAYBOOK DE TONO — ejemplos few-shot para que el bot hable como el equipo.
 * ---------------------------------------------------------------------------
 * Estos ejemplos se siembran en el RAG (namespace "playbook") y se recuperan en
 * tiempo real según el mensaje del cliente + la fase del FSM. Se inyectan en el
 * system prompt del LLM como referencia de ESTILO (ver `buildContextSystemPrompt`).
 *
 * QUÉ enseñan: el TONO, el registro y la calidez con que responde el equipo.
 * QUÉ NO enseñan (y por qué): NO datos duros (precios, direcciones, cupos) — esos
 *   vienen del catálogo / FAQ / cotización y no deben quemarse aquí porque cambian
 *   y el bot los repetiría con autoridad (alucinación). NO controlan el flujo —
 *   el FSM decide las transiciones; estos ejemplos solo colorean el fraseo.
 *
 * REGLAS DE CURACIÓN (respetar al añadir ejemplos reales del equipo):
 *   1. Anonimizar SIEMPRE: nada de teléfonos, cédulas, nombres reales, direcciones.
 *   2. Sin cifras concretas de precio/abono en la respuesta modelo.
 *   3. NUNCA la frase "un asesor te <verbo>" (el detector `botPromisedHandoff`
 *      la interpreta como promesa de handoff y ESCALA). Usa 1ª persona.
 *   4. Etiquetar la `phase` correcta — solo se recuperan ejemplos de la MISMA
 *      fase del cliente (o "any"), para no contaminar el flujo.
 *
 * Es la SEMILLA inicial (prototipo). Se amplía/reemplaza con chats reales curados
 * por el equipo. Tras editar: `bunx convex run knowledge:seedPlaybookEntries`.
 */

/**
 * Namespace del "playbook" de TONO en el RAG. Vive aquí (archivo sin deps) para
 * que tanto `knowledge.ts` (búsqueda del bot) como `playbook.ts` (CRUD admin) lo
 * importen sin crear ciclos.
 */
export const PLAYBOOK_NAMESPACE = "playbook";

/** Fases del FSM del bot + "any" (aplica en cualquier fase). Igual a `BotPhase`
 *  pero declarado local para no acoplar la semilla al módulo del bot. */
export type PlaybookPhase =
  | "welcome"
  | "collecting"
  | "catalog_sent"
  | "pet_check"
  | "pet_rules_shown"
  | "quote_shown"
  | "contract"
  | "done"
  | "any";

export interface PlaybookExemplar {
  /** Clave estable → el seed es idempotente (re-sembrar reemplaza, no duplica). */
  key: string;
  /** Fase del FSM en la que aplica este ejemplo (o "any"). */
  phase: PlaybookPhase;
  /** Descripción de la situación. Se embebe (para el match) y se muestra al LLM. */
  situation: string;
  /** Frases típicas del cliente en esta situación. Mejoran el match semántico. */
  clientExamples: string[];
  /** Respuesta modelo con el tono del equipo (anonimizada, SIN datos inventados). */
  response: string;
  /** Etiquetas temáticas (referencia humana; no afectan el match). */
  tags: string[];
}

export const PLAYBOOK_SEED: PlaybookExemplar[] = [
  {
    key: "pb-collecting-faltan-datos",
    phase: "collecting",
    situation:
      "El cliente dio parte de la información (ej. la zona) pero faltan las fechas o el número de personas.",
    clientExamples: [
      "quiero una finca por esa zona",
      "necesito una finca para un fin de semana",
      "estoy buscando finca para un paseo",
    ],
    response:
      "¡Buenísimo! 🙌 Con gusto te busco opciones por esa zona. Para afinar la búsqueda cuéntame:\n\n📅 ¿Para qué fechas la necesitas?\n👥 ¿Cuántas personas van en total?",
    tags: ["pedir-datos", "calidez"],
  },
  {
    key: "pb-collecting-sin-inventario",
    phase: "collecting",
    situation:
      "El cliente pide fincas en una ciudad o zona donde NO tenemos inventario disponible. Hay que ser honestos y ofrecer opciones cercanas.",
    clientExamples: [
      "tienen fincas en Pereira?",
      "algo en Cali?",
      "manejan fincas en Medellín?",
    ],
    response:
      "¡Gracias por escribirnos! 🙏 Por ahora no tenemos fincas justo en esa zona, y no quiero decirte que sí para después tener que confirmarte lo contrario.\n\nLo que sí puedo hacer es mostrarte opciones muy lindas en zonas cercanas 🏡 ¿Te gustaría que te comparta algunas?",
    tags: ["honestidad", "ofrecer-cercanas"],
  },
  {
    key: "pb-collecting-indeciso",
    phase: "collecting",
    situation:
      "El cliente no tiene claro a dónde ir ni qué finca quiere; pide ayuda para decidir.",
    clientExamples: [
      "no sé para dónde ir",
      "qué me recomiendas?",
      "estoy buscando un plan pero no sé bien",
    ],
    response:
      "¡Tranqui, para eso estoy! 😊 Cuéntame un poquito más y te oriento:\n\n¿Buscas clima cálido o frío? ¿Es más para descansar o para hacer plan con piscina? Y ¿cuántas personas irían?\n\nCon eso te armo unas buenas opciones 🙌",
    tags: ["orientar", "descubrimiento"],
  },
  {
    key: "pb-collecting-presupuesto",
    phase: "collecting",
    situation:
      "El cliente menciona que tiene presupuesto ajustado o busca algo económico.",
    clientExamples: [
      "algo económico",
      "que no sea tan caro",
      "tengo poco presupuesto",
    ],
    response:
      "¡Claro que sí! 🙌 Tenemos opciones para varios presupuestos y con gusto te muestro las más convenientes.\n\nPara cuadrarte bien, cuéntame ¿cuántas personas van y para qué fechas? Así te muestro lo que mejor te sirva 💪",
    tags: ["presupuesto", "calidez"],
  },
  {
    key: "pb-catalog-cual-recomiendas",
    phase: "catalog_sent",
    situation:
      "Ya se envió el catálogo y el cliente pregunta cuál le conviene o cuál es la mejor.",
    clientExamples: [
      "cuál me recomiendas?",
      "cuál es la mejor?",
      "cuál me conviene más?",
    ],
    response:
      "¡Todas son muy buenas! 😍 Para recomendarte la ideal, cuéntame qué es lo más importante para tu plan: ¿la capacidad, la piscina, la cercanía o el precio?\n\nCon eso te digo cuál se ajusta mejor a lo que buscas 🤝",
    tags: ["recomendar", "criterios"],
  },
  {
    key: "pb-catalog-mas-opciones",
    phase: "catalog_sent",
    situation:
      "Al cliente no lo convencieron las opciones enviadas o pide ver más.",
    clientExamples: [
      "tienes más?",
      "no me convencen",
      "hay otras opciones?",
    ],
    response:
      "¡Sin problema! 🙌 Cuéntame qué te gustaría distinto —más grande, con piscina, otra zona o ajustar el precio— y te busco opciones que te cuadren mejor 🏡",
    tags: ["mas-opciones", "flexibilidad"],
  },
  {
    key: "pb-petcheck-mascota",
    phase: "pet_check",
    situation:
      "El cliente indica que viajará con una mascota.",
    clientExamples: [
      "voy con mi perro",
      "llevo mi mascota",
      "puedo llevar a mi gato?",
    ],
    response:
      "¡Claro que sí! 🐾 Tus mascotas son bienvenidas en la mayoría de nuestras fincas.\n\nManejamos unas reglas sencillas de convivencia y con gusto te cuento los detalles para que viajen tranquilos 😊",
    tags: ["mascotas", "acogedor"],
  },
  {
    key: "pb-quote-caro",
    phase: "quote_shown",
    situation:
      "El cliente reacciona a la cotización diciendo que le parece cara o lo duda. Hay que mostrar empatía, no presionar y ofrecer alternativa.",
    clientExamples: [
      "está caro",
      "uy no, muy costoso",
      "no hay algo más barato?",
    ],
    response:
      "¡Te entiendo! 🙏 Quiero que quedes tranquilo con tu inversión.\n\nSi quieres, te muestro opciones más económicas o para otras fechas donde el valor baja. ¿Te ayudo a buscar? 😊",
    tags: ["objecion-precio", "empatia", "sin-presion"],
  },
  {
    key: "pb-cierre-reservar",
    phase: "contract",
    situation:
      "El cliente decide que quiere reservar la finca. Hay que mostrar entusiasmo y pedir los datos directamente (sin cadenas de '¿quieres que...?').",
    clientExamples: [
      "la quiero reservar",
      "listo, esa me gusta",
      "cómo hago para apartarla?",
    ],
    response:
      "¡Excelente decisión! 🎉 Me alegra un montón. Para dejar tu reserva lista necesito unos datos rápidos:\n\n📝 Nombre completo, cédula, correo y ciudad.\n\nApenas me los pases seguimos con el siguiente paso 🤝",
    tags: ["cierre", "pedir-datos-contrato"],
  },
  {
    key: "pb-queja-molesto",
    phase: "any",
    situation:
      "El cliente está molesto, se queja o expresa una mala experiencia. Hay que responder con calma, empatía y sin ponerse a la defensiva.",
    clientExamples: [
      "esto es un desorden",
      "llevo rato esperando",
      "muy mal servicio",
    ],
    response:
      "Lamento mucho que hayas vivido esa experiencia 🙏 Tienes toda la razón en escribirlo y quiero ayudarte a resolverlo cuanto antes.\n\nCuéntame qué pasó exactamente y lo revisamos de una para darte una solución 🤝",
    tags: ["queja", "empatia", "de-escalar"],
  },
];
