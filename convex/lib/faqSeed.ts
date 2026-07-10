/**
 * Semilla de FAQs del bot + fallback determinístico.
 *
 * `FAQ_INITIAL_SEED` es la fuente ÚNICA de verdad de los copys de FAQ:
 *   - `knowledge.ts` los siembra en el RAG (`seedFaqEntries`).
 *   - `inbound.ts` los usa como FALLBACK quemado (`localFaqFallback`) cuando
 *     el RAG falla (error de red / embeddings caídos) o no devuelve match.
 *
 * Así, si el RAG se cae, el bot SIGUE respondiendo las preguntas frecuentes
 * con el mismo texto oficial — sin depender de la búsqueda semántica.
 *
 * Para añadir/modificar una FAQ: edita SOLO esta lista (y, si quieres, corre
 * `bunx convex run knowledge:seedFaqEntries` para refrescar el RAG).
 */

export const FAQ_INITIAL_SEED: Array<{
  key: string;
  title: string;
  text: string;
}> = [
  {
    key: 'faq:mascotas-politica',
    title: 'Política y reglas de mascotas',
    text: [
      'Tus mascotas son bienvenidas en la mayoría de nuestras opciones de alojamiento. Algunas fincas no las permiten.',
      '',
      'Cargos por mascota:',
      '- Depósito reembolsable: $100.000 por cada mascota.',
      '- Tarifa de ingreso: $30.000 a partir de la 3ª mascota.',
      '- Limpieza adicional: si viaja con 3 o más mascotas, $70.000 (cargo único de aseo).',
      '',
      'Recomendaciones importantes (qué pueden y qué NO pueden hacer):',
      '- No ingresar las mascotas a la piscina.',
      '- Evitar orina o pelaje en zonas interiores.',
      '- No subirlas a muebles ni camas.',
      '- Cuidar que no muerdan implementos de la casa.',
      '- Recoger sus necesidades constantemente.',
      '',
      'El incumplimiento de estas recomendaciones puede generar descuentos en el depósito.',
    ].join('\n'),
  },
  {
    key: 'faq:reserva-abono',
    title: 'Cómo se reserva: proceso y abono del 50%',
    text: [
      '📃 *Proceso de reserva en FincasYa.com* ✨',
      '',
      'Para tu total tranquilidad, manejamos un proceso transparente y con respaldo:',
      '',
      '📄 *Contrato y respaldo legal:* te enviamos el contrato de arrendamiento y nuestra documentación legal para que verifiques nuestra legitimidad *antes* de realizar cualquier pago.',
      '',
      '💰 *Condiciones de reserva:* la mayoría de nuestras propiedades se reservan con el *50%* del valor del alquiler. El saldo restante lo cancelas cuando recibes la finca a satisfacción.',
      '',
      '💳 *Formas de pago:* Davivienda, BBVA, Bancolombia, Nequi, Llaves Bancarias, o PSE / Tarjeta de crédito (aumenta el valor).',
      '',
      '📍 *Confirmación y ubicación:* una vez validado tu pago, te entregamos el documento oficial de confirmación y la ubicación exacta de la propiedad.',
      '',
      'En FincasYa.com te garantizamos un proceso claro, seguro y con respaldo profesional 🤝',
    ].join('\n'),
  },
  {
    key: 'faq:rnt-respaldo',
    title: 'RNT y respaldo legal',
    text: [
      'FincasYa.com cuenta con Registro Nacional de Turismo (RNT) 163658.',
      'Toda reserva va con respaldo legal y contrato formal de arrendamiento.',
    ].join('\n'),
  },
  {
    key: 'faq:ubicacion-exacta',
    title: 'Ubicación exacta de la finca',
    text: [
      '¡Hola! 🗺️ Entendemos perfectamente que quieras saber cómo llegar.',
      '',
      'Por políticas de seguridad y privacidad de nuestras propiedades, las ubicaciones exactas y direcciones se comparten exclusivamente a través del documento de confirmación de reserva, una vez que esta quede asegurada.',
      '',
      '📍 Antes de eso, con gusto te podemos indicar el sector, la zona de referencia o el municipio donde se encuentra la finca (por ejemplo, si es en la vía a Restrepo, Acacías, etc.) para que calcules tu tiempo de viaje.',
      '',
      '💬 ¿Deseas proceder con tu reserva? ¡En cuanto se confirme, recibirás la ubicación exacta junto con las indicaciones de llegada! 👨‍💻✨',
    ].join('\n'),
  },
  {
    key: 'faq:personal-servicio',
    title: 'Personal de servicio (sujeto a disponibilidad)',
    text: [
      '¡Claro que sí! Con gusto te comparto la información sobre el personal de servicio para tu estadía:',
      '',
      '🤝 Personal de Apoyo Recomendado. Podemos recomendarte personal de confianza para que te colabore con la cocina y el aseo durante tu estadía.',
      '',
      '• ⏰ Duración: La tarifa cubre una jornada de aproximadamente 8 horas de servicio ⏳.',
      '• 💰 Precios: Oscilan desde los $100.000 COP por día, dependiendo de la temporada ☀️.',
      '• 📋 Condiciones: Los costos finales y las tareas específicas los coordinas y fijas directamente con la persona que te presentemos.',
      '',
      '⚠️ Información importante:',
      '• 👥 Grupos mayores a 15 personas: para garantizar una atención excelente durante esas 8 horas, sugerimos contratar a 2 personas de servicio ✅.',
      '• 🏠 Políticas de la propiedad: en algunas fincas la contratación del personal de servicio es obligatoria por políticas de cuidado de la casa.',
      '',
      'Si deseas que te contactemos con el personal para tu fecha seleccionada, ¡avísale a nuestro asesor para coordinarlo! 👨‍💻✨',
    ].join('\n'),
  },
  {
    key: 'faq:horarios-flexibles',
    title: 'Horarios de hospedaje: ingreso y salida (check-in / check-out)',
    text: [
      'Con gusto 😊',
      'Te comparto la información sobre los horarios de hospedaje:',
      '',
      '🚪 Ingreso a la finca: El ingreso puede realizarse desde las 9:00 a.m., según disponibilidad de la propiedad.',
      '',
      '🏡 Hora de salida: La salida de la finca es a las 10:00 a.m.',
      '',
      '⏰ Late Check-out: Si deseas salir más tarde, puedes solicitarlo con el asesor para verificar disponibilidad. Ten en cuenta que este servicio puede tener un costo adicional.',
      '',
      '¿Te gustaría que revisemos la disponibilidad para las fechas que tienes en mente? 🏡✨',
    ].join('\n'),
  },
  {
    key: 'faq:precio-por-persona',
    title: 'Precio por persona / cuánto vale por persona',
    text: [
      'Claro 😊',
      '',
      'Los valores que enviamos para nuestras fincas no se manejan por persona, sino por noche de alojamiento en la propiedad completa 🏡✨',
      '',
      'El precio puede variar según la fecha, la cantidad de huéspedes y la finca seleccionada.',
      '',
      '¿Te gustaría recibir más información o continuamos con tu reserva? 😊',
    ].join('\n'),
  },
  {
    key: 'faq:alimentos-bebidas',
    title: 'Llevar alimentos y bebidas (licor, cerveza, mercado)',
    text: [
      'Claro 😊',
      'Puedes llevar tus bebidas, mercado y alimentos para disfrutar durante tu estadía 🏡✨',
      '',
      '🍻 Sin embargo, por políticas de seguridad, en ninguna de nuestras propiedades está permitido el ingreso de cerveza en botellas de vidrio.',
      '',
      '✅ Te recomendamos llevarlas en lata o envases plásticos para evitar inconvenientes durante el ingreso.',
    ].join('\n'),
  },
  {
    key: 'faq:proceso-pago',
    title: 'Proceso de reserva y medios de pago',
    text: [
      '👨🏻‍💻 *Proceso de reserva en FincasYa.com*',
      '',
      '📃 *Contrato y respaldo legal*',
      'Te enviamos el contrato de arrendamiento junto con nuestra documentación legal, para que verifiques nuestra legitimidad antes de pagar.',
      '',
      '💳 *Formas de pago*',
      'Puedes reservar con cualquiera de estos medios:',
      '• Davivienda',
      '• BBVA',
      '• Nequi',
      '• Bancolombia',
      '• PSE / Tarjeta de crédito',
      '• Llaves',
      '',
      '💰 *Condiciones de reserva*',
      'La mayoría de reservas se confirman con el *50%* del valor del alquiler.',
      'El saldo restante lo cancelas al recibir la finca a satisfacción.',
      '',
      '📄 *Confirmación y ubicación*',
      'Una vez validemos tu pago, te enviamos el documento oficial de confirmación de reserva y la ubicación exacta de la finca.',
      '',
      'En FincasYa.com tienes siempre un proceso claro, seguro y con respaldo ®️',
    ].join('\n'),
  },
];

