import { createRequire } from 'node:module';
import {
  workflow,
  trigger,
  node,
  expr,
  languageModel,
  memory,
  tool,
  newCredential,
  switchCase,
} from '@n8n/workflow-sdk';

const require = createRequire(import.meta.url);
/** Incluido en el repo vía JSON para que al publicar/importar el workflow el texto quede resuelto (readFileSync del .txt fallaba fuera del monorepo). Regenerar: `bun run n8n:sync-consultant-prompt`. */
const consultantPromptBody = String(
  require('./fincasya-n8n-consultant-system-prompt.json').prompt ?? '',
).trimEnd();
if (consultantPromptBody.length < 5000) {
  throw new Error(
    'fincasya-n8n-consultant-system-prompt.json vacío o desactualizado. En la raíz del repo ejecuta: bun run n8n:sync-consultant-prompt',
  );
}

const parseJs =
  'const item = $input.first().json;\n' +
  'const body = item.body || {};\n' +
  '// Solo mensajes entrantes de WhatsApp (texto u orden catálogo). Ignora contact.attributes_changed, message.updated, etc.\n' +
  'if (body.type !== \'whatsapp.inbound_message.received\') {\n' +
  '  return [];\n' +
  '}\n' +
  'const evt = body.whatsappInboundMessage || {};\n' +
  'if (!evt || typeof evt !== \'object\' || Object.keys(evt).length === 0) {\n' +
  '  return [];\n' +
  '}\n' +
  'const isOrder = evt.type === \'order\' && evt.order && Array.isArray(evt.order.product_items) && evt.order.product_items.length > 0;\n' +
  'const rawFrom = String(evt.from || \'\').trim();\n' +
  'const phone = rawFrom.replace(/^\\+/, \'\');\n' +
  'const phoneE164 = rawFrom ? (rawFrom.startsWith(\'+\') ? rawFrom : \'+\' + rawFrom.replace(/^\\+/, \'\')) : \'\';\n' +
  'const customerName = (evt.customerProfile && evt.customerProfile.name) ? evt.customerProfile.name : phone;\n' +
  'let textContent = \'\';\n' +
  'let mediaUrl = \'\';\n' +
  'let messageType = evt.type || \'unknown\';\n' +
  'if (evt.type === \'text\' && evt.text && evt.text.body) {\n' +
  '  textContent = String(evt.text.body).trim();\n' +
  '} else if (evt.type === \'image\' && evt.image) {\n' +
  '  textContent = (evt.image.caption || \'\').trim() || \'[Imagen]\';\n' +
  '  mediaUrl = evt.image.link || \'\';\n' +
  '} else if (evt.type === \'audio\' && evt.audio) {\n' +
  '  textContent = \'[Audio]\';\n' +
  '  mediaUrl = evt.audio.link || \'\';\n' +
  '} else if (evt.type === \'video\' && evt.video) {\n' +
  '  textContent = (evt.video.caption || \'\').trim() || \'[Video]\';\n' +
  '  mediaUrl = evt.video.link || \'\';\n' +
  '} else if (evt.type === \'document\' && evt.document) {\n' +
  '  textContent = (evt.document.caption || evt.document.filename || \'\').trim() || \'[Documento]\';\n' +
  '  mediaUrl = evt.document.link || \'\';\n' +
  '} else if (isOrder) {\n' +
  '  const first = evt.order.product_items[0] || {};\n' +
  '  const retailerId = (first.product_retailer_id || \'\').trim();\n' +
  '  const qty = first.quantity || 1;\n' +
  '  const catalogId = (evt.order.catalog_id || \'\').trim();\n' +
  '  textContent = (evt.order.text || \'Seleccioné una finca del catálogo.\').trim();\n' +
  '  if (retailerId) textContent += `\\nproduct_retailer_id: ${retailerId}\\nquantity: ${qty}` + (catalogId ? `\\ncatalog_id: ${catalogId}` : \'\');\n' +
  '  messageType = "order";\n' +
  '}\n' +
  '// Evita ejecutar el bot en eventos de texto vacío (ruido / estados).\n' +
  'if (!String(textContent || \'\').trim() && !String(mediaUrl || \'\').trim() && !isOrder) {\n' +
  '  return [];\n' +
  '}\n' +
  'if (!phoneE164) {\n' +
  '  return [];\n' +
  '}\n' +
  'const eventId = body.id || `evt_${Date.now()}_${phone}`;\n' +
  'let wamidRaw = \'\';\n' +
  'if (evt.wamid != null && String(evt.wamid).trim()) wamidRaw = String(evt.wamid).trim();\n' +
  'else if (evt.wamId != null && String(evt.wamId).trim()) wamidRaw = String(evt.wamId).trim();\n' +
  'else if (evt.id != null && String(evt.id).trim()) wamidRaw = String(evt.id).trim();\n' +
  'else if (evt.message && typeof evt.message === \'object\') {\n' +
  '  const m = evt.message;\n' +
  '  if (m.id != null && String(m.id).trim()) wamidRaw = String(m.id).trim();\n' +
  '  else if (m.wamid != null && String(m.wamid).trim()) wamidRaw = String(m.wamid).trim();\n' +
  '}\n' +
  'const wamidNorm = wamidRaw.replace(/^wamid\\./i, \'\');\n' +
  'const wamid = wamidRaw;\n' +
  'function fpHash(s) {\n' +
  '  let h = 0;\n' +
  '  const t = String(s || \'\');\n' +
  '  for (let i = 0; i < t.length; i++) h = Math.imul(31, h) + t.charCodeAt(i) | 0;\n' +
  '  return (h >>> 0).toString(16);\n' +
  '}\n' +
  '// Sin wamid, YCloud a veces reintenta con otro body.id → mismo texto en pocos segundos pasaba dedupe y enviaba 2 respuestas. Dedupe por huella + ventana 60s (antes 20s, aumentado para cubrir retries tardíos de YCloud).\n' +
  'const bucket60s = Math.floor(Date.now() / 60000);\n' +
  'const fpSrc = phone + String.fromCharCode(1) + messageType + String.fromCharCode(1) + String(textContent || \'\').trim().toLowerCase();\n' +
  'const dedupKey = wamidNorm\n' +
  '  ? (`msg:${phone}:${wamidNorm}`)\n' +
  '  : (`msg:${phone}:nw:${fpHash(fpSrc)}:${bucket60s}`);\n' +
  'const replyToWamid = (evt.context && evt.context.id) ? evt.context.id : \'\';\n' +
  '// Cuando el usuario responde a una tarjeta de catálogo, WhatsApp envía context.referred_product.product_retailer_id\n' +
  'const referredProductId = (evt.context && evt.context.referred_product && evt.context.referred_product.product_retailer_id)\n' +
  '  ? String(evt.context.referred_product.product_retailer_id).trim()\n' +
  '  : \'\';\n' +
  'return [{ json: {\n' +
  '  eventType: body.type,\n' +
  '  eventId,\n' +
  '  dedupKey,\n' +
  '  messageType,\n' +
  '  phone,\n' +
  '  phoneE164,\n' +
  '  customerName,\n' +
  '  textContent,\n' +
  '  mediaUrl,\n' +
  '  wamid,\n' +
  '  replyToWamid,\n' +
  '  referredProductId,\n' +
  '  isInboundText: body.type === "whatsapp.inbound_message.received" && evt.type === "text",\n' +
  '  isInboundOrder: body.type === "whatsapp.inbound_message.received" && messageType === "order",\n' +
  '  isOutbound: body.type === "whatsapp.message.updated" || body.direction === "outbound",\n' +
  '} }];\n';

