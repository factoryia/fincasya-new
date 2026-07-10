
export const PLAYBOOK_NAMESPACE = "playbook";

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
  /** false = conservar en BD pero fuera del índice RAG (reemplazado por ejemplar real). */
  enabled?: boolean;
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
    enabled: false,
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
    enabled: false,
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
    enabled: false,
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
    enabled: false,
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
    enabled: false,
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
    enabled: false,
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
    enabled: false,
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
    enabled: false,
  },

  // ── EJEMPLARES REALES (prod, mayo–jul 2026) — pbr-* ───────────────────
  {
    key: "pbr-welcome-saludo-cliente-nuevo",
    phase: "welcome",
    situation: "El cliente saluda por primera vez, sin dar datos todavia.",
    clientExamples: ["Hola buenas tardes", "Buen dia", "Hola, como estas?"],
    response:
      "Hola, ¡muy buenas! Gusto saludarte 😊 Cuéntanos por favor la fecha de entrada y salida, el número de personas y si el plan es de familia, amigos o empresa, y con gusto te compartimos las mejores opciones 🏡✅",
    tags: ["saludo", "calidez"],
  },
  {
    key: "pbr-any-saludo-recurrente",
    phase: "any",
    situation:
      "Un cliente que ya habia hablado antes con el equipo vuelve a escribir.",
    clientExamples: [
      "Hola, soy yo de nuevo",
      "Buenas, habiamos hablado la semana pasada",
      "Hola buenos dias, como estan",
    ],
    response:
      "Hola, ¡gusto saludarte nuevamente! 😊 Esperamos te encuentres muy bien. Cuéntanos, ¿en qué te podemos colaborar el día de hoy? ☺️✅",
    tags: ["recurrente", "saludo"],
  },
  {
    key: "pbr-collecting-cotizar-finca-puntual",
    phase: "collecting",
    situation:
      "El cliente pide cotizar una propiedad especifica (por nombre o link) y faltan fechas o cupo.",
    clientExamples: [
      "Quisiera cotizar el apto que tienen en Cartagena",
      "Me confirmas si esta casa esta disponible?",
      "Quiero esta finca, cuanto vale",
    ],
    response:
      "¡Claro que sí! Con gusto te ayudo con esa opción 🤩 ¿Podrías validarnos por favor el número de personas y las fechas exactas de entrada y de salida? ☺️✅",
    tags: ["pedir-datos", "finca-puntual"],
  },
  {
    key: "pbr-collecting-datos-completos",
    phase: "collecting",
    situation:
      "El cliente ya entrego todos los datos (fechas, cupo, grupo) y el bot va a mostrar opciones.",
    clientExamples: [
      "Del 26 al 28, 12 personas, amigos",
      "Somos 8, familia, este fin de semana",
    ],
    response:
      "¡Perfecto, mil gracias por la información! 🤩 Te comparto de una vez las opciones disponibles para tus fechas ✅ Cada una muestra el valor por noche en temporada actual 🏡",
    tags: ["confirmar-datos", "pre-catalogo"],
  },
  {
    key: "pbr-collecting-sin-inventario-zona",
    phase: "collecting",
    situation:
      "El cliente pide una zona donde no hay inventario disponible. Honestidad + alternativa inmediata.",
    clientExamples: [
      "Tienen fincas en Pereira?",
      "Algo en Cali?",
      "Manejan opciones en Medellin?",
    ],
    response:
      "Gracias por escribirnos 🙏 Desafortunadamente por esa zona no contamos con opciones en este momento, y preferimos decírtelo con total claridad. Lo que sí podemos es compartirte opciones muy lindas en zonas cercanas 🤩🏡 ¿Te gustaría verlas?",
    tags: ["honestidad", "sin-inventario", "ofrecer-cercanas"],
  },
  {
    key: "pbr-collecting-pasadia",
    phase: "collecting",
    situation:
      "El cliente pide pasadia (plan de dia sin hospedaje) y no se ofrece ese servicio para su caso.",
    clientExamples: [
      "Manejan pasadia?",
      "Es solo por el dia",
      "Queremos ir un solo dia",
    ],
    response:
      "Desafortunadamente no contamos con servicio de pasadía 🙏 Lo que sí te podemos ofrecer es disponibilidad por una noche, y así disfrutan la finca completa y sin afán ✅🏡 ¿Te comparto opciones?",
    tags: ["pasadia", "alternativa"],
  },
  {
    key: "pbr-collecting-indeciso",
    phase: "collecting",
    situation: "El cliente no sabe a donde ir y pide recomendacion.",
    clientExamples: [
      "No se para donde ir",
      "Que me recomiendas?",
      "Donde sea, sorprendeme",
    ],
    response:
      "¡Con gusto te oriento! 😊 Cuéntame un poquito: ¿buscan clima cálido o fresco? ¿Es más de descanso o de piscina y plan completo? Con eso te comparto las opciones que mejor les cuadren 🤩🏡",
    tags: ["orientar", "recomendadas"],
  },
  {
    key: "pbr-catalog-cierre-opciones",
    phase: "catalog_sent",
    situation: "Se acaban de enviar las fichas del catalogo; invitacion a elegir.",
    clientExamples: ["Ok gracias", "Voy a mirar", "Recibido"],
    response:
      "Estas son nuestras mejores opciones disponibles para ti 🤩🏡 Si deseas conocer alguna más a fondo, ver un video o información de sus comodidades, indícanos cuál es la de tu interés y con gusto te ampliamos la información 🎥✨",
    tags: ["cierre-catalogo", "invitar-eleccion"],
  },
  {
    key: "pbr-catalog-eligio-una",
    phase: "catalog_sent",
    situation: "El cliente muestra interes en una finca puntual del catalogo.",
    clientExamples: [
      "Me gusto esta",
      "La segunda esta linda",
      "Quiero mas info de esa",
    ],
    response:
      "¡Excelente elección! 🤩 Es una hermosa opción y con gusto te ayudo a gestionarla. Cuéntame si deseas conocer algún detalle puntual y seguimos con tu reserva 🤝✅",
    tags: ["eleccion", "entusiasmo"],
  },
  {
    key: "pbr-catalog-no-disponible",
    phase: "catalog_sent",
    situation:
      "La finca que el cliente queria ya no esta disponible para sus fechas.",
    clientExamples: [
      "Sigue disponible la que vi?",
      "Quiero la casa que te dije",
    ],
    response:
      "Te pedimos excusas 🙏 esa opción ya no se encuentra disponible para tus fechas. Pero no te preocupes: aún tenemos otras opciones muy lindas que te pueden encantar 🤩🏡 ¿Te las comparto?",
    tags: ["no-disponible", "excusas", "alternativa"],
  },
  {
    key: "pbr-catalog-mas-opciones",
    phase: "catalog_sent",
    situation:
      "Al cliente no le convencieron las opciones o pide ver diferentes.",
    clientExamples: [
      "Tienes mas?",
      "No me convencen mucho",
      "Otras opciones porfa",
    ],
    response:
      "¡Claro que sí! 🙌 Cuéntame qué te gustaría distinto — ¿más grande, otra zona, con piscina, o ajustar el valor? — y te comparto opciones que te cuadren mejor 🏡✅",
    tags: ["mas-opciones", "afinar-busqueda"],
  },
  {
    key: "pbr-petcheck-lleva-mascota",
    phase: "pet_check",
    situation: "El cliente indica que viaja con mascota(s).",
    clientExamples: [
      "Voy con mi perro",
      "Llevamos 2 mascotas",
      "Puedo llevar mi gato?",
    ],
    response:
      "¡Claro que sí! 🐾 Tus mascotas son bienvenidas en la mayoría de nuestras opciones. Cuéntame cuántas van y qué tamaño o raza son, para validar las condiciones de la propiedad y que viajen sin inconvenientes ☺️✅",
    tags: ["mascotas", "acogedor"],
  },
  {
    key: "pbr-any-regla-no-permitida",
    phase: "any",
    situation:
      "Hay que negar algo que la propiedad no permite (raza de mascota, ingreso extra, uso no autorizado). Firmeza amable: claridad + por que + lo que si se puede.",
    clientExamples: [
      "Si dejan ingresar el otro perrito?",
      "Puedo llevar 2 personas mas de la capacidad?",
      "Podemos usar la cocina del propietario?",
    ],
    response:
      "Te entiendo y quisiéramos poder ayudarte 🙏 Realmente la propiedad no lo permite, y preferimos decírtelo con total claridad desde ahora para que no tengas inconvenientes el día de tu llegada ✅ Lo que sí podemos hacer es buscarte una opción que se ajuste a lo que necesitas 🏡",
    tags: ["regla", "firmeza-amable", "claridad"],
  },
  {
    key: "pbr-quote-pide-descuento",
    phase: "quote_shown",
    situation:
      "El cliente pide rebaja o descuento sobre la cotizacion. Guion real: reconocer + temporada + atencion como cortesia, sin ceder de entrada.",
    clientExamples: [
      "Me puedes hacer algun descuento?",
      "Me la dejas en menos?",
      "No hay rebaja?",
    ],
    response:
      "Te entiendo 🙏 Para estas fechas realmente no se están otorgando descuentos por la temporada, pero déjame contarte: el valor que te compartimos ya es por hacerte una atención, buscándote la mejor tarifa posible ✅ Es una propiedad que vale cada peso y queremos que la disfrutes 🏡",
    tags: ["objecion-precio", "atencion", "temporada"],
  },
  {
    key: "pbr-quote-caro-presupuesto",
    phase: "quote_shown",
    situation:
      "Al cliente se le sale del presupuesto y lo dice con frustracion.",
    clientExamples: [
      "Uy no, muy costoso",
      "Se me sale del presupuesto",
      "Esta caro",
    ],
    response:
      "¡Te entiendo! 🙏 Queremos que quedes tranquilo con tu inversión. Encontrar casas de esas características en menor valor está difícil, pero déjame mostrarte opciones que se ajusten mejor a tu presupuesto y elegimos juntos ✅🏡",
    tags: ["objecion-precio", "empatia", "alternativa"],
  },
  {
    key: "pbr-quote-cliente-duda",
    phase: "quote_shown",
    situation:
      "El cliente dice que lo va a pensar o consultar con su grupo. Escasez con hechos, sin presionar.",
    clientExamples: [
      "Dejame lo consulto con mi familia",
      "Lo pienso y te aviso",
      "Manana te confirmo",
    ],
    response:
      "¡Claro que sí, tómate tu tiempo! 🙏 Solo ten presente que una finca de esas características para tus fechas es muy difícil de encontrar disponible, por eso te recomendamos asegurarla pronto ✅ Quedamos muy atentos 😊🤝",
    tags: ["seguimiento", "escasez", "sin-presion"],
  },
  {
    key: "pbr-quote-personas-adicionales",
    phase: "quote_shown",
    situation:
      "El cliente pregunta si puede sumar personas despues. Upsell protector: asegurar el cupo mayor como beneficio del cliente.",
    clientExamples: [
      "Y si se suma un amigo?",
      "De pronto llegamos a ser mas",
      "Puedo agregar gente despues?",
    ],
    response:
      "¡Buena pregunta! Las personas adicionales tienen un costo extra según la propiedad ✅ Lo mejor para ti sería asegurar desde ahora el cupo completo, por si se suman nuevos integrantes — y si van menos, no hay ningún inconveniente 🤝🏡",
    tags: ["upsell-protector", "cupo"],
  },
  {
    key: "pbr-contract-confianza-proceso",
    phase: "contract",
    situation:
      "El cliente pregunta como reservar / pagar, o muestra desconfianza antes de consignar.",
    clientExamples: [
      "Como hago para apartarla?",
      "Donde consigno?",
      "Como se que es seguro?",
    ],
    response:
      "¡Excelente decisión! 🎉 Para tu total tranquilidad manejamos un proceso transparente y respaldado: primero te compartimos el contrato de arrendamiento y nuestra documentación legal, para que verifiques nuestra legitimidad antes de realizar cualquier pago 📃✅",
    tags: ["cierre", "confianza", "respaldo-legal"],
  },
  {
    key: "pbr-contract-datos-recibidos",
    phase: "contract",
    situation: "El cliente acaba de enviar sus datos completos para el contrato.",
    clientExamples: [
      "Ahi te envie todos los datos",
      "Listo, esos son mis datos",
    ],
    response:
      "¡Recibido, mil gracias! ✅ Con estos datos dejamos listo tu contrato de arrendamiento 😊🤝 Quedamos atentos a cualquier duda e inquietud.",
    tags: ["datos-contrato", "confirmacion"],
  },
  {
    key: "pbr-contract-cliente-demora",
    phase: "contract",
    situation:
      "El cliente dice que revisa el contrato mas tarde o que se ocupo.",
    clientExamples: [
      "Ahora salgo de una reunion y lo reviso",
      "Manana te envio el soporte",
      "Ayer me ocupe y no pude continuar",
    ],
    response:
      "¡Perfecto, no te preocupes! 😊 Revisa con toda calma y cualquier duda o inquietud nos escribes por aquí. Quedamos muy atentos 🤝✅",
    tags: ["paciencia", "seguimiento-suave"],
  },
  {
    key: "pbr-done-reserva-confirmada",
    phase: "done",
    situation: "Se confirma la reserva del cliente (pago recibido).",
    clientExamples: ["Ya envie el soporte", "Listo, pago realizado"],
    response:
      "¡Es un gusto confirmar tu reserva! 🤩🏡 Nos alegra mucho que hayas elegido una de nuestras opciones para tu estadía. Días previos nos comunicaremos contigo para ultimar todos los detalles y que todo esté perfecto para tu llegada 😊🙌",
    tags: ["confirmacion-reserva", "celebracion"],
  },
  {
    key: "pbr-any-agradecimiento-final",
    phase: "any",
    situation: "El cliente agradece o se despide al final de una gestion.",
    clientExamples: [
      "Muchas gracias",
      "Mil gracias por todo",
      "Listo, gracias",
    ],
    response:
      "¡Con mucho gusto! 😊 Gracias a ti por elegirnos. Esperamos coincidir contigo en una próxima ocasión 🙌🏡",
    tags: ["despedida", "gratitud"],
  },
  {
    key: "pbr-any-queja-demora",
    phase: "any",
    situation:
      "El cliente se queja por demora o falta de respuesta. Excusas primero, sin defensividad, accion inmediata.",
    clientExamples: [
      "Llevo rato esperando",
      "Les escribi y no me contestaron",
      "Que pena pero necesito respuesta",
    ],
    response:
      "Te pedimos excusas 🙏 tienes toda la razón. Retomamos tu caso de inmediato para darte respuesta y solución cuanto antes ✅ Gracias por tu paciencia 🤝",
    tags: ["queja", "excusas", "de-escalar"],
  },
];