/**
 * Fallback DETERMINÍSTICO de FAQs: dado el texto de una pregunta del cliente,
 * intenta matchear un tema de FAQ por palabras clave y devuelve el copy
 * oficial (el MISMO que está sembrado en el RAG). Devuelve `null` si ninguna
 * FAQ aplica.
 *
 * Se usa SOLO cuando el RAG no respondió (falló o sin match) — así el bot
 * sigue contestando las preguntas frecuentes aunque la búsqueda semántica
 * esté caída. El orden importa: las FAQs con keywords más específicas van
 * primero para que ganen ante un solapamiento.
 */
const FAQ_FALLBACK_RULES: Array<{ key: string; pattern: RegExp }> = [
  {
    key: 'faq:alimentos-bebidas',
    pattern:
      /\b(licor|cervezas?|alcohol|trago|viejas?|bebidas?|alimentos?|llevar\s+(comida|bebidas?|mercado|trago|licor)|botellas?\s+de\s+vidrio)\b/,
  },
  {
    key: 'faq:precio-por-persona',
    pattern:
      /\b(por\s+persona|cada\s+persona|por\s+cabeza|precio\s+por\s+persona|cuanto\s+(vale|cuesta|sale)\s+(por|cada)\s+persona)\b/,
  },
  {
    key: 'faq:personal-servicio',
    pattern:
      /\b(personal\s+de\s+servicio|cocinera|empleada|servicio\s+domestico|alguien\s+que\s+(cocine|ayude\s+con\s+(la\s+)?(cocina|aseo)))\b/,
  },
  {
    key: 'faq:horarios-flexibles',
    pattern:
      /\b(horarios?|check\s?in|check\s?out|hora\s+de\s+(entrada|salida|ingreso|llegada)|a\s+que\s+horas?|early\s+check|late\s+check|entrada\s+anticipada|salida\s+tardia)\b/,
  },
  {
    key: 'faq:ubicacion-exacta',
    pattern:
      /\b(ubicacion|direccion\s+(de\s+la\s+finca|exacta|del\s+(lugar|sitio))|donde\s+queda|donde\s+esta\s+(la\s+)?finca|como\s+llego|waze|google\s+maps|\bmapa\b)\b/,
  },
  {
    // OJO: va ANTES de `faq:reserva-abono` porque "como puedo pagar" /
    // "donde pago" / "formas de pago" son preguntas sobre MEDIOS de pago
    // (cuentas, bancos), no sobre el % de anticipo. Si va después, la regla
    // del abono se las queda porque ambas comparten términos como "pagar".
    key: 'faq:proceso-pago',
    pattern:
      /\b(como\s+(?:puedo\s+|podemos\s+)?(?:pago|pagar|paga\w+|consigno|consignar|transferir|deposit\w+|cancel(?:o|ar))|donde\s+(?:puedo\s+|podemos\s+)?(?:pago|pagar|consigno|consignar|transferir|deposit\w+|cancel(?:o|ar))|formas?\s+de\s+pag\w+|metodos?\s+de\s+pag\w+|medios?\s+de\s+pag\w+|proceso\s+de\s+pag\w+|por\s+(?:donde|que\s+banco|cual\s+banco)\s+(?:pago|pagar|consigno|transferir|deposit\w+)|que\s+(?:banco|cuenta|cuentas|medios?|formas?)\s+(?:tienen|manejan|aceptan|reciben|usan)|aceptan\s+(?:tarjeta|nequi|pse|bancolombia|davivienda|bbva)|nequi|bancolombia|davivienda|\bbbva\b|\bpse\b|tarjeta\s+de\s+credito)\b/,
  },
  {
    key: 'faq:reserva-abono',
    pattern:
      /\b(abono|abonar|anticipo|como\s+(se\s+)?reserv\w*|(hago|hacer|hacemos|hacen)\s+(la\s+)?reserva|separar\s+la?\s+fecha|cuanto\s+se\s+abona|el\s+50\s?%)\b/,
  },
  {
    key: 'faq:rnt-respaldo',
    pattern:
      /\b(rnt|registro\s+nacional\s+de\s+turismo|respaldo\s+legal|son?\s+confiables?|es\s+confiable|es\s+seguro|es\s+legal|estafa)\b/,
  },
  {
    key: 'faq:mascotas-politica',
    pattern: /\b(mascotas?|perr[oa]s?|gat[oa]s?|peludit[oa]s?)\b/,
  },
];

export function getFaqTextByKey(key: string): string | null {
  return FAQ_INITIAL_SEED.find((e) => e.key === key)?.text ?? null;
}

/** Detecta varios temas FAQ en un mismo mensaje (ej. perros + alimentos). */
export function localFaqMatchesForText(text: string): string[] {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length < 3) return [];
  const keys: string[] = [];
  for (const rule of FAQ_FALLBACK_RULES) {
    if (rule.pattern.test(t) && !keys.includes(rule.key)) keys.push(rule.key);
  }
  return keys;
}

export function localFaqFallback(question: string): string | null {
  const keys = localFaqMatchesForText(question);
  if (keys.length === 0) return null;
  return getFaqTextByKey(keys[0]);
}