/** Sin Structured Output Parser: extrae JSON si existe; si no, usa texto plano del Agent (`output` / `text`). No inyectamos copy de negocio aquí: el tono y las frases van solo en el system prompt. */
const parseAgentJsonJs =
  'function pickStr(x) {\n' +
  '  if (x == null) return \'\';\n' +
  '  if (typeof x === \'string\') return x;\n' +
  '  if (typeof x === \'number\' || typeof x === \'boolean\') return String(x);\n' +
  '  return \'\';\n' +
  '}\n' +
  'function normalizeAction(o) {\n' +
  '  if (!o || typeof o !== \'object\') return null;\n' +
  '  if (o.action != null) return o;\n' +
  '  if (o.output != null && typeof o.output === \'object\') return normalizeAction(o.output);\n' +
  '  return null;\n' +
  '}\n' +
  'function parseFirstJsonObject(t) {\n' +
  '  if (!t || typeof t !== \'string\') return null;\n' +
  '  const start = t.indexOf(\'{\');\n' +
  '  if (start < 0) return null;\n' +
  '  let depth = 0;\n' +
  '  let inStr = false;\n' +
  '  let esc = false;\n' +
  '  for (let i = start; i < t.length; i++) {\n' +
  '    const c = t[i];\n' +
  '    if (inStr) {\n' +
  '      if (esc) { esc = false; continue; }\n' +
  '      if (c === String.fromCharCode(92)) { esc = true; continue; }\n' +
  '      if (c === \'"\') inStr = false;\n' +
  '      continue;\n' +
  '    }\n' +
  '    if (c === \'"\') { inStr = true; continue; }\n' +
  '    if (c === \'{\') depth++;\n' +
  '    else if (c === \'}\') {\n' +
  '      depth--;\n' +
  '      if (depth === 0) {\n' +
  '        try { return JSON.parse(t.slice(start, i + 1)); } catch (e) { return null; }\n' +
  '      }\n' +
  '    }\n' +
  '  }\n' +
  '  return null;\n' +
  '}\n' +
  'function walk(o, depth) {\n' +
  '  if (depth > 12 || o == null) return null;\n' +
  '  const direct = normalizeAction(o);\n' +
  '  if (direct) return direct;\n' +
  '  if (typeof o === \'string\') {\n' +
  '    const p = parseFirstJsonObject(o.trim());\n' +
  '    return p ? normalizeAction(p) : null;\n' +
  '  }\n' +
  '  if (typeof o !== \'object\') return null;\n' +
  '  if (Array.isArray(o)) {\n' +
  '    for (let i = 0; i < o.length; i++) {\n' +
  '      const x = walk(o[i], depth + 1);\n' +
  '      if (x) return x;\n' +
  '    }\n' +
  '    return null;\n' +
  '  }\n' +
  '  const keys = Object.keys(o);\n' +
  '  for (let i = 0; i < keys.length; i++) {\n' +
  '    const x = walk(o[keys[i]], depth + 1);\n' +
  '    if (x) return x;\n' +
  '  }\n' +
  '  return null;\n' +
  '}\n' +
  '/** El nodo Agent a menudo devuelve solo texto en `output` (sin JSON). */\n' +
  'function plainTextFromAgentRow(row) {\n' +
  '  if (!row || typeof row !== \'object\') return \'\';\n' +
  '  const o = row.output;\n' +
  '  if (typeof o === \'string\' && o.trim()) return o.trim();\n' +
  '  const t = row.text;\n' +
  '  if (typeof t === \'string\' && t.trim()) return t.trim();\n' +
  '  const r = row.response;\n' +
  '  if (typeof r === \'string\' && r.trim()) return r.trim();\n' +
  '  return \'\';\n' +
  '}\n' +
  'const raw = $input.first().json;\n' +
  'const payload = walk(raw, 0);\n' +
  'let action = \'text\';\n' +
  'let text = \'\';\n' +
  'let catalogLocation = \'\';\n' +
  'let checkIn = \'\';\n' +
  'let checkOut = \'\';\n' +
  'let cupo = 0;\n' +
  'let isEvento = \'\';\n' +
  'if (payload) {\n' +
  '  action = String(payload.action || \'text\').toLowerCase();\n' +
  '  if (action !== \'catalog\') action = \'text\';\n' +
  '  text = pickStr(payload.text);\n' +
  '  catalogLocation = pickStr(payload.catalogLocation).trim();\n' +
  '  checkIn = pickStr(payload.checkIn || payload.fechaEntrada).trim();\n' +
  '  checkOut = pickStr(payload.checkOut || payload.fechaSalida).trim();\n' +
  '  const rawCupo = payload.cupo;\n' +
  '  if (rawCupo != null && Number.isFinite(Number(rawCupo)) && Number(rawCupo) > 0) {\n' +
  '    cupo = Number(rawCupo);\n' +
  '  }\n' +
  '  if (payload.isEvento === true || payload.isEvento === false) {\n' +
  '    isEvento = payload.isEvento;\n' +
  '  } else if (typeof payload.isEvento === \'string\' && payload.isEvento.trim() !== \'\') {\n' +
  '    const ev = payload.isEvento.trim().toLowerCase();\n' +
  '    if (ev === \'true\') isEvento = true;\n' +
  '    else if (ev === \'false\') isEvento = false;\n' +
  '  }\n' +
  '}\n' +
  'if (!text.trim()) {\n' +
  '  const plain = plainTextFromAgentRow(raw);\n' +
  '  if (plain) text = plain;\n' +
  '}\n' +
  'return [{ json: { action, text, catalogLocation, checkIn, checkOut, cupo, isEvento } }];\n';

/** Une la salida de **Parse agent JSON** con Parse YCloud (teléfono, eventId, etc.). */
const mergeAgentWithInboundJs =
  'const inbound = $(\'Parse YCloud Event\').first().json;\n' +
  'const all = $input.all();\n' +
  'const agentRow = (all[0] && all[0].json) ? all[0].json : $input.first().json;\n' +
  'const phoneE164 =\n' +
  '  inbound.phoneE164 ||\n' +
  '  (inbound.phone ? \'+\' + String(inbound.phone).replace(/^\\+/, \'\') : \'\');\n' +
  'let action = String(agentRow.action || \'text\').toLowerCase();\n' +
  'let text = String(agentRow.text || \'\');\n' +
  'let catalogLocation = String(agentRow.catalogLocation || \'\').trim();\n' +
  'let checkIn = String(agentRow.checkIn || agentRow.fechaEntrada || \'\').trim();\n' +
  'let checkOut = String(agentRow.checkOut || agentRow.fechaSalida || \'\').trim();\n' +
  'let cupo = 0;\n' +
  'const rawCupo = agentRow.cupo;\n' +
  'if (rawCupo != null && Number.isFinite(Number(rawCupo)) && Number(rawCupo) > 0) {\n' +
  '  cupo = Number(rawCupo);\n' +
  '}\n' +
  'let isEvento = \'\';\n' +
  'if (agentRow.isEvento === true || agentRow.isEvento === false) {\n' +
  '  isEvento = agentRow.isEvento;\n' +
  '} else if (typeof agentRow.isEvento === \'string\' && agentRow.isEvento.trim() !== \'\') {\n' +
  '  const ev = agentRow.isEvento.trim().toLowerCase();\n' +
  '  if (ev === \'true\') isEvento = true;\n' +
  '  else if (ev === \'false\') isEvento = false;\n' +
  '}\n' +
  'function isYmd(s) {\n' +
  '  return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(s || \'\').trim());\n' +
  '}\n' +
  'function nextMissingDataQuestion(missingKey) {\n' +
  '  if (missingKey === \'location\') {\n' +
  '    return "¡Listo! ¿A qué municipio o sector están pensando ir? 🏡";\n' +
  '  }\n' +
  '  if (missingKey === \'dates\') {\n' +
  '    return "Perfecto 👌 Para filtrar disponibilidad real, ¿cuál sería la fecha de ingreso y cuál la fecha de salida? 📅";\n' +
  '  }\n' +
  '  if (missingKey === \'cupo\') {\n' +
  '    return "¡Perfecto! ¿Para cuántas personas sería la reserva? 👥";\n' +
  '  }\n' +
  '  if (missingKey === \'evento\') {\n' +
  '    return "Una última cosita ✨ ¿La finca sería para algún evento o solo para descansar y compartir? 🎉";\n' +
  '  }\n' +
  '  return "Cuéntame un dato más para continuar con tu búsqueda 🏡";\n' +
  '}\n' +
  '// Heurística anti-asunción: detecta si el último mensaje del cliente parece responder a evento/descanso.\n' +
  '// Si el modelo cocinó isEvento sin que el cliente lo confirmara recientemente, no podemos saber con certeza desde merge,\n' +
  '// pero sí sabemos que cuando el cliente dice "no sé" / "no se" sobre municipio en este mismo turno, isEvento debería estar "" \n' +
  '// (porque ese turno trataba sobre municipio, no sobre evento).\n' +
  'function lower(s) { return String(s || \'\').trim().toLowerCase(); }\n' +
  'const lastUserText = lower(inbound.textContent);\n' +
  'const userSaidNoSeMunicipio = (\n' +
  '  /^no\\s*s[ée]\\b/.test(lastUserText) ||\n' +
  '  /^no\\s+s[ée]$/.test(lastUserText) ||\n' +
  '  /(?:no\\s*s[ée]|recom[ie]end|sorpr[eé]nd|t[uú]\\s+decid|cualquier)/.test(lastUserText)\n' +
  ');\n' +
  '// Catálogo solo si están confirmados los 4 datos del filtro: municipio (o RECOMENDADAS) + fechas ISO + cupo > 0 + isEvento explícito (true|false).\n' +
  '// Esto evita que el modelo dispare catalog "por defecto" en Melgar sin que el cliente diera ciudad, o sin saber si es evento.\n' +
  'if (action === \'catalog\') {\n' +
  '  const locOk = catalogLocation.length > 0;\n' +
  '  const isRecomendadas = catalogLocation.toUpperCase() === \'RECOMENDADAS\';\n' +
  '  const datesOk = isYmd(checkIn) && isYmd(checkOut);\n' +
  '  const cupoOk = Number.isFinite(Number(cupo)) && Number(cupo) > 0;\n' +
  '  let isEventoOk = isEvento === true || isEvento === false;\n' +
  '  // Si en este turno el cliente acaba de decir "no sé" sobre municipio y el modelo igual cocinó isEvento, descartamos isEvento:\n' +
  '  // ese turno no podía haber tratado de evento/descanso (el bot le acababa de preguntar municipio).\n' +
  '  if (isRecomendadas && isEventoOk && userSaidNoSeMunicipio) {\n' +
  '    isEvento = \'\';\n' +
  '    isEventoOk = false;\n' +
  '  }\n' +
  '  let missing = \'\';\n' +
  '  if (!locOk) missing = \'location\';\n' +
  '  else if (!datesOk && !isRecomendadas) missing = \'dates\';\n' +
  '  else if (!cupoOk) missing = \'cupo\';\n' +
  '  else if (!isEventoOk) missing = \'evento\';\n' +
  '  // RECOMENDADAS puede enviarse sin fechas ISO; el resto SIEMPRE requiere los 4 datos.\n' +
  '  if (missing) {\n' +
  '    action = \'text\';\n' +
  '    text = nextMissingDataQuestion(missing);\n' +
  '    catalogLocation = \'\';\n' +
  '    checkIn = \'\';\n' +
  '    checkOut = \'\';\n' +
  '  }\n' +
  '}\n' +
  '// Sin texto inyectado desde el script: si el modelo pidió catalog sin ISO/municipio, solo degradamos a text y limpiamos campos; el mensaje al usuario lo define el system prompt.\n' +
  'return [{\n' +
  '  json: {\n' +
  '    ...inbound,\n' +
  '    phoneE164,\n' +
  '    action,\n' +
  '    text,\n' +
  '    catalogLocation,\n' +
  '    checkIn,\n' +
  '    checkOut,\n' +
  '    cupo,\n' +
  '    isEvento,\n' +
  '  },\n' +
  '}];\n';

