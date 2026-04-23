import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../convex/_generated/api.js";

dotenv.config({ path: ".env.local" });

type TemplateSeed = {
  title: string;
  slashCommand: string;
  intentKey: string;
  content: string;
  order: number;
};

const templates: TemplateSeed[] = [
  {
    title: "Saludo corto",
    slashCommand: "/ho",
    intentKey: "ho",
    content: "👋Hola buen día, gusto saludarte. Claro que si.",
    order: 1,
  },
  {
    title: "Cotiza",
    slashCommand: "/cotiza",
    intentKey: "cotiza",
    content: `Hola, gracias por escribir a FincasYa.com. Te saluda HERNÁN.

Para enviarte el catálogo de hospedajes disponibles, por favor indícanos:
📅 Fechas de entrada y salida
👨‍👩‍👧‍👦 Número de personas (incluyendo niños desde 2 años)
🏡 Si es un grupo de familia, amigos o empresa

En breve te responderemos personalmente.
¡Gracias por elegirnos! 🤩✨`,
    order: 2,
  },
  {
    title: "Indicar datos",
    slashCommand: "/indi",
    intentKey: "indi",
    content:
      "📲Indícanos por favor fecha de ingreso y salida, numero de personas, y si es grupo de familia o amigos?",
    order: 3,
  },
  {
    title: "Video detalle",
    slashCommand: "/video",
    intentKey: "video",
    content:
      "Estás son las opciones disponibles, si deseas información más detallada u obtener un video para conocerla un poco más en detalle, por favor háznos saber cuál es la de tu interés🤩🏡",
    order: 4,
  },
  {
    title: "Descuento",
    slashCommand: "/descuento",
    intentKey: "descuento",
    content:
      "🤝 Éstas opciones están disponibles para la fecha que nos indicaste 📅 te vamos a señalar  el mejor precio que te podemos ofrecer por noche  🏡😊",
    order: 5,
  },
  {
    title: "Celebración",
    slashCommand: "/celebracion",
    intentKey: "celebracion",
    content:
      "Cuéntanos por favor si para tu celebración, tienes contemplado ingresar sonido, iluminación, DJ, grupo musical o si es solo para departir con el sonido que cuenta cada finca ?",
    order: 6,
  },
  {
    title: "Sector no disponible",
    slashCommand: "/sector no disponible",
    intentKey: "sector_no_disponible",
    content:
      "Hola buen día, gusto saludarte. Esperamos te encuentres bien. Desafortunadamente hacia el sector que nos indicas, no contamos con disponibilidad.🏡✅",
    order: 7,
  },
  {
    title: "Continuación catálogo",
    slashCommand: "/continuacion",
    intentKey: "continuacion",
    content: `🙋‍♂️Hola, gusto saludarte soy Hernan de fincasya.com! 

A continuación te comparto las opciones 🏡disponibles para 📅 la fecha indicada,💰 el valor allí reflejado corresponde a su valor por noche en temporada actual🏊 si te gusta alguna 🏡 te ayudaré a encontrar el mejor precio 🤝`,
    order: 8,
  },
  {
    title: "Check in/out",
    slashCommand: "/check in",
    intentKey: "check_in",
    content: `Nuestros horarios son bastantes amplios:
•⁠  ⁠Check in 10:00am
•⁠  ⁠Check out 4:00pm`,
    order: 9,
  },
  {
    title: "Fin de año alto",
    slashCommand: "/fdaa",
    intentKey: "fdaa",
    content:
      "En temporada de fin de año podemos brindarte disponibilidad del 28 al 03, 29 al 04, o del 30 al 05 de enero 🏡",
    order: 10,
  },
  {
    title: "Personal de servicio",
    slashCommand: "/personal de servicio",
    intentKey: "personal_de_servicio",
    content: `Te podemos recomendar personal de servicio que te puede colaborar durante tu estadía. Los precios oscilan entre $90.000, dependiendo de la temporada ☀️, Realmente los costos y condiciones los fijas con la persona que te presentemos.

Para grupos de más de 15 personas, sugerimos contratar a 2 personas de servicio para asegurar una atención personalizada y excepcional ✅👨‍💻

Es importante tener en cuenta que, en algunos casos, el personal de servicio debe ser contratado🏠.`,
    order: 11,
  },
  {
    title: "Cobro por finca",
    slashCommand: "/cobra",
    intentKey: "cobra",
    content:
      "Realmente no te cobramos un valor por persona, se cobra el alquiler de la finca como tal 🏡",
    order: 12,
  },
  {
    title: "FDA 2025",
    slashCommand: "/FDA2025",
    intentKey: "fda2025",
    content: `Hola buen día, gusto saludarte 👋🏻 Por favor ten presente que en temporadas especiales como Fin de año, Navidad y puente de Reyes, los costos y condiciones de alquiler son distintos.☝️🎄
🏡Las propiedades tienen una estancia mínima de noches, que varía según la fecha:

•⁠  ⁠Navidad:  3/4 noches 🎅🏻
•⁠  ⁠Fin de año:  6/7 noches  ☃️
•⁠  ⁠Reyes:  2/3 noches 🤴

Si estás interesado en conocer las opciones de alquiler, por favor indícanos la siguiente información:
•⁠  ⁠Fecha de entrada y salida
•⁠  ⁠Número de personas

En breve, te compartiremos las opciones disponibles. ¡Gracias! 🙌`,
    order: 13,
  },
  {
    title: "FDA",
    slashCommand: "/fda",
    intentKey: "fda",
    content:
      "Éstas son las fincas disponibles para la fecha que nos indicas, el costo que vez allí reflejado cambia para las fechas especiales🎄 indícanos por favor si alguna de las opciones te ha gustado, y te brindamos su costo por noche y ampliaremos su información😊",
    order: 14,
  },
  {
    title: "Empleada obligatoria",
    slashCommand: "/EMPLEADA OBLIGATORIA",
    intentKey: "empleada_obligatoria",
    content:
      "Debes tener presente por favor que esta propiedad cuenta con personal de servicio el cuál debe ser contratado, más que un requisito es una ventaja para tu grupo ya que les permitirá tener un mayor descanso, los costos y condiciones los acomodarías directamente con la persona que te presentemos, el costo por día es alrededor de los $90.000 🏡",
    order: 15,
  },
  {
    title: "Puente",
    slashCommand: "/puente",
    intentKey: "puente",
    content: "Fines de semana con puente te podríamos ofrecer disponibilidad mínimo 2 noches ✅",
    order: 16,
  },
  {
    title: "Comentario Google",
    slashCommand: "/comentario google",
    intentKey: "comentario_google",
    content: `¡Tu opinión es muy importante para nosotros! En FincasYa.com trabajamos cada día para brindarte la mejor experiencia en el alquiler de fincas y villas de lujo.

Si has disfrutado de nuestros servicios, te invitamos a compartir tu experiencia en Google. Tu reseña nos ayuda a crecer y a que más personas puedan disfrutar de momentos inolvidables.

👉 https://g.page/r/CcovYYDQPL7KEBM/review

¡Gracias por confiar en nosotros!🙌`,
    order: 17,
  },
  {
    title: "Chat center",
    slashCommand: "/chat center",
    intentKey: "chat_center",
    content:
      "Hola buenas tardes, gusto saludarte. Esperamos te encuentres bien. Te brindamos atención por este medio, recuerda por favor que somos un chat center y debemos dejar constancia de todo lo que hablemos. Si gustas nos puedes compartir un audio y así mismo te damos respuesta 😊🤝",
    order: 18,
  },
  {
    title: "Cobrar saldo",
    slashCommand: "/COBRAR",
    intentKey: "cobrar",
    content: `La entrega formal del inmueble la realizará el Sr. Eduardo. Te recomendamos por favor revisar el lugar con calma y a conformidad al momento de recibirlo.

Queremos contarte que estaremos atentos 24/7 para apoyarte en cualquier novedad o requerimiento durante tu llegada y estadía.

Para finalizar correctamente tu proceso de llegada y dar inicio oficial a tu alquiler, es muy importante que, una vez recibas el inmueble a conformidad, nos compartas el soporte de pago correspondiente a los valores faltantes.

Quedamos muy atentos a tu llegada. ¡Que disfrutes tu estancia! 🌴✨`,
    order: 19,
  },
  {
    title: "Fiesta filtro",
    slashCommand: "/fiesta filtro",
    intentKey: "fiesta_filtro",
    content: `Hola es un gusto saludarte, esperamos te encuentres bien.😊

Claro que si , por favor cuéntanos un poco sobre tu alquiler, si es evento familiar o de amigos , cuéntanos si vas a llevar sonido, decoración, mobiliario, grupos de música, Dj,etc
Te preguntamos lo anterior ya que con esta información podemos saber mas sobre tu necesidad y enviarte el catalago de las opciones disponibles.
Adicional confirmanos por favor, si el número de personas que nos indicas será el mismo de invitados y hospedados.`,
    order: 20,
  },
  {
    title: "Cuando mandan catálogo",
    slashCommand: "/cuando mandan catalogo",
    intentKey: "cuando_mandan_catalogo",
    content: `Hola Gracias por escribir a fincasya.com 🏡esta hermosa casa es una de las mejores del portafolio para grupos pequeños. 

Indícanos por favor una fecha probable de entrada y salida y # de personas  
Y en la mayor brevedad te compartiremos su catálogo y muchas opciones más 😊`,
    order: 21,
  },
  {
    title: "Próxima reserva cliente busca",
    slashCommand: "/proximareservaclientebusca",
    intentKey: "proximareservaclientebusca",
    content:
      "Buenos días, ¡hola! Estamos emocionados de que estés próximo a tu reserva. Nuestro equipo de entregas se pondrá en contacto contigo pronto para finalizar los detalles de tu llegada. Si tienes alguna pregunta o inquietud, no dudes en hacérnoslo saber. Estamos aquí para ayudarte y responderte lo antes posible",
    order: 22,
  },
  {
    title: "Confirmar reserva",
    slashCommand: "/confirmarese",
    intentKey: "confirmarese",
    content: `Es un gusto confirmar tu reserva en ... para ...
Nos alegra que hayas elegido una de nuestras opciones para tu estancia.🤩🏡

Te compartimos la confirmación de reserva y la ubicación exacta de la finca  🏡

Nos pondremos en contacto contigo días previos para ultimar todos los detalles y asegurarnos de que todo esté perfecto para ti.😊`,
    order: 23,
  },
  {
    title: "Noches disponibles",
    slashCommand: "/NOCHES DISPONIBLES",
    intentKey: "noches_disponibles",
    content: `🏡Fines de semana sin puente festivo, te podemos brindar disponibilidad mínimo una noche 
🏡Fines de semana con puente festivo, te podemos brindar disponibilidad mínimo dos noche 

🏡Semana Santa mínimo 03 a 04 noches

🎄Fin de año, mínimo 06/07 noches
🎅Navidad, minimo 04 noches
🤴Reyes, minimo 03 noches`,
    order: 24,
  },
  {
    title: "Precio por noche",
    slashCommand: "/PRECIO X NOCHE",
    intentKey: "precio_x_noche",
    content:
      "Por favor debes tener presente, que nuestros costos son por noche, no te cobramos un valor como tal persona. El precio que te estamos otorgando es por tu cotización inicial 😊🤝",
    order: 25,
  },
  {
    title: "Soporte recibido",
    slashCommand: "/soporte recibido",
    intentKey: "soporte_recibido",
    content:
      "Muchas gracias, deseamos tengas una excelente estadía 🏊☀️. Recuerda que nuestra linea estará las 24hras, por si tienes alguna inquietud. No olvides tener presente por favor tu check out (------)el día de mañana😊",
    order: 26,
  },
  {
    title: "Cómo trabajan",
    slashCommand: "/como trabajan",
    intentKey: "como_trabajan",
    content:
      "Somos un motor de reservas  con gran trafico de turistas, contamos con disponibilidades en distintos sectores de país, también  somos creadores contenido para alquiler/ venta y generamos ofertas de alquiler constantemente a las propiedades de nuestro portafolio, para iniciar el proceso debes  compartirnos la información solicitada, si la casa  pasa el filtro, se hace una visita de verificación y creación de contenido, posteriormente con el propietario acordamos posibles tarifas según el mercado, y luego empezamos   a enviar  las respectivas ofertas.  Nuestros clientes son quienes cancelan nuestra tarifa de servicio  y realmente nosotros nos convertimos en tu mejor cliente.",
    order: 27,
  },
  {
    title: "Inicio de viaje",
    slashCommand: "/inicio de viaje",
    intentKey: "inicio_de_viaje",
    content: `☀️ Hola, buen día, gusto saludarte.

Queremos acompañarte en todo momento para que la entrega de la finca se dé sin contratiempos 🏡.
Por favor, indícanos la hora aproximada de salida y confírmanos cuando estés a unos 35 minutos del destino 🚗. Así podremos coordinar con el equipo y tener todo listo para tu llegada ✅.

Ante cualquier cambio en el recorrido, avísanos. ¡Estamos muy pendientes de ti! 🤝`,
    order: 28,
  },
  {
    title: "Reta contrato",
    slashCommand: "/retacontrato",
    intentKey: "retacontrato",
    content: `¡Hola, gusto saludarte! Te escribe Hernán , Esperamos que estés teniendo un excelente día.

Queremos confirmar si aún estás interesado en continuar con el proceso de alquiler 🏠 La casa sigue disponible por el momento.

Cualquier duda o inquietud que tengas, aquí estamos súper atentos para ayudarte.
O si prefieres ver más opciones, también estamos listos para mostrarte alternativas.
¡Que tengas un gran día!`,
    order: 29,
  },
  {
    title: "Anticipación",
    slashCommand: "/anticipacion",
    intentKey: "anticipacion",
    content:
      "La disponibilidad se actualiza en tiempo real, por lo que puedes reservar en el momento que desees. Sin embargo, te recomendamos verificar nuestra disponibilidad con frecuencia, ya que puede cambiar constantemente. ¡No dudes en reservar cuando estés listo!\"",
    order: 30,
  },
  {
    title: "Envío contrato",
    slashCommand: "/envio contrato",
    intentKey: "envio_contrato",
    content: "Te compartimos documentación legal y medios de pago, quedamos atentos a tus dudas e inquietudes 😊🤝",
    order: 31,
  },
  {
    title: "Pregunta recorrido",
    slashCommand: "/pregunta recorrido",
    intentKey: "pregunta_recorrido",
    content:
      "Hola buenos días gusto saludarte, queríamos validar contigo por favor, si ya iniciaste tu recorrido?☀️ de ser así podrías por favor confírmanos el tiempo de llegada que te marca el GPS⏱️. O si tienes una hora contemplada en la cuál lo iniciaras no olvides por favor indicarnos, esto nos permitirá estar al pendiente de tu llegada. No olvides validarnos cuando estés a tan solo 35 minutos de la propiedad🏡",
    order: 32,
  },
  {
    title: "Soporte reserva propietario",
    slashCommand: "/soporte reserva propietario",
    intentKey: "soporte_reserva_propietario",
    content: `Hola gusto saludarte, te anexamos el soporte de reserva 

ABONO $
SALDO $`,
    order: 33,
  },
  {
    title: "Reintegro depósito",
    slashCommand: "/reintegro deposito",
    intentKey: "reintegro_deposito",
    content:
      "Cuándo finaliza el alquiler, debes por favor notificarnos y adjuntarnos tu número de cuenta para realizar el reembolso del mismo, si no se reporta novedad por daños.\nPuede tomar unas horas mientras se realizan las respectivas validaciones.✅",
    order: 34,
  },
  {
    title: "Ubicación casa",
    slashCommand: "/ubicacion casa",
    intentKey: "ubicacion_casa",
    content: "Te compartimos nuevamente, ubicación exacta ✅",
    order: 35,
  },
  {
    title: "Tocaima llegada",
    slashCommand: "/tocaima llegada",
    intentKey: "tocaima_llegada",
    content:
      "Debes tener presente que la finca está ubicada en la parte alta del pueblo. Para llegar, deberás recorrer aproximadamente 2,5 km de vía destapada, por donde han ingresado todo tipo de vehículos. Nuestro equipo estará siempre atento a tu viaje y a tu llegada, para brindarte las indicaciones necesarias y que el acceso sea seguro y tranquilo.",
    order: 36,
  },
  {
    title: "Fincas FDA",
    slashCommand: "/fincas fda",
    intentKey: "fincas_fda",
    content:
      "Éstas son las fincas disponibles para la fecha🎄 indícanos por favor si alguna de las opciones te ha gustado, con gusto ampliaremos su información y brindamos su costo por noche en temporada 😊",
    order: 37,
  },
];

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_/-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function run() {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL no está definido en .env.local");
  }

  const client = new ConvexHttpClient(convexUrl);
  const existing = await client.query(api.quickReplyTemplates.list, {});
  const mapBySlash = new Map<string, (typeof existing)[number]>();

  for (const row of existing) {
    mapBySlash.set(row.slashCommand, row);
  }

  let created = 0;
  let updated = 0;

  for (const item of templates) {
    const normalizedSlash = normalizeKey(item.slashCommand).replace(/^\//, "");
    const normalizedIntent = normalizeKey(item.intentKey);
    const found = mapBySlash.get(normalizedSlash);

    if (found) {
      await client.mutation(api.quickReplyTemplates.update, {
        id: found._id,
        title: item.title,
        slashCommand: item.slashCommand,
        intentKey: normalizedIntent,
        content: item.content,
        mediaType: "text",
        active: true,
        order: item.order,
      });
      updated += 1;
      continue;
    }

    await client.mutation(api.quickReplyTemplates.create, {
      title: item.title,
      slashCommand: item.slashCommand,
      intentKey: normalizedIntent,
      content: item.content,
      mediaType: "text",
      active: true,
      order: item.order,
    });
    created += 1;
  }

  console.log(`Plantillas procesadas: ${templates.length}`);
  console.log(`Creadas: ${created}`);
  console.log(`Actualizadas: ${updated}`);
}

run().catch((err) => {
  console.error("Error cargando plantillas:", err);
  process.exit(1);
});
