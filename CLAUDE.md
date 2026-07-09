# FincasYa — Bot WhatsApp/Web (Convex + NestJS)

Plataforma colombiana de alquiler de fincas. El core es un **bot FSM** que atiende
WhatsApp (vía YCloud) y el widget web, automatizando de la bienvenida al contrato.
Backend: **Convex** (`convex/`) + **NestJS** REST (`src/`). Runtime: **Bun**.

> Memoria extendida con el changelog completo: `~/Documents/AI-memory/02_Projects/FincasYa/fincasya-new.md`

---

## Comandos esenciales

```bash
bunx tsc --noEmit -p convex          # typecheck (DEBE pasar antes de terminar)
bunx eslint convex/lib/...           # lint los archivos tocados
bunx convex run knowledge:seedFaqEntries   # re-sembrar FAQs al RAG tras editarlas
```

- **Hay que DESPLEGAR Convex** para que cualquier cambio tome efecto. Si el usuario
  prueba el bot y "no cambió nada", casi siempre es que falta desplegar.
- `inbound.ts` tiene un **baseline pre-existente de errores ESLint** (`deps: any`,
  `no-unsafe-*`). NO son tuyos — usa el mismo patrón que ya existe; cuenta "formas
  nuevas", no el total.

---

## Reglas de oro (lo que más duele si se pierde)

1. **Nunca reenviar bloques estáticos repetidos.** Todo texto fijo en `replies.ts`
   pasa por `respond()` / `wasJustSent()`; si ya se envió hace ≤3 turnos, cae al LLM
   contextual. Esto evita que el bot mande el mismo párrafo dos veces.
2. **Todo LLM call usa `buildContextSystemPrompt`.** No llames `openai()` con un
   system mínimo — eso causó alucinaciones. Pasa por `contextualLlmReply()`.
3. **CUIDADO con "un asesor te &lt;verbo&gt;" en cualquier copy.** El detector
   `botPromisedHandoff` (inbound.ts) lo interpreta como promesa de handoff y ESCALA.
   Si un copy debe mencionar un asesor sin escalar, usa 1ª persona plural
   ("te respondemos"). (Bug real: el `AFTER_HOURS_NOTICE` se auto-escalaba.)
4. **OpenAI sin cupo = causa #1 de "Perdona, tuve un problema técnico".** Si el
   extractor devuelve `{}` Y `contextualLlmReply` falla a la vez, NO es bug de
   código: revisa platform.openai.com/billing. El error real queda en los logs
   (`[extractor] generateText falló`).
5. **El extractor usa `gpt-4.1-mini`** (NO subir a gpt-4.1 — más lento, riesgo de
   timeout, no extrae mejor). Las mejoras de "inteligencia" vienen de la lógica
   determinística (regex/FSM/filtros), no del modelo.
6. **"la IA debe interpretar, no enumerar respuestas"** (insistencia del equipo).
   Para intención del cliente, prefiere un campo del extractor LLM + regex como
   red de seguridad. No enumeres cada fraseo posible.
7. **Copys oficiales verbatim.** Las FAQs y mensajes los da el equipo; úsalos tal
   cual. Fuente única: `convex/lib/faqSeed.ts` (`FAQ_INITIAL_SEED` + fallback
   `localFaqFallback` quemado por si el RAG cae).

---

## Arquitectura del bot (`convex/lib/bot/`)

- **FSM estricto**: `welcome → collecting → catalog_sent → pet_check →
  pet_rules_shown → quote_shown → contract → done`. Transiciones siempre adelante.
- `index.ts` = orquestador `runBotTurn`. `extractor.ts` = extrae entidades (LLM).
  `transitions.ts` = FSM puro (sin LLM). `replies.ts` = genera respuesta.
  `prompts.ts` = system prompts. `entities.ts` = merge/normalización.
- **Pipeline de entrada**: `convex/lib/ycloud/inbound.ts` `processInboundMessageV2`.
  Entry points: `convex/ycloud.ts` (WhatsApp) y `convex/webChat.ts` (widget,
  pasa `channel:"web"`).

### Dos carriles de escalación (≠)
- `conversations.escalate` — **DURA**: setea `status='human'`, **apaga el bot**.
  Para emergencia, propietario, reserva activa, contrato completo, queja.
- `conversations.flagPriorityAlert` — **BLANDA**: tag + priority + system message,
  **el bot sigue conversando**. Idempotente vía `botSessions.firedAlerts`. Para
  estadía larga, intención de cierre, cliente recurrente.

### Canal (identidad)
- `channel === "web"` → bot se presenta como **"asistente virtual de FincasYa"**.
- WhatsApp (default) → **"Hernán"**. Ver `buildWelcomeMessage`/`identityForChannel`.

### Clasificador multifuncional (inbound, antes del FSM)
Emergencia (regex, 24/7) · propietario · cliente con reserva activa
(`bookings.findActiveOrUpcomingByGuestPhone`) · intención de cierre · estadía larga
(3+ noches) · cliente recurrente (`findRecentCommercialByPhone`, ventana 90d, desde
`catalog_sent`) · fuera de horario (`businessHours.ts`).

---

## Catálogo (`convex/whatsappCatalogs.ts` `getPayloadByLocationForN8n`)