/** Tras Parse agent JSON + Merge, action/text/catalogLocation están en la raíz de $json. */
const n8nChannelOverlay =
  '\n\n---\n' +
  '## Canal n8n (WhatsApp vía este workflow; obligatorio)\n' +
  '- **Precedencia:** este bloque **solo** gobierna JSON (`action`, fechas ISO, `catalogLocation`) y cuándo puede ir `action=catalog`. **No** sustituyas el tono ni la **bienvenida oficial** del prompt del consultor: si el «ÚLTIMO MENSAJE» es **solo** un saludo simple (“hola”, “buenas”, etc.) **sin** más datos, debes enviar **exactamente** el **MENSAJE DE BIENVENIDA OFICIAL** que ya está definido arriba en ese prompt (mismo texto, mismas viñetas). Ahí sí va el bloque con fechas, cupo, tipo de grupo y ubicación.\n' +
  '- **Un solo canal de entrada:** en YCloud debe haber **una** URL de webhook para `whatsapp.inbound_message.received` (la de n8n **o** la de Convex, no ambas). Si las dos reciben el mismo evento, el cliente puede ver varias respuestas seguidas sin escribir de nuevo. En Convex puedes poner `CONVEX_WHATSAPP_INBOUND_AI_DISABLED=1` para dejar solo n8n.\n' +
  '- **Redis (`FLUSHALL`):** solo borra memoria de chat y dedupe en Redis; **no** cambia el modelo ni este system prompt. Si el bot “se comporta igual”, el problema no era la memoria Redis sola.\n' +
  '- **Saludo solo (“hola”, “buenas”, etc.):** responde con el **MENSAJE DE BIENVENIDA OFICIAL** definido en el system prompt de arriba. El workflow **no** escribe mensajes de negocio en el script; solo valida JSON (`action`, fechas ISO, `catalogLocation`) para el catálogo.\n' +
  '- **Catálogo (`action=catalog`):** el workflow **solo** envía fichas si en el JSON vienen **los CUATRO datos confirmados explícitamente por el cliente** (no inventados): (1) `catalogLocation` (municipio que el cliente escribió, o la cadena literal `"RECOMENDADAS"` si pidió que recomendaras), (2) `checkIn` en **YYYY-MM-DD**, (3) `checkOut` en **YYYY-MM-DD**, (4) `cupo` entero > 0, (5) `isEvento` **true** o **false**. Si falta cualquiera de estos → `action=text` y pregunta **solo el siguiente dato** que falte. El nodo **Merge agent with inbound** ahora **degrada** a `text` cualquier `catalog` que no traiga los cinco; si lo intentas, el cliente se queda sin respuesta útil.\n' +
  '- 🚨 **INFERENCIA DE AÑO Y MES EN FECHAS (CRÍTICO):** Lee siempre el bloque "=== FECHA ACTUAL ===" que llega al inicio del mensaje del cliente: ahí están el mes y año actuales para inferir fechas. Cuando el cliente da fechas sin año explícito (ej. "del 17 al 18 de mayo", "el viernes 20 de junio", "del 16 al 18"), infiere el año actual del bloque; si esa fecha ya pasó este año, usa el siguiente. Convierte "del 17 al 18 de mayo" → checkIn YYYY-05-17 / checkOut YYYY-05-18 (con YYYY = año actual del bloque). **Cuando el cliente da solo días sin mes ni año** (ej. "del 15 al 19", "para el 15 al 19", "para el 17 al 18"), usa el **mes y año actuales** del bloque "FECHA ACTUAL"; si los días ya pasaron este mes, usa el mes siguiente. NUNCA dejes checkIn/checkOut vacíos si el cliente dio cualquier indicio de fechas en lenguaje natural; **NUNCA vuelvas a pedirle las fechas** si ya escribió números de día. Si tienes duda real, asume el mes actual y avanza.\n' +
  '- 🚨 **ORDEN OBLIGATORIO DE RECOLECCIÓN ANTES DEL CATÁLOGO (CRÍTICO):** **Nunca** envíes `action=catalog` si en la conversación falta uno solo de los cuatro filtros. El orden por defecto es: (1) **municipio** → (2) **fechas** entrada/salida → (3) **cupo** (personas que se alojan) → (4) **evento o descanso** ("¿es para algún evento o solamente descansar?"). Si el cliente envió varios datos en un mismo mensaje, **extráelos todos** y pregunta solo el siguiente que falte. Si responde fechas + cupo pero **no dio municipio**, tu respuesta DEBE ser `action=text` con UNA pregunta: "¡Perfecto! ¿A qué municipio o sector están pensando ir? 🏡". **Prohibido** asumir un municipio (ej. Melgar) que el cliente no escribió. **Prohibido** disparar catálogo "para ir avanzando".\n' +
  '- 🚨 **DISPARAR CATÁLOGO INMEDIATAMENTE CUANDO TIENES LOS 4 DATOS (CRÍTICO):** En el momento en que el cliente confirme el ÚLTIMO dato necesario (típicamente evento/descanso) y ya tengas en el historial los otros tres (municipio + fechas ISO + cupo), tu respuesta DEBE ser `action=catalog`. **ESTÁ TERMINANTEMENTE PROHIBIDO** responder con `action=text` + frases tipo "Vamos a validar opciones", "Perfecto, revisaremos disponibilidad", "Vamos a buscar opciones" u otras frases de espera. La única acción válida es enviar el JSON con `action=catalog` directamente. El campo **text** debe ser un mensaje **PRE-catálogo** corto ("te voy a compartir algunas opciones…"), porque el workflow lo enviará **ANTES** de las fichas. Ejemplo del turno que cierra la recopilación: cliente confirma "es para descansar" → ya tienes Melgar + 2026-05-17/2026-05-18 + 6 personas → responde INMEDIATAMENTE: `{"action":"catalog","text":"¡Perfecto! 🏡 Te voy a compartir algunas opciones en Melgar para tus fechas y plan en familia. ✨","catalogLocation":"Melgar","checkIn":"2026-05-17","checkOut":"2026-05-18","cupo":6,"isEvento":false}`\n' +
  '- **Cliente sin preferencia de municipio** ("no sé", "recomiéndame", "¿qué me recomiendas?", "sorpréndeme", "tú decides"): cuando el cliente diga que no tiene municipio en mente, **NO dispares catálogo todavía**. Antes debes confirmar **evento o descanso** si aún no consta en el historial. Recién cuando tengas los **4 datos** (fechas + cupo + isEvento confirmado + "no sé" respecto a municipio) puedes enviar `action=catalog` con `catalogLocation="RECOMENDADAS"` (exactamente ese texto, en mayúsculas, **solo en el campo JSON `catalogLocation`**). Para RECOMENDADAS las fechas ISO son opcionales (inclúyelas si las tienes), pero `cupo` e `isEvento` siguen siendo obligatorios.\n' +
  '  🚨 **PROHIBIDO en el campo `text`:** la palabra "RECOMENDADAS" **NUNCA** debe aparecer en el campo `text` (eso lo ve el cliente y es un sentinel técnico). Para `text` usa frases naturales tipo: "¡Mira estas fincas que más nos gustan! 🏡✨ Dime cuál te llama la atención.", "¡Listo! 🏡 Te voy a compartir algunas de nuestras fincas favoritas. ✨" o "¡Perfecto! 🏡 Te comparto algunas opciones que solemos recomendar para tus fechas. ✨". **No uses** plantillas con "<ciudad>" ni "en RECOMENDADAS".\n' +
  '- 🚨 **isEvento NUNCA POR DEFECTO (CRÍTICO):** El campo `isEvento` SOLO puede ser `true` o `false` cuando el cliente respondió **explícitamente** "es un evento", "es para descansar", "fiesta", "celebración", "solo descansar", "familiar/descanso" o equivalente claro. Si el cliente NO ha respondido a la pregunta de evento/descanso, `isEvento` debe quedar en `""` (string vacío). **PROHIBIDO** asumir `false` solo porque dijo "familia", "amigos" o "pareja" — esos son tipos de plan, no respuesta a evento/descanso. Si `isEvento=""`, NO uses `action=catalog`; primero pregunta: "¿La finca sería para algún evento o solo para descansar y compartir? 🎉".\n' +
  '- Usa **search_fincas**, **list_properties_by_department** y **get_finca_by_code** hacia la API de FincasYa para datos reales; no inventes precios ni disponibilidad.\n' +
  '- **Prioridad del input:** la primera sección del mensaje de usuario (cabecera «ÚLTIMO MENSAJE») es el texto **exacto** de este turno. Tiene prioridad sobre el historial en Redis: si ahí dice cupo (ej. «10 personas»), municipio o fechas, **son hechos confirmados**; no los pidas otra vez. **No inventes** fechas (ej. «16 al 18 de mayo») si el cliente **no** las escribió en ese último mensaje o en el historial claro reciente.\n' +
  '- **Prohibido** decir «ya tengo Melgar» o cualquier municipio si el cliente **no** lo escribió en el último mensaje o en el historial explícito. **Prohibido** cambiar o acortar fechas que el cliente dio (si dijo 16–18, no digas 16–17).\n' +
  '- **Después de la bienvenida oficial:** en turnos siguientes, orden comercial y **una pregunta concreta por turno** (lo que falte): municipio → fechas → personas → tipo de plan → evento vs descanso, según el manual del consultor. **No** repitas la bienvenida completa si el cliente ya envió datos.\n' +
  '- **Una sola respuesta por ejecución del workflow:** un solo JSON final; no simules dos turnos del asistente en un mismo mensaje.\n' +
  '- Tu respuesta final para el workflow debe incluir **un solo objeto JSON** con los 7 campos: action, text, catalogLocation, checkIn, checkOut, cupo, isEvento (el nodo **Parse agent JSON** lo extrae; puede ser plano o bajo `output`). **Siempre incluye cupo e isEvento**, incluso en action=text.\n' +
  '- checkIn y checkOut: fechas de estadía del cliente en formato **YYYY-MM-DD** (ej. 2026-05-16 y 2026-05-18). Si no las tienes claras, deja ambas en cadena vacía.\n' +
  '- No pongas en "text" marcadores técnicos [CONTRACT_PDF:...] ni [STATUS:...]. Si debes escalar, dilo en palabras (action=text).\n' +
  '- action=catalog: **solo** cuando tengas en el JSON los **5** datos válidos: `catalogLocation` (municipio o RECOMENDADAS) + `checkIn`/`checkOut` ISO (opcionales solo si RECOMENDADAS) + `cupo` > 0 + `isEvento` true/false. **text** = una frase **PRE-catálogo** corta ("Te voy a compartir algunas opciones en <ciudad> ✨"), porque el workflow lo envía **ANTES** de las fichas, no después. **Prohibido** texto tipo "te acabo de enviar" en `action=catalog`: aún no se han enviado.\n' +
  '- **Tras haber enviado catálogo** (el historial ya muestra fichas/productos): en los siguientes turnos usa **action=text** con **un solo** mensaje breve (máx. 2–3 frases). **Prohibido** pedir de nuevo municipio, fechas, cupo o “plan familiar” si ya constan en el chat. La pregunta debe ir **solo** a identificar la finca, por ejemplo: «Ya te compartí algunas opciones ✅ ¿Cuál finca te gustó? 🏡 Si quieres, también puedo mostrarte más alternativas.» — **no** envíes varias rondas seguidas resumiendo lo mismo.\n' +
  '- Si el cliente **nombra una finca** (“me gustó la X”, “Quinta Boutique”…): **no** vuelvas a pedir fechas ni número de personas; reconoce la finca y avanza (ej. mascotas o siguiente paso según el manual), siempre en **un** mensaje conciso.\n' +
  '- 🚨 **TARJETA RESPONDIDA — REGLA CRÍTICA:** Si el mensaje del usuario comienza con `[TARJETA RESPONDIDA: el usuario tocó “Responder” en la tarjeta de la finca “`, significa que el sistema ya identificó automáticamente qué finca eligió el cliente desde el catálogo. En ese caso: (1) **NUNCA** preguntes el nombre de la finca, (2) confirma la finca mencionada en el marcador, (3) avanza directamente al siguiente paso (mascotas o PASO 4 según el historial). Ejemplo de respuesta: “¡Perfecto! 🏡 Seleccionaste [nombre de la finca]. ¿Llevarás mascotas? 🐾”\n' +
  '- 🚨 **NOMBRE DE FINCA ≠ INTENCIÓN — REGLA CRÍTICA:** Los nombres de las fincas en el catálogo pueden contener palabras genéricas como “eventos”, “villa”, “luxury”, “paradise”, etc. Cuando el cliente menciona cualquier nombre que corresponda (parcial o totalmente) a una finca del catálogo (ej. “Villavicencio Eventos Luxury”, “Villa Bar”, “Apiay Villa”), SIEMPRE trátalo como **selección de una finca específica**, NUNCA como solicitud de tipo de evento, plan o destino. Responde reconociendo la finca elegida y avanza al siguiente paso: pregunta si llevará mascotas 🐾 (si no se ha confirmado aún) o pasa directamente al PASO 4 (contrato).\n' +
  '- 🚨 **CATÁLOGO YA ENVIADO = action=catalog ABSOLUTAMENTE PROHIBIDO:** Tu historial en Redis almacena tus propias respuestas anteriores como JSON. Si en **cualquier** mensaje tuyo anterior aparece `”action”:”catalog”` (o `action=catalog`), eso significa sin excepción que el catálogo de WhatsApp ya fue enviado al cliente — aunque no veas las tarjetas de finca en el historial (las tarjetas viajan por API, no por Redis). A partir de ese momento, **action=catalog está TERMINANTEMENTE PROHIBIDO** en cualquier turno siguiente, sin importar lo que diga el cliente. Usa SOLO action=text. La única respuesta válida si el cliente aún no ha elegido finca es: “¿Cuál finca te llamó la atención? 🏡” — sin resumir, sin re-listar, sin re-enviar catálogo bajo ninguna circunstancia. Si el cliente dice “sí”, “dale”, “continúa”, “procede” o similar después del catálogo: eso es confirmación de una finca o avance al contrato, NUNCA una nueva solicitud de catálogo.\n' +
  '- 🚨 **PROHIBIDO: "UN MOMENTO" Y RESPUESTAS DE ESPERA (CRÍTICO):** JAMÁS respondas con frases como "Un momento por favor", "Espera un instante", "Ahora te hago la cotización", "Déjame verificar", "Voy a procesar", "En breve te respondo" u otras que impliquen que el bot hará algo después. El workflow solo ejecuta cuando el cliente escribe — si dices "un momento", el cliente queda esperando para siempre. Si tienes la información, responde DIRECTAMENTE en ese mismo turno sin anunciarlo.\n' +
  '- 🚨 **FLUJO POST-CATÁLOGO ESTRICTO — MASCOTAS → CONFIRMACIÓN → PASO 4 (CRÍTICO):** Una vez enviado el catálogo y el cliente nombre o seleccione una finca, sigue este orden **sin saltarte pasos**:\n' +
  '  1. **Pregunta mascotas y comparte la regla:** "¡Perfecto! 🏡 Seleccionaste **[Nombre finca]**. ¿Llevarás mascotas? 🐾 Si es **sí**: 1ª y 2ª mascota → depósito reembolsable de **$100.000 c/u**; desde la 3ª → **$30.000 c/u** (no reembolsable) + cargo único de aseo de **$70.000**. No pueden subir a piscina, muebles ni camas, y se recogen sus desechos. ¿Llevarás alguna y cuántas?". Espera a que el cliente confirme sí/no (y cantidad si aplica) — **no avances** sin esa confirmación.\n' +
  '  2. **Mensaje de confirmación con precio temporada + mascotas (UN SOLO mensaje):** "¡Listo! ✅ Resumen de tu selección:\\n🏡 Finca: **[Nombre]**\\n📅 Fechas: [entrada] a [salida] · [N] noches\\n👥 Personas: [N]\\n🐾 Mascotas: [Sí, X / No]\\n💰 Tarifa **[Temporada baja/media/alta/especial]**: $[valor por noche]/noche × [N] noches = **$[total alojamiento]**\\n[+ Mascotas: depósito $[X] reembolsable / cargos no reembolsables $[X] / aseo $[X] (si aplica)]\\n**Total estimado: $[gran total]**\\n\\n¿Avanzamos con la reserva? ✨". Toma los precios y la temporada del bloque "## 🏷️ TEMPORADAS" / "## 🏘️ DISPONIBILIDAD" del contexto. **Nunca** inventes valores; si el contexto no trae el precio, di que un asesor confirma valor exacto.\n' +
  '  3. **Cuando el cliente diga "sí", "dale", "procede":** envía EXACTAMENTE el bloque del **PASO 4** del manual (mensaje verbatim de "¡Excelente elección! ✨ … RNT 163658 …") para pedir los datos de contrato (nombre, cédula, correo, teléfono, dirección).\n' +
  '  ⛔ **PROHIBIDO** saltar de "elegí finca" directo a PASO 4 sin pasar por mascotas + confirmación. ⛔ **PROHIBIDO** mezclar el resumen + el bloque de PASO 4 en un solo turno.\n' +
  '- 🚨 **ESCALAR A HUMANO CUANDO EL CLIENTE ENVÍA DATOS DE CONTRATO (CRÍTICO):** Cuando el cliente responde con sus datos personales (mínimo nombre completo + cédula, o nombre + correo), responde en UN mensaje: confirma brevemente los datos recibidos y dile que un asesor lo contactará de inmediato para formalizar el contrato y el pago. Ejemplo: "¡Perfecto, [Nombre]! 🎉 Recibí tus datos. Un asesor de FincasYa te contactará muy pronto para enviarte el contrato y coordinar el pago. ¡Gracias por elegirnos! 🏡✨" — NO generes [CONTRACT_PDF], NO pidas comprobante de pago, NO digas "un momento".\n' +
  '- Si en Convex la conversación está en **modo humano**, el workflow no llamará al agente; cuando tú envíes mensaje desde WhatsApp Business, YCloud envía `whatsapp.outbound_message.sent` y el flujo marca humano.\n' +
  '- En cualquier otro caso action=text con respuesta útil (nunca vacía).\n' +
  '- REGLA: action solo puede ser **text** o **catalog** (no plantillas WhatsApp desde este flujo).\n' +
  '- El nodo **Parse YCloud Event** solo deja pasar `whatsapp.inbound_message.received` con `from` válido; no inventes respuestas para otros webhooks.\n' +
  '- Si el cliente ve **la misma respuesta duplicada**: (1) un solo webhook en YCloud; (2) el dedupe del flujo usa **INCR atómico** en Redis para que dos POST simultáneos no pasen ambos.\n' +
  '- No actives **Always Output Data** en el Switch de **Dispatch**: en algunas versiones de n8n puede mandar un ítem vacío por la primera salida y disparar **Fetch Catalog** sin `location`.\n' +
  '- Para cambiar reglas en n8n: edita el **System Message** del agente en el canvas (o en el repo edita consultantPrompt.ts → `bun run n8n:sync-consultant-prompt` → vuelve a exportar/publicar el workflow).\n';

const n8nStructuredOutputFormatBlock =
  '\n\n⚠️ FORMATO OBLIGATORIO DE RESPUESTA (JSON para WhatsApp — sin parser en n8n)\n\n' +
  'Cierra SIEMPRE con **un único objeto JSON** (misma respuesta, sin markdown ni ```json). Puede ser **plano** (preferido) o envuelto en `"output": { ... }`.\n\n' +
  'El JSON tiene 7 campos:\n' +
  '- action: "text" o "catalog"\n' +
  '- text: mensaje al cliente. Para `action=catalog` se enviará como texto **ANTES** de las fichas (mensaje pre-catálogo "te voy a compartir algunas opciones…"). NO uses "te acabo de enviar" en catalog porque las fichas todavía no salieron.\n' +
  '- catalogLocation: municipio EXACTO que el cliente escribió (ej. "Villavicencio"), o la cadena literal `"RECOMENDADAS"` si el cliente pidió que recomendaras (solo para action=catalog). **Nunca** asumas un municipio que el cliente no haya mencionado.\n' +
  '- checkIn / checkOut: fechas en YYYY-MM-DD (requeridas para action=catalog con municipio; opcionales para RECOMENDADAS).\n' +
  '- cupo: número de personas que el cliente confirmó (entero > 0). **Requerido** para action=catalog. Deja 0 si no se sabe aún (entonces NO envíes catalog).\n' +
  '- isEvento: **true** si el cliente busca finca para evento/fiesta/celebración, **false** si es descanso/familiar/pareja. **Requerido** para action=catalog. Deja "" si no se ha confirmado aún (entonces NO envíes catalog, pregunta primero).\n\n' +
  'Preferido (plano, una sola línea o compacto):\n' +
  '{"action":"text","text":"mensaje al cliente","catalogLocation":"","checkIn":"","checkOut":"","cupo":0,"isEvento":""}\n\n' +
  'Con catálogo — el workflow envía PRIMERO el "text" como mensaje pre-catálogo, y LUEGO las fichas filtradas por cupo/tipo:\n' +
  '{"action":"catalog","text":"¡Perfecto! 🏡 Te voy a compartir algunas opciones en <ciudad> para tus fechas y <N> personas. ✨","catalogLocation":"<ciudad-confirmada-por-cliente>","checkIn":"2026-05-16","checkOut":"2026-05-18","cupo":10,"isEvento":false}\n' +
  '// NOTA: reemplaza <ciudad-confirmada-por-cliente> con el municipio EXACTO que el cliente escribió. NUNCA uses una ciudad que el cliente no haya mencionado.\n\n' +
  'action solo **text** o **catalog**. `catalog` **requiere** los **5 datos válidos**: `catalogLocation` + `checkIn` ISO + `checkOut` ISO + `cupo > 0` + `isEvento` true/false. Si falta CUALQUIERA, usa `text` y pregunta **solo** ese dato.\n' +
  'NO pongas texto narrativo después del JSON.\n';