Hay **1 solo catálogo** (`catalogo_web`, default) con todas las fincas. El filtro de
`matchesLocation` es **OR** de:
1. **Municipio exacto** (`location.includes`).
2. **Tag `cerca-a-<municipio>`** — finca de otra zona marcada cercana (panel).
3. **Expansión por departamento** — pedir Melgar trae todo Tolima
   (`expandLocationKeywords` + `expandDepartmentCodes`, mapeo en `REGIONS` +
   `REGION_TO_DEPT_CODE` en inbound.ts). Sube el cap a 25.
4. **Colecciones/categorías** (`categoryMatch`, híbrido tag+ubicación+atributo):
   playa, lujo, eje cafetero, eventos — ver `CATEGORY_COLLECTIONS` en inbound.ts.

- **Sort**: Tier 0 = municipio exacto primero, luego favoritas, luego proximidad
  al cupo, luego precio.
- `visibleInWhatsAppCatalog === false` → finca EXCLUIDA del bot (no se envía ni se
  puede reservar por nombre). La resolución por nombre (`findPropertyByNameForBot`)
  lo respeta y usa matching por tokens DISTINTIVOS (ignora casa/villa/luxury/ciudad).
- **Honestidad**: si piden una ciudad sin inventario, el bot lo dice y ofrece
  cercanas (no finge tener opciones ahí).

---

## Playbook de tono (`convex/lib/playbookSeed.ts` + namespace RAG `"playbook"`)

Few-shot dinámico para que el bot hable como el equipo (no solo el párrafo
estático `IDENTITY` "Tono: cálido"). En cada turno, `searchPlaybookForBot`
recupera 1-2 ejemplos reales (situación → respuesta modelo) parecidos al mensaje
del cliente y los inyecta como `playbookContext` en el system prompt.

- **Reusa la MISMA instancia RAG** (`text-embedding-3-small`) con namespace
  `"playbook"` — NO toca el namespace `"faq"`.
- Se **embebe la situación + frases del cliente** (para el match); la respuesta
  modelo viaja en `metadata` (no se embebe → no sesga el match).
- **Filtro por fase**: solo recupera ejemplos de la MISMA fase del FSM (relleno
  con `phase:"any"`); descarta otras fases → no contamina el flujo.
- **El FSM manda el flujo; los ejemplos solo colorean el fraseo.** El prompt lo
  enmarca: imita el TONO, NO copies datos (precios/fechas), NO cambies el flujo.
  Los datos duros siguen viniendo de catálogo/FAQ/cotización, nunca del ejemplo.
- Carril: `inbound.ts → index.ts → replies.ts → prompts.ts` (calca `faqContext`).
- **Curación** (al añadir chats reales): anonimizar (sin tel/cédula/nombres), sin
  cifras de precio, NUNCA "un asesor te &lt;verbo&gt;", etiquetar `phase`.
- Re-sembrar tras editar: `bunx convex run knowledge:seedPlaybookEntries`.

---

## Gotchas

- **Fechas pasadas**: `transitions.ts` bloquea con `datesInPast` antes de cotizar.
  Si el cliente nombra el mes ("19 al 21 de mayo"), el extractor respeta ese mes
  aunque ya pasó — el filtro avisa después.
- **"pt"/"pte" = "puente"** en `detectPuenteReference` (cliente abrevia).
- **"No" suelto en pet_check** = `hasPets:false` (no re-preguntar).
- **Frases "pointing"** ("la de Girardot 2", "la primera") NO son cambio de zona —
  no re-disparar catálogo (POINTING_REGEX en index.ts + instrucción en extractor).
- **Auto-CRM**: el contacto se enriquece solo con datos del contrato
  (`upsertFromContractData`, conservador) y se etiqueta con el deal
  (`setLeadDealLabel`: "Nombre · Finca · Npax · fechas").
- **NUNCA backticks dentro del template literal del prompt del extractor** — rompen
  el string. Usa comillas dobles.

---

## Pendientes conocidos (🟡)

- Link público para auto-diligenciar el contrato (`/contrato/[token]`).
- Fix `audio/x-m4a` → `audio/mp4` al enviar audios desde el panel (#131053).
- Configurar `URGENT_ALERTS_WEBHOOK_URL` (Slack/n8n) para alertas urgentes.
- Lookup phone→propietario contra `users` (requiere `users.phone` indexado).
- UI de tags en el front FincasYaWeb (otro repo).

---

## Env vars

Obligatorias: `OPENAI_API_KEY`, `YCLOUD_API_KEY`, `YCLOUD_WABA_NUMBER`.
Opcionales: `META_CATALOG_ID`, `CHATBOT_AUTO_ASSIGN_ADVISOR_ID`,
`BUSINESS_HOURS_START/_END/_DAYS/_TZ` (default Lun-Sáb 8-18 Bogotá),
`URGENT_ALERTS_WEBHOOK_URL`.

---

## Estilo

- TypeScript estricto, sin `any` sin justificación. Bun (no npm/yarn).
- Convex: queries/mutations/actions con modelo reactivo (no REST clásico).
- n8n está **DEPRECADO** — todo flujo nuevo va por `convex/lib/bot/`.
- El equipo (Santiago/Adriana) es exigente: código correcto al primer intento,
  sin parches. Validar `tsc` + lint antes de decir "listo".