const systemMessage =
  consultantPromptBody + n8nChannelOverlay + n8nStructuredOutputFormatBlock;

/** Clasifica el POST de YCloud: mensaje saliente (humano) vs entrante del cliente. */
const ycloudEntryRouterJs =
  'const item = $input.first().json || {};\n' +
  'const body = item.body || {};\n' +
  'if (body.type === \'whatsapp.outbound_message.sent\') {\n' +
  '  const toRaw = String((body.whatsappOutboundMessage && body.whatsappOutboundMessage.to) || \'\').trim();\n' +
  '  if (!toRaw) return [];\n' +
  '  const digits = toRaw.replace(/\\D/g, \'\');\n' +
  '  if (!digits) return [];\n' +
  '  const e164 = toRaw.startsWith(\'+\') ? toRaw : (\'+\' + digits);\n' +
  '  return [{ json: { _flow: \'handoff\', handoffPhoneE164: e164 } }];\n' +
  '}\n' +
  'if (body.type === \'whatsapp.inbound_message.received\') {\n' +
  '  return [{ json: { _flow: \'inbound\', body: item.body, headers: item.headers || {} } }];\n' +
  '}\n' +
  'return [];\n';

const ycloudEntryRouter = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'YCloud entry router',
    executeOnce: true,
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ycloudEntryRouterJs },
    position: [28, 192],
  },
  output: [{ _flow: 'inbound', body: { type: 'whatsapp.inbound_message.received' } }],
});

const routeYCloudEntry = switchCase({
  version: 3.4,
  config: {
    name: 'Route YCloud entry',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  leftValue: '={{ $json._flow }}',
                  rightValue: 'handoff',
                  operator: { type: 'string', operation: 'equals' },
                  id: 'yc-flow-handoff',
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'handoff',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  leftValue: '={{ $json._flow }}',
                  rightValue: 'inbound',
                  operator: { type: 'string', operation: 'equals' },
                  id: 'yc-flow-inbound',
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'inboundChat',
          },
        ],
      },
      options: { fallbackOutput: 'none', ignoreCase: false },
    },
    position: [56, 192],
  },
});

const reshapeWebhookForParse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Reshape inbound for Parse',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const j = $input.first().json;\n' +
        'if (String(j._flow || \'\') !== \'inbound\' || !j.body) return [];\n' +
        'return [{ json: { body: j.body, headers: j.headers || {} } }];\n',
    },
    position: [84, 288],
  },
  output: [
    {
      body: { type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { type: 'text', text: { body: 'hola' }, from: '+573001112233' } },
    },
  ],
});

const markHumanHandoffHttp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Mark outbound human (Convex)',
    parameters: {
      method: 'POST',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/integrations/n8n/mark-outbound-human',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('={{ JSON.stringify({ phone: String($json.handoffPhoneE164 || "").trim() }) }}'),
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 12000 },
    },
    credentials: { httpHeaderAuth: newCredential('FincasYa Log API') },
    position: [84, 96],
  },
  output: [{ ok: true }],
});

const gateShouldBotReplyHttp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Gate: should bot reply',
    parameters: {
      method: 'GET',
      url: expr(
        '={{ "https://62q8s3xq-3001.use2.devtunnels.ms/api/integrations/n8n/should-bot-reply?phone=" + encodeURIComponent(String($json.phoneE164 || "").trim()) }}',
      ),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 12000 },
    },
    credentials: { httpHeaderAuth: newCredential('FincasYa Log API') },
    position: [1008, 192],
  },
  output: [{ runBot: true, conversationStatus: 'ai' }],
});

const gateBotContinueIfRunBot = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Gate: continue if runBot',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const parse = $(\'Dedup: solo primer intento\').first().json;\n' +
        'const row = $input.first().json;\n' +
        'const rb = row.runBot;\n' +
        'if (rb === false || rb === \'false\') return [];\n' +
        'return [{ json: parse }];\n',
    },
    position: [1120, 192],
  },
  output: [
    {
      eventType: 'whatsapp.inbound_message.received',
      phone: '573001112233',
      phoneE164: '+573001112233',
      textContent: 'hola',
      messageType: 'text',
      eventId: 'e1',
      dedupKey: 'msg:573001112233:wamid_x',
      isInboundText: true,
      isInboundOrder: false,
    },
  ],
});

const ycloudInboundWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'YCloud Inbound Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'ycloud-fincasya',
      options: { responseCode: { values: {} }, responseData: 'ok' },
    },
    position: [0, 192],
  },
  output: [{ body: { type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { type: 'text', text: { body: 'hola' }, from: '+573001112233' } } }],
});

const parseYCloudEvent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse YCloud Event',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseJs },
    position: [112, 192],
  },
  output: [
    {
      eventType: 'whatsapp.inbound_message.received',
      phone: '573001112233',
      phoneE164: '+573001112233',
      textContent: 'hola',
      messageType: 'text',
      eventId: 'e1',
      dedupKey: 'msg:573001112233:wamid_x',
      isInboundText: true,
      isInboundOrder: false,
    },
  ],
});

/** POST al Nest: guarda mensaje del cliente en Convex; la salida HTTP no sirve al resto del flujo. */
const logInboundUserAfterParse = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Log inbound user (Convex)',
    parameters: {
      method: 'POST',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/integrations/n8n/log-inbound-user',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ (() => {\n' +
          '  const j = $json;\n' +
          '  const raw = String(j.messageType || \'text\').toLowerCase();\n' +
          '  const mt = raw === \'order\' ? \'product\' : raw;\n' +
          '  const allowed = [\'text\', \'image\', \'audio\', \'video\', \'document\', \'product\'];\n' +
          '  const type = allowed.indexOf(mt) >= 0 ? mt : \'text\';\n' +
          '  const media = String(j.mediaUrl || \'\').trim();\n' +
          '  return {\n' +
          '    phone: String(j.phoneE164 || \'\').trim(),\n' +
          '    customerName: String(j.customerName || \'\').trim(),\n' +
          '    content: String(j.textContent || \'\'),\n' +
          '    messageType: type,\n' +
          '    ...(media ? { mediaUrl: media } : {}),\n' +
          '    metadata: { source: \'n8n_ycloud_inbound\', wamid: j.wamid, dedupKey: j.dedupKey, eventId: j.eventId },\n' +
          '  };\n' +
          '})() }}',
      ),
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 12000 },
    },
    credentials: { httpHeaderAuth: newCredential('FincasYa Log API') },
    position: [224, 192],
  },
  output: [{ ok: true }],
});

/** Devuelve el JSON de Parse YCloud al flujo (el nodo HTTP anterior devuelve respuesta de la API). */
const restoreParseOutputAfterInboundLog = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore after inbound log',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const rows = $(\'Parse YCloud Event\').all();\n' +
        'if (!rows.length) return [];\n' +
        'return rows.map(function (r) { return { json: r.json }; });\n',
    },
    position: [336, 192],
  },
  output: [
    {
      eventType: 'whatsapp.inbound_message.received',
      phone: '573001112233',
      phoneE164: '+573001112233',
      textContent: 'hola',
      messageType: 'text',
      eventId: 'e1',
      dedupKey: 'msg:573001112233:wamid_x',
      isInboundText: true,
      isInboundOrder: false,
    },
  ],
});

const routeMessageKind = node({
  type: 'n8n-nodes-base.switch',
  version: 3.4,
  config: {
    name: 'Route Message Kind',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  leftValue: '={{ $json.isInboundText || $json.isInboundOrder }}',
                  rightValue: true,
                  operator: { type: 'boolean', operation: 'true' },
                  id: 'c046e02a-3e79-4626-b87d-d233c8676d86',
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'process',
          },
        ],
      },
      options: { fallbackOutput: 'none', ignoreCase: false },
    },
    position: [448, 192],
  },
  output: [{ isInboundText: true, phone: '573001112233' }],
});

/** INCR es atómico: el primer webhook recibe 1, los duplicados simultáneos reciben 2+. Evita carrera GET+SET. */
const dedupClaimIncr = node({
  type: 'n8n-nodes-base.redis',
  version: 1,
  config: {
    name: 'Dedup: atomic claim (INCR)',
    parameters: {
      operation: 'incr',
      key: '={{ "ycloud:dedupcnt:" + $json.dedupKey }}',
      expire: true,
      ttl: 3600,
    },
    position: [672, 192],
    credentials: { redis: newCredential('Redis') },
  },
  output: [{ 'ycloud:dedupcnt:msg:573001112233:wamid_x': 1 }],
});

const dedupFirstDeliveryOnly = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Dedup: solo primer intento',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const parse = $(\'Parse YCloud Event\').first().json;\n' +
        'const row = $input.first().json;\n' +
        'const redisKey = \'ycloud:dedupcnt:\' + parse.dedupKey;\n' +
        'const n = Number(row[redisKey]);\n' +
        'if (!Number.isFinite(n) || n !== 1) {\n' +
        '  return [];\n' +
        '}\n' +
        'return [{ json: parse }];\n',
    },
    position: [896, 192],
  },
  output: [
    {
      eventType: 'whatsapp.inbound_message.received',
      phone: '573001112233',
      phoneE164: '+573001112233',
      textContent: 'hola',
      messageType: 'text',
      eventId: 'e1',
      dedupKey: 'msg:573001112233:wamid_x',
      isInboundText: true,
      isInboundOrder: false,
    },
  ],
});

const openAiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'OpenAI gpt-5-mini',
    parameters: {
      model: { __rl: true, value: 'gpt-4.1-mini', mode: 'list', cachedResultName: 'gpt-4.1-mini' },
      options: { maxTokens: 600, temperature: 0.25 },
    },
    credentials: { openAiApi: newCredential('OpenAI') },
    position: [1248, 416],
  },
});

const redisChatMemory = memory({
  type: '@n8n/n8n-nodes-langchain.memoryRedisChat',
  version: 1.5,
  config: {
    name: 'Redis Chat Memory',
    parameters: {
      sessionIdType: 'customKey',
      sessionKey:
        '={{ "fincasya:chat:" + String($json.phoneE164 || $json.phone || "").replace(/\\D/g, "") }}',
      sessionTTL: 86400,
      contextWindowLength: 32,
    },
    credentials: { redis: newCredential('Redis') },
    position: [1440, 480],
  },
});

const searchFincasTool = tool({
  type: 'n8n-nodes-base.httpRequestTool',
  version: 4.4,
  config: {
    name: 'search_fincas',
    parameters: {
      method: 'GET',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/fincas/search',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'q', value: '={{ $fromAI("query", "Texto de búsqueda libre", "string") }}' },
          { name: 'limit', value: '={{ $fromAI("limit", "Cantidad de fincas (1-10)", "number") }}' },
        ],
      },
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 15000 },
      optimizeResponse: true,
    },
    position: [1600, 560],
  },
});

const listPropertiesTool = tool({
  type: 'n8n-nodes-base.httpRequestTool',
  version: 4.4,
  config: {
    name: 'list_properties_by_department',
    parameters: {
      method: 'GET',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/properties-simple/by-department',
      options: { response: { response: { neverError: true, responseFormat: 'text' } }, timeout: 15000 },
      optimizeResponse: true,
      responseType: 'text',
      truncateResponse: true,
      maxLength: 4000,
    },
    position: [1792, 592],
  },
});

const getFincaByCodeTool = tool({
  type: 'n8n-nodes-base.httpRequestTool',
  version: 4.4,
  config: {
    name: 'get_finca_by_code',
    parameters: {
      method: 'GET',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/fincas/code/{{ $fromAI("code", "Código único de la finca", "string") }}',
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 15000 },
      optimizeResponse: true,
    },
    position: [2016, 640],
  },
});

/** Si el usuario respondió a una tarjeta de catálogo, resuelve el nombre de la finca por product_retailer_id. Si no hay referredProductId, el GET devuelve null sin error (neverError: true). */
const resolveRepliedCardHttp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Resolve Replied Card',
    parameters: {
      method: 'GET',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/catalogs/property-by-retailer-id?id={{ encodeURIComponent(String($json.referredProductId || "").trim()) }}',
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 10000 },
    },
    position: [1232, 192],
  },
  // Validator rejects output: [null] ("'json' in null"). Empty API body → use empty shape.
  output: [{ propertyName: '', location: '', productRetailerId: '' }],
});

/**
 * Obtiene los festivos oficiales de Colombia para el año en curso vía Nager.Date (API pública, sin clave).
 * Con neverError: true, si falla la llamada el flujo continúa sin festivos dinámicos;
 * el prompt ya tiene la lista 2026-2027 como fallback.
 */
const fetchColombianHolidaysHttp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Colombian Holidays',
    parameters: {
      method: 'GET',
      url: expr('={{ "https://date.nager.at/api/v3/PublicHolidays/" + new Date().getFullYear() + "/CO" }}'),
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 5000 },
    },
    position: [1344, 192],
  },
  // Array de { date, localName, name } o array vacío si el API falla.
  output: [[{ date: '2026-01-01', localName: 'Año Nuevo', name: "New Year's Day" }]],
});

/**
 * Mezcla:
 * 1) Resultado de Resolve Replied Card → inyecta [TARJETA RESPONDIDA] si aplica.
 * 2) Festivos de Nager.Date ($input) → inyecta [FESTIVOS_CO_YYYY] para que el LLM valide
 *    la regla de mínimo de noches en festivos (Paso 3.5 del prompt).
 */
const injectRepliedCardContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Inject Replied Card Context',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const inbound = $(\'Gate: continue if runBot\').first().json;\n' +
        '// resolved viene del nodo por nombre (no de $input, que ahora es Fetch Colombian Holidays)\n' +
        'const resolved = $(\'Resolve Replied Card\').first().json;\n' +
        '// holidaysRaw es el array JSON de Nager.Date (puede ser [] si el API falló)\n' +
        'const holidaysRaw = $input.first().json;\n' +
        'const holidays = Array.isArray(holidaysRaw) ? holidaysRaw : [];\n' +
        'const propertyName = resolved && resolved.propertyName ? String(resolved.propertyName).trim() : \'\';\n' +
        'const referredProductId = String(inbound.referredProductId || \'\').trim();\n' +
        'let textContent = String(inbound.textContent || \'\');\n' +
        '// 1) Contexto de tarjeta respondida\n' +
        'if (referredProductId && propertyName) {\n' +
        '  textContent = \'[TARJETA RESPONDIDA: el usuario tocó "Responder" en la tarjeta de la finca "\' + propertyName + \'" (product_retailer_id: \' + referredProductId + \'). Tratar como selección de esa finca — NUNCA pedir el nombre.]\\n\' + textContent;\n' +
        '}\n' +
        '// 2) Lista dinámica de festivos para el LLM (Paso 3.5 validación mínimo de noches)\n' +
        'if (holidays.length > 0) {\n' +
        '  const year = new Date().getFullYear();\n' +
        '  const list = holidays\n' +
        '    .filter(function(h) { return h && h.date; })\n' +
        '    .map(function(h) { return String(h.date) + \' (\' + String(h.localName || h.name || \'\') + \')\'; })\n' +
        '    .join(\', \');\n' +
        '  textContent = \'[FESTIVOS_CO_\' + year + \': \' + list + \']\\n\' + textContent;\n' +
        '}\n' +
        'return [{ json: { ...inbound, textContent } }];\n',
    },
    position: [1456, 192],
  },
  output: [{ phone: '573001112233', phoneE164: '+573001112233', textContent: 'hola', referredProductId: '', eventId: 'e1' }],
});

const fincasYaHernanAgent = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'FincasYa Hernan Agent',
    parameters: {
      promptType: 'define',
      text: expr(
        '={{ (() => { const now = new Date(); const yyyy = now.getFullYear(); const mm = String(now.getMonth() + 1).padStart(2, "0"); const dd = String(now.getDate()).padStart(2, "0"); const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]; const mesNombre = meses[now.getMonth()]; return ["=== FECHA ACTUAL ===", "Hoy es " + dd + "/" + mm + "/" + yyyy + " (" + mesNombre + " " + yyyy + "). Mes actual = " + mm + ", año actual = " + yyyy + ".", "REGLA: si el cliente da fechas sin mes (ej. \\"del 15 al 19\\"), asume mes actual " + mm + " (si el día ya pasó este mes, asume mes siguiente). Si da fechas sin año, asume " + yyyy + ".", "", "=== ÚLTIMO MENSAJE DEL CLIENTE (este turno; prioridad sobre el historial) ===", String($json.textContent || "").trim(), "REGLA: si en la línea de arriba ya hay cupo (p. ej. 10 personas), fechas o municipio, no vuelvas a preguntarlos.", "No asumas fechas que el cliente no haya escrito en el historial reciente o en esa línea.", "", "Nombre en WhatsApp: " + String($json.customerName || ""), "Tel: " + String($json.phoneE164 || $json.phone || ""), "Tipo de mensaje: " + String($json.messageType || "text")].join(String.fromCharCode(10)); })() }}',
      ),
      hasOutputParser: false,
      options: {
        systemMessage,
        maxIterations: 3,
      },
    },
    subnodes: {
      model: openAiModel,
      memory: redisChatMemory,
      tools: [searchFincasTool, listPropertiesTool, getFincaByCodeTool],
    },
    position: [1600, 192],
  },
  output: [{ output: '{"action":"text","text":"Hola","catalogLocation":""}' }],
});

const parseAgentJson = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse agent JSON',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: parseAgentJsonJs,
    },
    position: [1760, 192],
  },
  output: [{ action: 'text', text: 'Hola', catalogLocation: '', checkIn: '', checkOut: '', cupo: 0, isEvento: '' }],
});

const mergeAgentWithInbound = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge agent with inbound',
    executeOnce: true,
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: mergeAgentWithInboundJs },
    position: [1904, 192],
  },
  output: [
    {
      phone: '573001112233',
      phoneE164: '+573001112233',
      action: 'text',
      text: 'Hola',
      catalogLocation: '',
      checkIn: '',
      checkOut: '',
      cupo: 0,
      isEvento: '',
      eventId: 'e1',
    },
  ],
});

const dispatchAction = switchCase({
  version: 3.4,
  config: {
    name: 'Dispatch Action',
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  leftValue: '={{ $json.action }}',
                  rightValue: 'catalog',
                  operator: { type: 'string', operation: 'equals' },
                  id: 'cat-1',
                },
                {
                  leftValue: '={{ String($json.catalogLocation || "").trim() }}',
                  rightValue: '',
                  operator: { type: 'string', operation: 'notEmpty', singleValue: true },
                  id: 'cat-2-loc',
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'sendCatalog',
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
              conditions: [
                {
                  leftValue: '={{ $json.action }}',
                  rightValue: 'text',
                  operator: { type: 'string', operation: 'equals' },
                  id: 'txt-1',
                },
              ],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'sendText',
          },
        ],
      },
      options: { fallbackOutput: 'none', ignoreCase: false },
    },
    position: [2416, 176],
  },
});

/** Evita GET al catálogo si un ítem vacío llegara por error a la primera salida del Switch. */
const guardCatalogBranch = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Guard: catalog + location',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const j = $input.first().json;\n' +
        'const loc = String(j.catalogLocation || \'\').trim();\n' +
        'if (String(j.action || \'\').toLowerCase() !== \'catalog\' || !loc) {\n' +
        '  return [];\n' +
        '}\n' +
        'return [{ json: j }];\n',
    },
    position: [2528, 96],
  },
  output: [
    {
      action: 'catalog',
      catalogLocation: 'Villavicencio',
      phoneE164: '+573001112233',
      text: 'Opciones',
    },
  ],
});

const fetchCatalogProducts = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Catalog Products',
    parameters: {
      method: 'GET',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/catalogs/by-location?location={{ encodeURIComponent(String($(\'Merge agent with inbound\').first().json.catalogLocation || "").trim()) }}&fechaEntrada={{ encodeURIComponent(String($(\'Merge agent with inbound\').first().json.checkIn || "").trim()) }}&fechaSalida={{ encodeURIComponent(String($(\'Merge agent with inbound\').first().json.checkOut || "").trim()) }}{{ $(\'Merge agent with inbound\').first().json.cupo && Number($(\'Merge agent with inbound\').first().json.cupo) > 0 ? "&minCapacity=" + encodeURIComponent(String($(\'Merge agent with inbound\').first().json.cupo)) + "&maxCapacity=" + encodeURIComponent(String(Number($(\'Merge agent with inbound\').first().json.cupo) + 10)) : "" }}{{ $(\'Merge agent with inbound\').first().json.isEvento != null && $(\'Merge agent with inbound\').first().json.isEvento !== "" ? "&isEvento=" + encodeURIComponent(String($(\'Merge agent with inbound\').first().json.isEvento)) : "" }}',
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 15000 },
    },
    position: [2640, 192],
  },
  output: [{ catalogId: 'c1', productRetailerIds: ['p1'], productQuoteLines: [''], bodyText: 'Opciones' }],
});

/** Un POST por producto (interactive type product), como Convex sendWhatsAppCatalogList en bucle — evita un solo MPM con "View items". */
const splitCatalogOneProductPerItem = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Split catalog one product per item',
    executeOnce: true,
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'const merge = $(\'Merge agent with inbound\').first().json;\n' +
        'const parse = $(\'Parse YCloud Event\').first().json;\n' +
        'const j = $input.first().json;\n' +
        'const phoneE164 = String(merge.phoneE164 || parse.phoneE164 || \'\').trim();\n' +
        'const cid = String(j.catalogId || \'\').trim();\n' +
        'const ids = Array.isArray(j.productRetailerIds) ? j.productRetailerIds.map(function (x) { return String(x).trim(); }).filter(Boolean) : [];\n' +
        'const quotes = Array.isArray(j.productQuoteLines) ? j.productQuoteLines : [];\n' +
        'let baseBody = String((j.bodyText != null && j.bodyText !== \'\') ? j.bodyText : (merge.text || \'\')).trim();\n' +
        'const loc = String(merge.catalogLocation || \'\').trim();\n' +
        '// Sanitiza el sentinel técnico para que no llegue al cliente.\n' +
        'if (/RECOMENDADAS/.test(baseBody)) {\n' +
        '  baseBody = (loc.toUpperCase() === \'RECOMENDADAS\')\n' +
        '    ? "¡Listo! 🏡 Estas son algunas de nuestras fincas favoritas. ✨"\n' +
        '    : ("¡Perfecto! 🏡 Te muestro algunas opciones" + (loc ? " en " + loc : "") + ". ✨");\n' +
        '}\n' +
        'if (!phoneE164) return [];\n' +
        'if (!cid || ids.length === 0) {\n' +
        '  return [{ json: { _mode: \'text\', phoneE164, textBody: baseBody } }];\n' +
        '}\n' +
        'return ids.map(function (id, idx) {\n' +
        '  let line = \'\';\n' +
        '  if (idx < quotes.length && String(quotes[idx] || \'\').trim()) line = String(quotes[idx]).trim();\n' +
        '  if (!line) line = String(idx + 1) + \'/\' + String(ids.length) + (loc ? \' · \' + loc : \'\');\n' +
        '  let bodyText;\n' +
        '  if (idx === 0) bodyText = line ? (baseBody + \'\\n\\n\' + line) : baseBody;\n' +
        '  else bodyText = line;\n' +
        '  return { json: { _mode: \'product\', phoneE164, catalogId: cid, productRetailerId: id, bodyText: bodyText } };\n' +
        '});\n',
    },
    position: [2752, 192],
  },
  output: [
    {
      _mode: 'product',
      phoneE164: '+573001112233',
      catalogId: 'c1',
      productRetailerId: 'p1',
      bodyText: 'Opciones en Villavicencio',
    },
  ],
});

const sendCatalogViaYCloud = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send Catalog via YCloud',
    parameters: {
      method: 'POST',
      url: 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ (() => {\n' +
          '  const j = $json;\n' +
          '  const to = String(j.phoneE164 || \'\').trim();\n' +
          '  if (j._mode === \'text\') {\n' +
          '    return { from: "+573007984139", to: to, type: "text", text: { body: String(j.textBody || "") } };\n' +
          '  }\n' +
          '  const cid = String(j.catalogId || "");\n' +
          '  const pid = String(j.productRetailerId || "");\n' +
          '  if (!to || !cid || !pid) {\n' +
          '    return { from: "+573007984139", to: to || "+000", type: "text", text: { body: "" } };\n' +
          '  }\n' +
          '  return {\n' +
          '    from: "+573007984139",\n' +
          '    to: to,\n' +
          '    type: "interactive",\n' +
          '    interactive: {\n' +
          '      type: "product",\n' +
          '      body: { text: String(j.bodyText || "") },\n' +
          '      footer: { text: "FincasYa" },\n' +
          '      action: { catalog_id: cid, product_retailer_id: pid },\n' +
          '    },\n' +
          '  };\n' +
          '})() }}',
      ),
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 20000 },
    },
    credentials: { httpHeaderAuth: newCredential('YCloud API') },
    position: [2976, 192],
  },
  output: [{ statusCode: 200 }],
});

/**
 * Persiste en Convex (inbox) cada ficha de catálogo o el texto fallback.
 * Auth: credencial **Header Auth** `FincasYa Log API` (en la credencial: nombre de header = x-n8n-integration-key, valor = N8N_INTEGRATION_KEY de Nest).
 * No añadas x-n8n-integration-key en "Send Headers" del nodo: duplica la cabecera y suele dejarse $env → access denied.
 */
const logOutboundAfterCatalog = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Log outbound (catalog branch)',
    parameters: {
      method: 'POST',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/integrations/n8n/log-outbound-assistant',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ (() => {\n' +
          '  const s = $(\'Split catalog one product per item\').item.json;\n' +
          '  const merge = $(\'Merge agent with inbound\').first().json;\n' +
          '  const parse = $(\'Parse YCloud Event\').first().json;\n' +
          '  const phone = String(merge.phoneE164 || parse.phoneE164 || \'\').trim();\n' +
          '  const name = String(parse.customerName || merge.customerName || \'\').trim();\n' +
          '  if (s._mode === \'text\') {\n' +
          '    return { phone, customerName: name, content: String(s.textBody || \'\'), messageType: \'text\' };\n' +
          '  }\n' +
          '  return {\n' +
          '    phone,\n' +
          '    customerName: name,\n' +
          '    content: String(s.bodyText || \'\'),\n' +
          '    messageType: \'product\',\n' +
          '    metadata: { productRetailerId: String(s.productRetailerId || \'\'), source: \'n8n_whatsapp_catalog\' },\n' +
          '  };\n' +
          '})() }}',
      ),
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 12000 },
    },
    credentials: { httpHeaderAuth: newCredential('FincasYa Log API') },
    position: [3104, 192],
  },
  output: [{ ok: true }],
});

/** Envía el campo `text` del agente como mensaje de WhatsApp ANTES de las fichas de catálogo.
 *  Patrón típico: "Te voy a compartir algunas opciones en <ciudad> 🏡 ¡Mira!".
 *  executeOnce evita que se dispare una vez por cada ítem del split. */
const sendPreCatalogText = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send pre-catalog text',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ (() => {\n' +
          '  const merge = $(\'Merge agent with inbound\').first().json;\n' +
          '  const loc = String(merge.catalogLocation || \'\').trim();\n' +
          '  const isRecomendadas = loc.toUpperCase() === \'RECOMENDADAS\';\n' +
          '  let fallback;\n' +
          '  if (isRecomendadas) {\n' +
          '    fallback = "¡Listo! 🏡 Te voy a compartir algunas de nuestras fincas favoritas para que las revises. ✨";\n' +
          '  } else if (loc) {\n' +
          '    fallback = "¡Perfecto! 🏡 Te voy a compartir algunas opciones en " + loc + " que se ajustan a tu plan. ✨";\n' +
          '  } else {\n' +
          '    fallback = "¡Listo! 🏡 Te voy a compartir algunas opciones para que las revises. ✨";\n' +
          '  }\n' +
          '  let txt = String(merge.text || \'\').trim() || fallback;\n' +
          '  // Sanitiza: si el modelo dejó el sentinel "RECOMENDADAS" en el texto al cliente, sobreescribimos con el fallback amigable.\n' +
          '  if (/RECOMENDADAS/.test(txt)) txt = fallback;\n' +
          '  return {\n' +
          '    "from": "+573007984139",\n' +
          '    "to": merge.phoneE164,\n' +
          '    "type": "text",\n' +
          '    "text": { "body": txt }\n' +
          '  };\n' +
          '})() }}',
      ),
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 20000 },
    },
    credentials: { httpHeaderAuth: newCredential('YCloud API') },
    position: [2528, 288],
  },
  output: [{ statusCode: 200 }],
});

/** Persiste en Convex (inbox) el mensaje pre-catalog que YCloud acaba de enviar. */
const logOutboundPreCatalogText = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Log outbound (pre-catalog text)',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/integrations/n8n/log-outbound-assistant',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ (() => {\n' +
          '  const merge = $(\'Merge agent with inbound\').first().json;\n' +
          '  const parse = $(\'Parse YCloud Event\').first().json;\n' +
          '  const loc = String(merge.catalogLocation || \'\').trim();\n' +
          '  const isRecomendadas = loc.toUpperCase() === \'RECOMENDADAS\';\n' +
          '  let fallback;\n' +
          '  if (isRecomendadas) {\n' +
          '    fallback = "¡Listo! 🏡 Te voy a compartir algunas de nuestras fincas favoritas para que las revises. ✨";\n' +
          '  } else if (loc) {\n' +
          '    fallback = "¡Perfecto! 🏡 Te voy a compartir algunas opciones en " + loc + " que se ajustan a tu plan. ✨";\n' +
          '  } else {\n' +
          '    fallback = "¡Listo! 🏡 Te voy a compartir algunas opciones para que las revises. ✨";\n' +
          '  }\n' +
          '  let txt = String(merge.text || \'\').trim() || fallback;\n' +
          '  if (/RECOMENDADAS/.test(txt)) txt = fallback;\n' +
          '  return {\n' +
          '    phone: String(merge.phoneE164 || parse.phoneE164 || \'\').trim(),\n' +
          '    customerName: String(parse.customerName || merge.customerName || \'\').trim(),\n' +
          '    content: txt,\n' +
          '    messageType: \'text\',\n' +
          '  };\n' +
          '})() }}',
      ),
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 12000 },
    },
    credentials: { httpHeaderAuth: newCredential('FincasYa Log API') },
    position: [2640, 288],
  },
  output: [{ ok: true }],
});

const sendTextViaYCloud = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Send Text via YCloud',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ {\n' +
          '  "from": "+573007984139",\n' +
          '  "to": $json.phoneE164,\n' +
          '  "type": "text",\n' +
          '  "text": { "body": $json.text }\n' +
          '} }}',
      ),
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 20000 },
    },
    credentials: { httpHeaderAuth: newCredential('YCloud API') },
    position: [2640, 384],
  },
  output: [{ statusCode: 200 }],
});

const logOutboundAfterText = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Log outbound (text branch)',
    executeOnce: true,
    parameters: {
      method: 'POST',
      url: '=https://62q8s3xq-3001.use2.devtunnels.ms/api/integrations/n8n/log-outbound-assistant',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '={{ (() => {\n' +
          '  const merge = $(\'Merge agent with inbound\').first().json;\n' +
          '  const parse = $(\'Parse YCloud Event\').first().json;\n' +
          '  return {\n' +
          '    phone: String(merge.phoneE164 || parse.phoneE164 || \'\').trim(),\n' +
          '    customerName: String(parse.customerName || merge.customerName || \'\').trim(),\n' +
          '    content: String(merge.text || \'\'),\n' +
          '    messageType: \'text\',\n' +
          '  };\n' +
          '})() }}',
      ),
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 12000 },
    },
    credentials: { httpHeaderAuth: newCredential('FincasYa Log API') },
    position: [2768, 384],
  },
  output: [{ ok: true }],
});

const processInboundFromParse = parseYCloudEvent
  .to(logInboundUserAfterParse)
  .to(restoreParseOutputAfterInboundLog)
  .to(routeMessageKind)
  .to(dedupClaimIncr)
  .to(dedupFirstDeliveryOnly)
  .to(gateShouldBotReplyHttp)
  .to(gateBotContinueIfRunBot)
  .to(resolveRepliedCardHttp)
  .to(fetchColombianHolidaysHttp)
  .to(injectRepliedCardContext)
  .to(fincasYaHernanAgent)
  .to(parseAgentJson)
  .to(mergeAgentWithInbound)
  .to(
    dispatchAction
      .onCase(
        0,
        guardCatalogBranch
          .to(
            sendPreCatalogText.to(
              logOutboundPreCatalogText.to(
                fetchCatalogProducts
                  .to(splitCatalogOneProductPerItem)
                  .to(sendCatalogViaYCloud.to(logOutboundAfterCatalog)),
              ),
            ),
          ),
      )
      .onCase(1, sendTextViaYCloud.to(logOutboundAfterText)),
  );

export default workflow('Exk76XIgxMV32ha9', 'FincasYa - YCloud Inbound Bot (n8n v4)')
  .add(ycloudInboundWebhook)
  .to(ycloudEntryRouter)
  .to(
    routeYCloudEntry
      .onCase(0, markHumanHandoffHttp)
      .onCase(1, reshapeWebhookForParse.to(processInboundFromParse)),
  );
