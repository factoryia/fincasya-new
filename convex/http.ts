import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './betterAuth/auth';
import { api, internal } from './_generated/api';
import { parseWorkbookSheetsToPayloads } from './lib/whatsappTemplateSheet';
import {
  isOutboundFromBusiness,
  normalizeWhatsappPhone,
  parseYcloudWhatsappBody,
  isCatalogInteractiveEcho,
} from './lib/ycloud/parseMessage';

const YCLOUD_TEMPLATES_BASE = 'https://api.ycloud.com/v2/whatsapp/templates';

function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Solo para POST (crear / importar). El GET de listado es público y usa la clave en el servidor. */
function requireYCloudApiKey(request: Request): Response | null {
  const expected = process.env.YCLOUD_API_KEY;
  if (!expected) {
    return jsonResponse(
      { error: 'YCLOUD_API_KEY no está configurada en Convex' },
      503,
    );
  }
  const provided = request.headers.get('X-API-Key');
  if (provided !== expected) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return null;
}

/**
 * Proxys Next.js / Nest (`X-API-Key` = CONVEX_ADMIN_API_KEY).
 * Acepta la clave admin dedicada o YCLOUD_API_KEY (mismo valor en muchos entornos).
 */
function requireConvexSiteApiKey(request: Request): Response | null {
  const keys = [
    process.env.CONVEX_ADMIN_API_KEY,
    process.env.YCLOUD_API_KEY,
  ].filter((k): k is string => typeof k === 'string' && k.length > 0);

  if (keys.length === 0) {
    return jsonResponse(
      {
        error:
          'Configura CONVEX_ADMIN_API_KEY o YCLOUD_API_KEY en Convex (mismo valor que en el servidor Next.js)',
      },
      503,
    );
  }

  const provided = request.headers.get('X-API-Key');
  if (!provided || !keys.includes(provided)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return null;
}

const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

// Webhook YCloud: recibe mensajes entrantes de WhatsApp
// URL en YCloud: https://<tu-deployment>.convex.site/webhooks/ycloud
http.route({
  path: '/webhooks/ycloud',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsed = body as {
      type?: string;
      id?: string;
      whatsappInboundMessage?: {
        id?: string;
        wamid?: string;
        from?: string;
        customerProfile?: { name?: string };
        /** Mensaje citado (reply): id del mensaje al que responde el cliente (p. ej. ficha de catálogo). */
        context?: { from?: string; id?: string };
        type?: string;
        text?: { body?: string };
        image?: { link?: string; caption?: string };
        audio?: { link?: string };
        video?: { link?: string; caption?: string };
        document?: { link?: string; caption?: string; filename?: string };
        order?: {
          catalog_id?: string;
          product_items?: Array<{
            product_retailer_id?: string;
            quantity?: number;
            item_price?: number;
            currency?: string;
          }>;
          text?: string;
        };
      };
      direction?: string;
    };

    if (
      parsed.type === 'whatsapp.inbound_message.received' &&
      parsed.whatsappInboundMessage
    ) {
      const evt = parsed.whatsappInboundMessage;
      const eventId = parsed.id ?? `evt_${Date.now()}`;
      const phoneRaw = evt.from ?? '';
      const phone = normalizeWhatsappPhone(phoneRaw);
      const name = (evt.customerProfile?.name ?? '').trim() || phoneRaw;
      const wamid = evt.wamid ?? evt.id;
      const replyToWamid =
        typeof evt.context?.id === "string" && evt.context.id.trim().length > 6
          ? evt.context.id.trim()
          : undefined;

      const parsedMsg = parseYcloudWhatsappBody(evt);
      const content = parsedMsg?.content ?? '';
      const msgType = parsedMsg?.msgType ?? 'text';
      const mediaUrl = parsedMsg?.mediaUrl ?? '';

      const normalizedContent = String(content || "").trim();
      const isSystemPresenceNoise =
        /^status\s*:\s*active$/i.test(normalizedContent) ||
        /^presence\s*:\s*active$/i.test(normalizedContent);

      if (phone && (content || mediaUrl) && !isSystemPresenceNoise) {
        const dedupe = await ctx.runMutation(
          internal.ycloud.recordProcessedEvent,
          { eventId },
        );
        if (dedupe.duplicate) {
          console.log('YCloud: evento duplicado, skip', { eventId, phone });
        } else {
          await ctx.runMutation(internal.ycloud.persistInboundFromWebhook, {
            phone,
            customerName: name,
            content: normalizedContent || content,
            messageType: msgType,
            mediaUrl: mediaUrl || undefined,
            wamid,
            replyToWamid,
          });
          await ctx.runAction(internal.ycloud.processInboundMessage, {
            eventId,
            phone,
            name,
            text: content,
            wamid,
            replyToWamid,
            type: msgType,
            mediaUrl: mediaUrl || undefined,
          });
        }
      } else if (phone && isSystemPresenceNoise) {
        console.log("YCloud: mensaje de presencia ignorado", {
          eventId,
          phone,
          content: normalizedContent,
        });
      } else if (phoneRaw && !phone) {
        console.warn('YCloud: teléfono inválido en inbound', {
          eventId,
          from: phoneRaw,
        });
      } else if (phone && !normalizedContent && !mediaUrl) {
        console.warn('YCloud: inbound sin contenido parseable', {
          eventId,
          phone,
          rawType: evt.type,
        });
      }
    }

    // Mensaje saliente (WhatsApp Business app, YCloud inbox, etc.) → guardar en inbox.
    const outboundEvt = body as {
      id?: string;
      type?: string;
      whatsappOutboundMessage?: {
        id?: string;
        wamid?: string;
        to?: string;
        from?: string;
        type?: string;
        customerProfile?: { name?: string };
        text?: { body?: string };
        image?: { link?: string; caption?: string };
        audio?: { link?: string };
        video?: { link?: string; caption?: string };
        document?: { link?: string; caption?: string; filename?: string };
      };
    };
    if (
      outboundEvt.type === 'whatsapp.outbound_message.sent' &&
      outboundEvt.whatsappOutboundMessage
    ) {
      const evt = outboundEvt.whatsappOutboundMessage;
      const phone = normalizeWhatsappPhone(evt.to ?? '');
      if (phone && !isCatalogInteractiveEcho(evt)) {
        const parsedMsg = parseYcloudWhatsappBody(evt);
        if (parsedMsg) {
          const eventId =
            outboundEvt.id ??
            `out_${evt.wamid ?? evt.id ?? `${phone}_${Date.now()}`}`;
          const dedupe = await ctx.runMutation(
            internal.ycloud.recordProcessedEvent,
            { eventId },
          );
          if (!dedupe.duplicate) {
            await ctx.runMutation(internal.ycloud.recordOutboundFromWebhook, {
              phone,
              customerName: evt.customerProfile?.name,
              content: parsedMsg.content,
              messageType: parsedMsg.msgType,
              mediaUrl: parsedMsg.mediaUrl,
              wamid: evt.wamid ?? evt.id,
              whatsappStatus: 'sent',
            });
          }
        } else {
          await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
        }
      }
    }

    // Mensaje escrito por el DUEÑO desde la app de WhatsApp Business (coexistencia/SMB).
    // YCloud lo reporta como `whatsapp.smb.message.echoes` (no como outbound_message.sent).
    const smbEchoEvt = body as {
      id?: string;
      type?: string;
      whatsappMessage?: {
        id?: string;
        wamid?: string;
        status?: string;
        from?: string;
        to?: string;
        type?: string;
        customerProfile?: { name?: string; username?: string };
        text?: { body?: string };
        image?: { link?: string; caption?: string };
        audio?: { link?: string };
        video?: { link?: string; caption?: string };
        document?: { link?: string; caption?: string; filename?: string };
      };
    };
    if (
      smbEchoEvt.type === 'whatsapp.smb.message.echoes' &&
      smbEchoEvt.whatsappMessage
    ) {
      const evt = smbEchoEvt.whatsappMessage;
      const phone = normalizeWhatsappPhone(evt.to ?? '');
      if (phone && !isCatalogInteractiveEcho(evt)) {
        const parsedMsg = parseYcloudWhatsappBody(evt);
        if (parsedMsg) {
          const eventId =
            smbEchoEvt.id ??
            `smb_${evt.wamid ?? evt.id ?? `${phone}_${Date.now()}`}`;
          const dedupe = await ctx.runMutation(
            internal.ycloud.recordProcessedEvent,
            { eventId },
          );
          if (!dedupe.duplicate) {
            await ctx.runMutation(internal.ycloud.recordOutboundFromWebhook, {
              phone,
              customerName:
                evt.customerProfile?.name ?? evt.customerProfile?.username,
              content: parsedMsg.content,
              messageType: parsedMsg.msgType,
              mediaUrl: parsedMsg.mediaUrl,
              wamid: evt.wamid ?? evt.id,
              whatsappStatus: 'sent',
            });
          }
        } else {
          await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
        }
      }
    }

    // Estado de entrega/lectura (palomitas) + backfill si el mensaje salió fuera del inbox.
    const statusEvt = body as {
      id?: string;
      type?: string;
      whatsappMessage?: {
        wamid?: string;
        id?: string;
        status?: string;
        from?: string;
        to?: string;
        type?: string;
        customerProfile?: { name?: string };
        text?: { body?: string };
        image?: { link?: string; caption?: string };
        audio?: { link?: string };
        video?: { link?: string; caption?: string };
        document?: { link?: string; caption?: string; filename?: string };
      };
    };
    if (statusEvt.type === 'whatsapp.message.updated' && statusEvt.whatsappMessage) {
      const wm = statusEvt.whatsappMessage;
      const wamid = (wm.wamid ?? wm.id ?? '').trim();
      const rawStatus = String(wm.status ?? '').toLowerCase();
      if (
        wamid.length > 6 &&
        (rawStatus === 'failed' ||
          rawStatus === 'accepted' ||
          rawStatus === 'sent' ||
          rawStatus === 'delivered' ||
          rawStatus === 'read')
      ) {
        const statusUpdate = await ctx.runMutation(
          internal.messages.updateWhatsappStatusByWamid,
          {
            wamid,
            status: rawStatus,
          },
        );
        if (
          !statusUpdate.updated &&
          (rawStatus === 'sent' || rawStatus === 'accepted') &&
          isOutboundFromBusiness(wm.from, process.env.YCLOUD_WABA_NUMBER)
        ) {
          const phone = normalizeWhatsappPhone(wm.to ?? '');
          if (phone && !isCatalogInteractiveEcho(wm)) {
            const parsedMsg = parseYcloudWhatsappBody(wm);
            if (parsedMsg) {
              await ctx.runMutation(internal.ycloud.recordOutboundFromWebhook, {
                phone,
                customerName: wm.customerProfile?.name,
                content: parsedMsg.content,
                messageType: parsedMsg.msgType,
                mediaUrl: parsedMsg.mediaUrl,
                wamid,
                whatsappStatus:
                  rawStatus === 'accepted' ? 'accepted' : 'sent',
              });
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        receivedAt: new Date().toISOString(),
        message: 'Webhook recibido correctamente',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }),
});

// GET para verificar que el webhook está activo
http.route({
  path: '/webhooks/ycloud',
  method: 'GET',
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({
        message: 'Webhook YCloud activo',
        webhookUrl: 'POST a esta misma URL con el body de YCloud',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }),
});

/**
 * Listar plantillas WhatsApp (proxy YCloud). Sin auth en el cliente: la API key solo vive en Convex.
 */
http.route({
  path: '/api/ycloud/templates',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey) {
      return jsonResponse(
        { error: 'YCLOUD_API_KEY no está configurada en Convex' },
        503,
      );
    }

    const url = new URL(request.url);
    const qs = url.searchParams.toString();
    const target = qs
      ? `${YCLOUD_TEMPLATES_BASE}?${qs}`
      : YCLOUD_TEMPLATES_BASE;

    const res = await fetch(target, {
      headers: { 'X-API-Key': apiKey },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      },
    });
  }),
});

/**
 * Crear una plantilla (body JSON YCloud). Requiere X-API-Key = YCLOUD_API_KEY.
 */
http.route({
  path: '/api/ycloud/templates',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    const apiKey = process.env.YCLOUD_API_KEY!;
    const body = await request.text();

    const res = await fetch(YCLOUD_TEMPLATES_BASE, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      },
    });
  }),
});

/**
 * Importar .xlsx (cada hoja = plantilla). Requiere X-API-Key.
 */
http.route({
  path: '/api/ycloud/templates/import',
  method: 'POST',
  handler: httpAction(async (_ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    const apiKey = process.env.YCLOUD_API_KEY!;
    const defaultWabaId = process.env.YCLOUD_WABA_ID?.trim();

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonResponse(
        { error: 'Body esperado: multipart/form-data con el archivo' },
        400,
      );
    }

    const file =
      (formData.get('file') as File | null) ??
      (formData.get('documento') as File | null);
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonResponse(
        { error: 'Adjunta el Excel en el campo file (o documento)' },
        400,
      );
    }

    const name = (file).name?.toLowerCase() ?? '';
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return jsonResponse(
        { error: 'Solo se admiten archivos .xlsx o .xls' },
        400,
      );
    }

    const buffer = await file.arrayBuffer();
    const parsed = parseWorkbookSheetsToPayloads(buffer, defaultWabaId);
    if (parsed.length === 0) {
      return jsonResponse(
        {
          error:
            'No hay hojas importables (usa hojas con nombre que no empiece por _ y con body/texto)',
        },
        400,
      );
    }

    const results: Array<{
      sheet: string;
      name?: string;
      ok: boolean;
      status?: number;
      ycloud?: unknown;
      error?: string;
    }> = [];

    for (const item of parsed) {
      if (!item.ok) {
        results.push({
          sheet: item.sheet,
          ok: false,
          error: (item as any).error,
        });
        continue;
      }

      const payload = item.payload;
      const res = await fetch(YCLOUD_TEMPLATES_BASE, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let ycloudJson: unknown;
      try {
        ycloudJson = JSON.parse(text);
      } catch {
        ycloudJson = { raw: text };
      }

      results.push({
        sheet: item.sheet,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        ok: res.ok,
        status: res.status,
        ycloud: ycloudJson,
        error: res.ok ? undefined : 'YCloud rechazó la plantilla',
      });
    }

    const allOk = results.every((r) => r.ok);
    return jsonResponse({ ok: allOk, results }, 200);
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints REST para el panel admin de Base de Conocimiento (RAG).
//
// Protegidos con `X-API-Key` (la misma key del resto del admin). Las routes
// Next.js del front (FincasYaWeb/app/api/knowledge/*) proxean aquí con la key
// guardada como env del servidor — nunca expuesta al navegador.
//
// Patrón idéntico al de `/api/ycloud/templates`.
// ─────────────────────────────────────────────────────────────────────────────

/** Lista entradas (paginado). */
http.route({
  path: '/api/knowledge/list',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const namespace = (url.searchParams.get('namespace') ?? 'fincas').trim();
    const category = url.searchParams.get('category')?.trim() || undefined;
    const cursor = url.searchParams.get('cursor');
    const numItemsRaw = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const numItems = Number.isFinite(numItemsRaw)
      ? Math.min(Math.max(numItemsRaw, 1), 100)
      : 20;

    const result = await ctx.runQuery(internal.knowledge.listForAdmin, {
      namespace,
      category,
      paginationOpts: {
        numItems,
        cursor: cursor ?? null,
      },
    });

    return jsonResponse(result, 200);
  }),
});

/** Contenido indexado de una entrada (chunks unidos) + enlace al archivo si aplica. */
http.route({
  path: '/api/knowledge/entry',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const entryId = url.searchParams.get('entryId')?.trim();
    const namespace = (url.searchParams.get('namespace') ?? 'fincas').trim();
    if (!entryId) {
      return jsonResponse({ error: '`entryId` requerido' }, 400);
    }

    const data = await ctx.runQuery(
      internal.knowledge.getEntryContentForAdmin,
      {
        namespace,
        entryId: entryId as never,
      },
    );
    if (!data) {
      return jsonResponse({ error: 'Entrada no encontrada' }, 404);
    }
    return jsonResponse(data, 200);
  }),
});

/** Sube un archivo (multipart/form-data) al RAG. */
http.route({
  path: '/api/knowledge/upload',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonResponse(
        { error: 'Body esperado: multipart/form-data con el archivo' },
        400,
      );
    }

    const file = formData.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return jsonResponse(
        { error: 'Adjunta el archivo en el campo "file"' },
        400,
      );
    }

    const namespace = String(formData.get('namespace') ?? 'fincas').trim() || 'fincas';
    const category = String(formData.get('category') ?? '').trim() || undefined;
    const uploadedBy = String(formData.get('uploadedBy') ?? '').trim() || undefined;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    // base64 sin Node Buffer: chunked para no reventar string size en archivos grandes.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const bytesBase64 = btoa(binary);

    const result = await ctx.runAction(internal.knowledge.addFileForAdmin, {
      filename: (file as File).name,
      mimeType: (file as File).type || 'application/octet-stream',
      bytesBase64,
      category,
      namespace,
      uploadedBy,
    });

    return jsonResponse(result, 200);
  }),
});

/** Añade texto plano al RAG. */
http.route({
  path: '/api/knowledge/text',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    let body: {
      title?: string;
      text?: string;
      category?: string;
      namespace?: string;
      key?: string;
      uploadedBy?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    const title = String(body?.title ?? '').trim();
    const text = String(body?.text ?? '').trim();
    if (!title || !text) {
      return jsonResponse(
        { error: 'Se requieren `title` y `text`' },
        400,
      );
    }
    const namespace = String(body?.namespace ?? 'fincas').trim() || 'fincas';
    const category = String(body?.category ?? '').trim() || undefined;
    const key = body?.key?.trim() || undefined;
    const uploadedBy = body?.uploadedBy?.trim() || undefined;

    const result = await ctx.runAction(internal.knowledge.addTextForAdmin, {
      title,
      text,
      category,
      namespace,
      key,
      uploadedBy,
    });

    return jsonResponse(result, 200);
  }),
});

/** Elimina una entrada del RAG. */
http.route({
  path: '/api/knowledge/delete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    let body: { entryId?: string; namespace?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    const entryId = String(body?.entryId ?? '').trim();
    const namespace = String(body?.namespace ?? 'fincas').trim() || 'fincas';
    if (!entryId) {
      return jsonResponse({ error: '`entryId` requerido' }, 400);
    }

    await ctx.runAction(internal.knowledge.deleteForAdmin, {
      entryId: entryId as never, // tipo `EntryId` viene del componente RAG; passthrough.
      namespace,
    });

    return jsonResponse({ ok: true }, 200);
  }),
});

/** Estado de un job de procesamiento (poll). */
http.route({
  path: '/api/knowledge/job',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId')?.trim();
    if (!jobId) {
      return jsonResponse({ error: '`jobId` requerido' }, 400);
    }

    const status = await ctx.runQuery(internal.knowledge.getJobStatusForAdmin, {
      jobId: jobId as never,
    });

    // `exists: true` significa el job aún está en cola = procesando.
    // `exists: false` significa el job ya terminó (procesó y se borró el registro).
    return jsonResponse(
      { jobId, status: status.exists ? 'processing' : 'ready' },
      200,
    );
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints REST del PLAYBOOK DE TONO (módulo de entrenamiento del bot).
// Mismo patrón que la Base de Conocimiento: X-API-Key, proxeado por el front
// (FincasYaWeb/app/api/playbook/*). Lógica en `convex/playbook.ts`.
// ─────────────────────────────────────────────────────────────────────────────

/** Lista todos los ejemplos del playbook (habilitados primero). */
http.route({
  path: '/api/playbook/list',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    const items = await ctx.runQuery(internal.playbook.listForAdmin, {});
    return jsonResponse({ items }, 200);
  }),
});

/** Crea o edita un ejemplo (por `key`) y lo sincroniza al RAG. */
http.route({
  path: '/api/playbook/upsert',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    let body: {
      key?: string;
      phase?: string;
      situation?: string;
      clientExamples?: unknown;
      response?: string;
      tags?: unknown;
      enabled?: boolean;
      source?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    const situation = String(body?.situation ?? '').trim();
    const response = String(body?.response ?? '').trim();
    if (!situation || !response) {
      return jsonResponse(
        { error: 'Se requieren `situation` y `response`' },
        400,
      );
    }
    const toStringArray = (val: unknown): string[] =>
      Array.isArray(val)
        ? val.map((x) => String(x ?? '').trim()).filter(Boolean)
        : [];

    const result = await ctx.runAction(internal.playbook.upsertForAdmin, {
      key: body?.key?.trim() || undefined,
      phase: String(body?.phase ?? 'any').trim() || 'any',
      situation,
      clientExamples: toStringArray(body?.clientExamples),
      response,
      tags: toStringArray(body?.tags),
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
      source: body?.source?.trim() || undefined,
    });
    return jsonResponse(result, 200);
  }),
});

/** Borra un ejemplo (tabla + RAG). */
http.route({
  path: '/api/playbook/delete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    let body: { key?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }
    const key = String(body?.key ?? '').trim();
    if (!key) return jsonResponse({ error: '`key` requerido' }, 400);
    await ctx.runAction(internal.playbook.deleteForAdmin, { key });
    return jsonResponse({ ok: true }, 200);
  }),
});

/** Habilita/deshabilita un ejemplo (deshabilitado = fuera del índice). */
http.route({
  path: '/api/playbook/enabled',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    let body: { key?: string; enabled?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }
    const key = String(body?.key ?? '').trim();
    if (!key) return jsonResponse({ error: '`key` requerido' }, 400);
    if (typeof body?.enabled !== 'boolean') {
      return jsonResponse({ error: '`enabled` (boolean) requerido' }, 400);
    }
    const result = await ctx.runAction(internal.playbook.setEnabledForAdmin, {
      key,
      enabled: body.enabled,
    });
    return jsonResponse(result, 200);
  }),
});

/** Lista/busca conversaciones reales para el selector de entrenamiento. */
http.route({
  path: '/api/playbook/conversations',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim() || undefined;
    const cursor = url.searchParams.get('cursor') || null;
    const numItemsRaw = parseInt(url.searchParams.get('numItems') ?? '25', 10);
    const numItems = Number.isFinite(numItemsRaw) ? numItemsRaw : 25;
    const result = await ctx.runQuery(
      internal.playbook.listConversationsForTraining,
      { search, cursor, numItems },
    );
    return jsonResponse(result, 200);
  }),
});

/** Mensajes de una conversación (preview antes de analizar). */
http.route({
  path: '/api/playbook/conversation',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId')?.trim();
    if (!conversationId) {
      return jsonResponse({ error: '`conversationId` requerido' }, 400);
    }
    const data = await ctx.runQuery(
      internal.playbook.getConversationMessagesForTraining,
      { conversationId: conversationId as never },
    );
    if (!data) return jsonResponse({ error: 'Conversación no encontrada' }, 404);
    return jsonResponse(data, 200);
  }),
});

/** Analiza conversaciones seleccionadas con IA → borradores de ejemplos. */
http.route({
  path: '/api/playbook/analyze',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    let body: { conversationIds?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }
    const ids = Array.isArray(body?.conversationIds)
      ? body.conversationIds.map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return jsonResponse(
        { error: 'Selecciona al menos una conversación' },
        400,
      );
    }
    const result = await ctx.runAction(
      internal.playbook.analyzeConversationsForDraft,
      { conversationIds: ids as never },
    );
    return jsonResponse(result, 200);
  }),
});

/** Re-sincroniza TODA la tabla con el RAG (reindexar). */
http.route({
  path: '/api/playbook/sync',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;
    const result = await ctx.runAction(internal.playbook.syncAllToRag, {});
    return jsonResponse(result, 200);
  }),
});

/** Ajustes globales del contrato (cuentas bancarias, cláusulas, etc.). */
http.route({
  path: '/api/admin/contract-settings',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const row = await ctx.runQuery(
      internal.adminContractSettings.getForAdmin,
      {},
    );
    if (!row) {
      return jsonResponse({ document: null }, 200);
    }
    return jsonResponse(
      {
        document: row.payload,
        updatedAt: row.updatedAt,
      },
      200,
    );
  }),
});

http.route({
  path: '/api/admin/contract-settings',
  method: 'PUT',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }
    if (body == null || typeof body !== 'object') {
      return jsonResponse({ error: 'Se esperaba un objeto JSON' }, 400);
    }

    await ctx.runMutation(internal.adminContractSettings.replaceForAdmin, {
      payload: body,
    });

    return jsonResponse({ ok: true }, 200);
  }),
});

/** Chat flotante del sitio público (proxeado desde Next.js con X-API-Key). */
http.route({
  path: '/api/web-chat/messages',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId')?.trim() ?? '';
    const sinceRaw = url.searchParams.get('since');
    const since =
      sinceRaw != null && sinceRaw !== ''
        ? Number(sinceRaw)
        : undefined;
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '80', 10);

    if (!sessionId || sessionId.length < 8) {
      return jsonResponse({ error: '`sessionId` requerido (mín. 8 caracteres)' }, 400);
    }

    const result = await ctx.runQuery(internal.webChat.listMessagesForSession, {
      sessionId,
      since: Number.isFinite(since) ? since : undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : 80,
    });

    return jsonResponse(result, 200);
  }),
});

http.route({
  path: '/api/web-chat/send',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireYCloudApiKey(request);
    if (denied) return denied;

    let body: { sessionId?: string; text?: string; displayName?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    const sessionId = String(body?.sessionId ?? '').trim();
    const text = String(body?.text ?? '').trim();
    const displayName = body?.displayName?.trim() || undefined;

    if (!sessionId || sessionId.length < 8) {
      return jsonResponse({ error: '`sessionId` requerido' }, 400);
    }
    if (!text) {
      return jsonResponse({ error: '`text` requerido' }, 400);
    }

    try {
      await ctx.runAction(internal.webChat.processWebInboundMessage, {
        sessionId,
        text,
        displayName,
      });
      return jsonResponse({ ok: true }, 200);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al procesar mensaje';
      return jsonResponse({ error: message }, 400);
    }
  }),
});

/** Contador de visitas del sitio público (dashboard admin). */
http.route({
  path: '/api/analytics/page-view',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    let body: { path?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    await ctx.runMutation(internal.siteAnalytics.recordPageView, {
      path: body.path?.trim() || undefined,
    });
    return jsonResponse({ ok: true }, 200);
  }),
});

http.route({
  path: '/api/analytics/stats',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const stats = await ctx.runQuery(internal.siteAnalytics.getDashboardStats, {});
    return jsonResponse(stats, 200);
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints públicos para el formulario de autorrelleno de contrato.
// No requieren X-API-Key (el cliente final los accede directamente).
// La seguridad viene del token UUID de un solo uso con TTL 48 h.
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_FILL_CORS = { 'Access-Control-Allow-Origin': '*' } as const;

/** GET /api/contract-fill/:token → devuelve datos del deal para precargar el form. */
http.route({
  pathPrefix: '/api/contract-fill/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.pathname.replace('/api/contract-fill/', '').trim();

    if (!token || token.length < 8) {
      return jsonResponse({ error: 'Token inválido' }, 400, CONTRACT_FILL_CORS);
    }

    const payload = await ctx.runQuery(internal.contractFillTokens.getPublicDealByToken, {
      token,
    });

    if (!payload) {
      return jsonResponse({ error: 'Link no encontrado' }, 404, CONTRACT_FILL_CORS);
    }

    const publicContext = {
      source: payload.source,
      deal: payload.deal,
      propertyImages: payload.propertyImages,
    };

    if (payload.status === 'filled') {
      return jsonResponse(
        {
          error: 'already_filled',
          message: 'Este link ya fue utilizado.',
          ...publicContext,
        },
        409,
        CONTRACT_FILL_CORS,
      );
    }
    if (payload.status === 'expired' || payload.expiresAt < Date.now()) {
      return jsonResponse(
        {
          error: 'expired',
          message: 'Este link ha expirado. Solicita uno nuevo al asesor.',
          ...publicContext,
        },
        410,
        CONTRACT_FILL_CORS,
      );
    }

    return jsonResponse(
      {
        ok: true,
        ...publicContext,
      },
      200,
      CONTRACT_FILL_CORS,
    );
  }),
});

/** POST /api/contract-fill/:token → recibe los datos del cliente y notifica al asesor. */
http.route({
  pathPrefix: '/api/contract-fill/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.pathname.replace('/api/contract-fill/', '').trim();

    if (!token || token.length < 8) {
      return jsonResponse({ error: 'Token inválido' }, 400, CONTRACT_FILL_CORS);
    }

    let body: {
      nombre?: string;
      cedula?: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      ciudad?: string;
      cedulaPhotoUrls?: string[];
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400, CONTRACT_FILL_CORS);
    }

    const nombre = String(body?.nombre ?? '').trim();
    const cedula = String(body?.cedula ?? '').trim();
    const email = String(body?.email ?? '').trim();
    const telefono = String(body?.telefono ?? '').trim();
    const direccion = String(body?.direccion ?? '').trim();
    const ciudad = body?.ciudad?.trim() || undefined;

    if (!nombre || !cedula || !email || !telefono || !direccion) {
      return jsonResponse(
        { error: 'Todos los campos son requeridos: nombre, cedula, email, telefono, direccion' },
        400,
        CONTRACT_FILL_CORS,
      );
    }

    const result = await ctx.runAction(
      internal.contractFillTokensAction.processFillSubmit,
      {
        token,
        nombre,
        cedula,
        email,
        telefono,
        direccion,
        ciudad,
        cedulaPhotoUrls: Array.isArray(body?.cedulaPhotoUrls)
          ? body.cedulaPhotoUrls
              .map((u) => String(u ?? "").trim())
              .filter((u) => u.length > 0)
              .slice(0, 2)
          : undefined,
      },
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        already_filled: 409,
        expired: 410,
      };
      const reason = (result as { reason?: string }).reason ?? 'error';
      return jsonResponse({ error: reason }, statusMap[reason] ?? 400, CONTRACT_FILL_CORS);
    }

    return jsonResponse(
      { ok: true, message: '¡Datos recibidos! Tu asesor los revisará muy pronto.' },
      200,
      CONTRACT_FILL_CORS,
    );
  }),
});

/** POST /api/admin/contract-link — crea link de contrato desde el panel admin. */
http.route({
  path: '/api/admin/contract-link',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    let body: {
      contractDraftJson?: string;
      contractSettingsJson?: string;
      propertyMetaJson?: string;
      propertyTitle?: string;
      propertyLocation?: string;
      fechaEntrada?: string;
      fechaSalida?: string;
      cupo?: number;
      precioTotal?: number;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    if (
      !body?.contractDraftJson?.trim() ||
      !body?.contractSettingsJson?.trim() ||
      !body?.propertyMetaJson?.trim()
    ) {
      return jsonResponse(
        { error: 'Faltan contractDraftJson, contractSettingsJson o propertyMetaJson' },
        400,
      );
    }

    const result = await ctx.runAction(
      internal.contractFillTokensAction.prepareAdminContractLink,
      {
        contractDraftJson: body.contractDraftJson,
        contractSettingsJson: body.contractSettingsJson,
        propertyMetaJson: body.propertyMetaJson,
        propertyTitle: body.propertyTitle,
        propertyLocation: body.propertyLocation,
        fechaEntrada: body.fechaEntrada,
        fechaSalida: body.fechaSalida,
        cupo: body.cupo,
        precioTotal: body.precioTotal,
      },
    );

    return jsonResponse(result, 200);
  }),
});

/** GET /api/admin/contract-link/:token — datos completos del borrador (solo servidor). */
http.route({
  pathPrefix: '/api/admin/contract-link/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const token = url.pathname.replace('/api/admin/contract-link/', '').trim();
    if (!token || token.length < 8) {
      return jsonResponse({ error: 'Token inválido' }, 400);
    }

    const row = await ctx.runQuery(internal.contractFillTokens.getByToken, { token });
    if (!row) return jsonResponse({ error: 'Link no encontrado' }, 404);
    if (row.status === 'expired' || row.expiresAt < Date.now()) {
      return jsonResponse({ error: 'expired' }, 410);
    }

    return jsonResponse({
      ok: true,
      token: row.token,
      status: row.status,
      source: row.source ?? 'inbox',
      expiresAt: row.expiresAt,
      deal: {
        propertyTitle: row.propertyTitle ?? null,
        propertyLocation: row.propertyLocation ?? null,
        fechaEntrada: row.fechaEntrada ?? null,
        fechaSalida: row.fechaSalida ?? null,
        cupo: row.cupo ?? null,
        precioTotal: row.precioTotal ?? null,
      },
      contractDraftJson: row.contractDraftJson ?? null,
      contractSettingsJson: row.contractSettingsJson ?? null,
      propertyMetaJson: row.propertyMetaJson ?? null,
      filledData: row.filledData ?? null,
    }, 200);
  }),
});

/** OPTIONS preflight para CORS (permite que FincasYaWeb llame desde el browser). */
http.route({
  pathPrefix: '/api/contract-fill/',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Portal público de check-in del turista (`/checkin/:reference`).
// No requiere X-API-Key: el cliente final lo abre desde el botón de la plantilla
// de WhatsApp `inicio_checkin_turista`. La "llave" es la `reference` de la
// reserva. El link NO expira y admite guardado parcial (llenar unos invitados
// hoy y el resto otro día con el mismo enlace).
// ─────────────────────────────────────────────────────────────────────────────

const CHECKIN_CORS = { 'Access-Control-Allow-Origin': '*' } as const;

/** GET /api/checkin/:reference → resumen de la reserva + lo ya guardado. */
http.route({
  pathPrefix: '/api/checkin/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(
      url.pathname.replace('/api/checkin/', ''),
    ).trim();

    if (!key) return jsonResponse({ error: 'Referencia inválida' }, 400, CHECKIN_CORS);

    const data = await ctx.runQuery(internal.checkinPortal.getForPortal, { key });
    if (data && 'portalClosed' in data && data.portalClosed) {
      return jsonResponse(
        {
          error: 'reservation_ended',
          message: 'Esta reserva ya finalizó.',
          redirectUrl: 'https://fincasya.com',
        },
        410,
        CHECKIN_CORS,
      );
    }
    if (!data) {
      return jsonResponse(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        404,
        CHECKIN_CORS,
      );
    }

    return jsonResponse({ ok: true, ...data }, 200, CHECKIN_CORS);
  }),
});

/** POST /api/checkin/:reference → guarda avance (`save`) o envía (`submit`). */
http.route({
  pathPrefix: '/api/checkin/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(
      url.pathname.replace('/api/checkin/', ''),
    ).trim();

    if (!key) return jsonResponse({ error: 'Referencia inválida' }, 400, CHECKIN_CORS);

    let body: {
      action?: 'save' | 'submit';
      guests?: Array<{
        nombreCompleto?: string;
        cedula?: string;
        tipoDocumento?: string;
        esMenor?: boolean;
      }>;
      needsEmpleada?: boolean;
      needsTeam?: boolean;
      serviciosNota?: string;
      menoresDe2?: number;
      placas?: string;
      mascotas?: number;
      observaciones?: string;
      aceptaTratamientoDatos?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400, CHECKIN_CORS);
    }

    const guests = (Array.isArray(body?.guests) ? body.guests : []).map((g) => ({
      nombreCompleto: String(g?.nombreCompleto ?? '').trim(),
      cedula: String(g?.cedula ?? '').trim() || undefined,
      tipoDocumento:
        String(g?.tipoDocumento ?? '').trim().toUpperCase() || undefined,
      esMenor: Boolean(g?.esMenor) || undefined,
    }));
    const payload = {
      key,
      guests,
      menoresDe2:
        body?.menoresDe2 === undefined
          ? undefined
          : Math.max(0, Math.floor(Number(body.menoresDe2) || 0)),
      placas: body?.placas?.trim() || undefined,
      mascotas:
        body?.mascotas === undefined
          ? undefined
          : Math.max(0, Math.floor(Number(body.mascotas) || 0)),
      observaciones: body?.observaciones?.trim() || undefined,
      aceptaTratamientoDatos:
        body?.aceptaTratamientoDatos === undefined
          ? undefined
          : body.aceptaTratamientoDatos === true,
      needsEmpleada: Boolean(body?.needsEmpleada),
      needsTeam: Boolean(body?.needsTeam),
      serviciosNota: body?.serviciosNota?.trim() || undefined,
    };

    const isSubmit = body?.action === 'submit';
    const result = isSubmit
      ? await ctx.runMutation(internal.checkinPortal.submitCheckin, payload)
      : await ctx.runMutation(internal.checkinPortal.saveDraft, payload);

    if (!result.ok) {
      const reason = (result as { reason?: string }).reason ?? 'error';
      const statusMap: Record<string, number> = {
        not_found: 404,
        count_mismatch: 422,
        missing_guests: 422,
        missing_name: 422,
        missing_cedula: 422,
        missing_data_consent: 422,
        guest_list_locked: 423,
        reservation_ended: 410,
      };
      return jsonResponse(
        { error: reason, ...result },
        statusMap[reason] ?? 400,
        CHECKIN_CORS,
      );
    }

    return jsonResponse({ ...result, ok: true }, 200, CHECKIN_CORS);
  }),
});

/** OPTIONS preflight (CORS) para el portal de check-in. */
http.route({
  pathPrefix: '/api/checkin/',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Portal público de check-out del cliente (`/checkout/:reference`).
// Reglas de salida + estado del depósito + captura de cuenta para la devolución.
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/checkout/:reference → reglas, depósito y cuenta ya registrada. */
http.route({
  pathPrefix: '/api/checkout/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(
      url.pathname.replace('/api/checkout/', ''),
    ).trim();
    if (!key) return jsonResponse({ error: 'Referencia inválida' }, 400, CHECKIN_CORS);

    const data = await ctx.runQuery(internal.checkoutPortal.getForPortal, {
      key,
    });
    if (!data) {
      return jsonResponse(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        404,
        CHECKIN_CORS,
      );
    }
    return jsonResponse({ ok: true, ...data }, 200, CHECKIN_CORS);
  }),
});

/** POST /api/checkout/:reference → guarda la cuenta bancaria para la devolución. */
http.route({
  pathPrefix: '/api/checkout/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(
      url.pathname.replace('/api/checkout/', ''),
    ).trim();
    if (!key) return jsonResponse({ error: 'Referencia inválida' }, 400, CHECKIN_CORS);

    let body: {
      cuenta?: {
        titular?: string;
        tipo?: string;
        numero?: string;
        banco?: string;
        documento?: string;
        observaciones?: string;
      };
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400, CHECKIN_CORS);
    }

    const c = body?.cuenta ?? {};
    const result = await ctx.runMutation(
      internal.checkoutPortal.saveDepositAccount,
      {
        key,
        cuenta: {
          titular: c.titular,
          tipo: c.tipo,
          numero: c.numero,
          banco: c.banco,
          documento: c.documento,
          observaciones: c.observaciones,
        },
      },
    );
    if (!result.ok) {
      return jsonResponse({ error: result.reason ?? 'error' }, 404, CHECKIN_CORS);
    }
    return jsonResponse({ ok: true }, 200, CHECKIN_CORS);
  }),
});

/** OPTIONS preflight (CORS) para el portal de check-out. */
http.route({
  pathPrefix: '/api/checkout/',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Portal público de pago del turista (`/pago/:reference`).
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_CORS = { 'Access-Control-Allow-Origin': '*' } as const;

/** GET /api/payment/:reference */
http.route({
  pathPrefix: '/api/payment/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(
      url.pathname.replace('/api/payment/', ''),
    ).trim();

    if (!key) {
      return jsonResponse({ error: 'Referencia inválida' }, 400, PAYMENT_CORS);
    }

    const data = await ctx.runQuery(internal.paymentPortal.getForPortal, {
      key,
    });
    if (!data) {
      return jsonResponse(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        404,
        PAYMENT_CORS,
      );
    }

    return jsonResponse({ ok: true, ...data }, 200, PAYMENT_CORS);
  }),
});

/** POST /api/payment/:reference — subir soporte de pago (JSON o multipart). */
http.route({
  pathPrefix: '/api/payment/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const key = decodeURIComponent(
      url.pathname.replace('/api/payment/', ''),
    ).trim();

    if (!key) {
      return jsonResponse({ error: 'Referencia inválida' }, 400, PAYMENT_CORS);
    }

    const contentType = request.headers.get('content-type') ?? '';

    let bankAccountId: string | undefined;
    let bankName: string | undefined;
    let amount: number | undefined;
    let receiptUrl = '';
    let fileName: string | undefined;
    let mimeType: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return jsonResponse(
          { error: 'multipart/form-data inválido' },
          400,
          PAYMENT_CORS,
        );
      }

      const file = formData.get('file') as File | null;
      bankAccountId =
        String(formData.get('bankAccountId') ?? '').trim() || undefined;
      bankName = String(formData.get('bankName') ?? '').trim() || undefined;
      const amountRaw = String(formData.get('amount') ?? '').trim();
      amount = amountRaw ? Math.max(0, Math.floor(Number(amountRaw) || 0)) : undefined;

      if (!file || typeof file.arrayBuffer !== 'function') {
        return jsonResponse(
          { error: 'Adjunta el comprobante en el campo "file"' },
          400,
          PAYMENT_CORS,
        );
      }

      if (file.size > 900_000) {
        return jsonResponse(
          { error: 'El archivo es muy grande (máx. ~900 KB).' },
          413,
          PAYMENT_CORS,
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(binary);
      mimeType = file.type || 'image/jpeg';
      fileName = file.name || 'comprobante.jpg';
      receiptUrl = `data:${mimeType};base64,${b64}`;
    } else {
      let body: {
        bankAccountId?: string;
        bankName?: string;
        amount?: number;
        receiptUrl?: string;
        fileName?: string;
        mimeType?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body JSON inválido' }, 400, PAYMENT_CORS);
      }
      bankAccountId = body.bankAccountId?.trim() || undefined;
      bankName = body.bankName?.trim() || undefined;
      amount =
        body.amount === undefined
          ? undefined
          : Math.max(0, Math.floor(Number(body.amount) || 0));
      receiptUrl = String(body.receiptUrl ?? '').trim();
      fileName = body.fileName?.trim() || undefined;
      mimeType = body.mimeType?.trim() || undefined;
    }

    const result = await ctx.runMutation(internal.paymentPortal.submitReceipt, {
      key,
      bankAccountId,
      bankName,
      amount,
      receiptUrl,
      fileName,
      mimeType,
    });

    if (!result.ok) {
      const reason = (result as { reason?: string }).reason ?? 'error';
      const statusMap: Record<string, number> = {
        not_found: 404,
        missing_receipt: 422,
      };
      return jsonResponse(
        { error: reason, ...result },
        statusMap[reason] ?? 400,
        PAYMENT_CORS,
      );
    }

    return jsonResponse({ ...result, ok: true }, 200, PAYMENT_CORS);
  }),
});

http.route({
  pathPrefix: '/api/payment/',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }),
});

// ---------------------------------------------------------------------------
// Admin endpoints para sale-links (requieren API key)
// ---------------------------------------------------------------------------

/** POST /api/admin/sale-link — crea un nuevo link de venta */
http.route({
  path: '/api/admin/sale-link',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    if (!body.propertyId || !body.checkIn || !body.checkOut || !body.totalValue || !body.createdBy || !body.contractCode) {
      return jsonResponse({ error: 'Faltan campos requeridos' }, 400);
    }

    const result = await ctx.runMutation(internal.saleLinks.create, {
      propertyId: body.propertyId as import('./_generated/dataModel').Id<'properties'>,
      contractCode: String(body.contractCode ?? '').trim(),
      createdBy: body.createdBy as string,
      createdByName: body.createdByName as string | undefined,
      checkIn: Number(body.checkIn),
      checkOut: Number(body.checkOut),
      nights: Number(body.nights ?? 1),
      guests: Number(body.guests ?? 1),
      checkInTime: body.checkInTime as string | undefined,
      checkOutTime: body.checkOutTime as string | undefined,
      totalValue: Number(body.totalValue),
      rentalValue: Number(body.rentalValue ?? 0),
      depositAmount: Number(body.depositAmount ?? 0),
      cleaningFee: Number(body.cleaningFee ?? 0),
      petDeposit: body.petDeposit !== undefined ? Number(body.petDeposit) : undefined,
      petSurcharge: body.petSurcharge !== undefined ? Number(body.petSurcharge) : undefined,
      petCount: body.petCount !== undefined ? Number(body.petCount) : undefined,
      selectedBankAccountIds: (body.selectedBankAccountIds as string[]) ?? [],
      notes: body.notes as string | undefined,
    });

    return jsonResponse(result, 200);
  }),
});

/** GET /api/admin/sale-links — lista todos los links (con filtro opcional por createdBy) */
http.route({
  path: '/api/admin/sale-links',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const createdBy = url.searchParams.get('createdBy') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;

    const rows = await ctx.runQuery(internal.saleLinks.listForAdmin, {
      createdBy,
      status,
    });

    return jsonResponse({ ok: true, rows }, 200);
  }),
});

/** GET /api/admin/sale-link/:token — obtiene un link por token */
http.route({
  pathPrefix: '/api/admin/sale-link/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const parts = url.pathname.replace('/api/admin/sale-link/', '').split('/');
    const token = parts[0];

    if (!token) return jsonResponse({ error: 'Token requerido' }, 400);

    const row = await ctx.runQuery(internal.saleLinks.getByToken, { token });
    if (!row) return jsonResponse({ error: 'Link no encontrado' }, 404);

    return jsonResponse({ ok: true, row }, 200);
  }),
});

/** PATCH /api/admin/sale-link/:id — actualiza campos del link */
http.route({
  pathPrefix: '/api/admin/sale-link/',
  method: 'PATCH',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const parts = url.pathname.replace('/api/admin/sale-link/', '').split('/');
    const id = parts[0] as import('./_generated/dataModel').Id<'saleLinks'>;
    const action = parts[1];

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
    }

    if (action === 'set-contract-url') {
      await ctx.runMutation(internal.saleLinks.setContractUrl, {
        id,
        contractUrl: body.contractUrl as string,
      });
      return jsonResponse({ ok: true }, 200);
    }

    if (action === 'set-cr-url') {
      await ctx.runMutation(internal.saleLinks.setCrUrl, {
        id,
        crUrl: body.crUrl as string,
        bookingId: body.bookingId as import('./_generated/dataModel').Id<'bookings'> | undefined,
      });
      return jsonResponse({ ok: true }, 200);
    }

    if (action === 'set-owner-offer') {
      const result = await ctx.runMutation(internal.saleLinks.setOwnerOfferInternal, {
        id,
        ownerOfferAmount: Number(body.ownerOfferAmount),
      });
      return jsonResponse(result, result.ok ? 200 : 400);
    }

    if (action === 'mark-owner-offer-sent') {
      const result = await ctx.runMutation(internal.saleLinks.markOwnerOfferSentInternal, {
        id,
      });
      return jsonResponse(result, result.ok ? 200 : 400);
    }

    if (body.ownerOfferAmount !== undefined) {
      const result = await ctx.runMutation(internal.saleLinks.setOwnerOfferInternal, {
        id,
        ownerOfferAmount: Number(body.ownerOfferAmount),
      });
      return jsonResponse(result, result.ok ? 200 : 400);
    }

    if (body.markOwnerOfferSent === true) {
      const result = await ctx.runMutation(internal.saleLinks.markOwnerOfferSentInternal, {
        id,
      });
      return jsonResponse(result, result.ok ? 200 : 400);
    }

    const result = await ctx.runMutation(internal.saleLinks.update, {
      id,
      propertyId: body.propertyId as import('./_generated/dataModel').Id<'properties'> | undefined,
      checkIn: body.checkIn !== undefined ? Number(body.checkIn) : undefined,
      checkOut: body.checkOut !== undefined ? Number(body.checkOut) : undefined,
      nights: body.nights !== undefined ? Number(body.nights) : undefined,
      guests: body.guests !== undefined ? Number(body.guests) : undefined,
      checkInTime: body.checkInTime as string | undefined,
      checkOutTime: body.checkOutTime as string | undefined,
      totalValue: body.totalValue !== undefined ? Number(body.totalValue) : undefined,
      rentalValue: body.rentalValue !== undefined ? Number(body.rentalValue) : undefined,
      depositAmount: body.depositAmount !== undefined ? Number(body.depositAmount) : undefined,
      cleaningFee: body.cleaningFee !== undefined ? Number(body.cleaningFee) : undefined,
      petDeposit: body.petDeposit !== undefined ? Number(body.petDeposit) : undefined,
      petSurcharge: body.petSurcharge !== undefined ? Number(body.petSurcharge) : undefined,
      petCount: body.petCount !== undefined ? Number(body.petCount) : undefined,
      selectedBankAccountIds: body.selectedBankAccountIds as string[] | undefined,
      notes: body.notes as string | undefined,
      status: body.status as 'active' | 'completed' | 'cancelled' | undefined,
    });

    return jsonResponse(result, 200);
  }),
});

/** DELETE /api/admin/sale-link/:id — elimina un link */
http.route({
  pathPrefix: '/api/admin/sale-link/',
  method: 'DELETE',
  handler: httpAction(async (ctx, request) => {
    const denied = requireConvexSiteApiKey(request);
    if (denied) return denied;

    const url = new URL(request.url);
    const id = url.pathname.replace('/api/admin/sale-link/', '').trim() as import('./_generated/dataModel').Id<'saleLinks'>;
    if (!id) return jsonResponse({ error: 'ID requerido' }, 400);

    const result = await ctx.runMutation(internal.saleLinks.remove, { id });
    return jsonResponse(result, 200);
  }),
});

/** POST /api/admin/sale-link/:token/validate-payment — valida el pago desde correo admin */
http.route({
  pathPrefix: '/api/admin/sale-link/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const parts = url.pathname.replace('/api/admin/sale-link/', '').split('/');
    const token = parts[0];
    const action = parts[1];

    if (action === 'validate-payment') {
      let body: { validationKey?: string; validatedBy?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body inválido' }, 400);
      }
      if (!body.validationKey) {
        return jsonResponse({ error: 'validationKey requerida' }, 422);
      }

      const result = await ctx.runMutation(internal.saleLinks.validatePayment, {
        token,
        validatedBy: body.validatedBy ?? 'admin',
        validationKey: body.validationKey,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = { not_found: 404, invalid_key: 403 };
        return jsonResponse(result, statusMap[(result as { reason?: string }).reason ?? ''] ?? 400);
      }
      return jsonResponse(result, 200);
    }

    if (action === 'validate-payment-admin') {
      let body: { validatedBy?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body inválido' }, 400);
      }
      const validatedBy = String(body.validatedBy ?? '').trim();
      if (!validatedBy) {
        return jsonResponse({ error: 'validatedBy requerido' }, 422);
      }

      const result = await ctx.runMutation(internal.saleLinks.validatePaymentAdmin, {
        token,
        validatedBy,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          not_found: 404,
          no_proof: 400,
        };
        return jsonResponse(result, statusMap[(result as { reason?: string }).reason ?? ''] ?? 400);
      }
      return jsonResponse(result, 200);
    }

    if (action === 'reset-payment') {
      const result = await ctx.runMutation(internal.saleLinks.resetPaymentSubmission, {
        token,
      });
      if (!result.ok) {
        const statusMap: Record<string, number> = {
          not_found: 404,
          already_validated: 409,
          nothing_to_reset: 400,
        };
        return jsonResponse(result, statusMap[result.reason ?? ''] ?? 400);
      }
      return jsonResponse(result, 200);
    }

    return jsonResponse({ error: 'Acción no reconocida' }, 404);
  }),
});

/** POST /api/venta/:token/confirm-cr — cliente confirma descarga del CR (paso 5 → 6) */
http.route({
  pathPrefix: '/api/venta/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const parts = url.pathname.replace('/api/venta/', '').split('/');
    const token = parts[0];
    const action = parts[1];

    if (action === 'confirm-cr') {
      const result = await ctx.runMutation(internal.saleLinks.confirmCrInternal, { token });
      return jsonResponse(result, result.ok ? 200 : 400, VENTA_CORS);
    }

    if (action === 'ensure-checkin-booking') {
      const result = await ctx.runMutation(
        internal.saleLinks.ensureBookingForCheckinInternal,
        { token },
      );
      return jsonResponse(result, result.ok ? 200 : 400, VENTA_CORS);
    }

    if (action === 'checkin') {
      let body: {
        guests?: Array<{ nombreCompleto: string; cedula?: string; tipoDocumento?: string; esMenor?: boolean }>;
        placas?: string;
        mascotas?: number;
        observaciones?: string;
        menoresDe2?: number;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body inválido' }, 400, VENTA_CORS);
      }

      const result = await ctx.runMutation(internal.saleLinks.submitCheckinInternal, {
        token,
        guests: body.guests ?? [],
        placas: body.placas,
        mascotas: body.mascotas,
        observaciones: body.observaciones,
        menoresDe2: body.menoresDe2,
      });
      return jsonResponse(result, result.ok ? 200 : 400, VENTA_CORS);
    }

    if (action === 'save-draft') {
      let body: {
        clientPortalUiStep?: number;
        clientDraftPhase?: 'datos' | 'pago';
        nombre?: string;
        cedula?: string;
        email?: string;
        telefono?: string;
        direccion?: string;
        ciudad?: string;
        fechaNacimiento?: string;
        paymentAmount?: number;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body inválido' }, 400, VENTA_CORS);
      }

      const result = await ctx.runMutation(internal.saleLinks.saveClientPortalDraft, {
        token,
        clientPortalUiStep: body.clientPortalUiStep,
        clientDraftPhase: body.clientDraftPhase,
        nombre: body.nombre,
        cedula: body.cedula,
        email: body.email,
        telefono: body.telefono,
        direccion: body.direccion,
        ciudad: body.ciudad,
        fechaNacimiento: body.fechaNacimiento,
        paymentAmount: body.paymentAmount,
      });

      if (!result.ok) {
        const status =
          result.reason === 'not_found'
            ? 404
            : result.reason === 'already_submitted'
              ? 409
              : 400;
        return jsonResponse({ error: result.reason }, status, VENTA_CORS);
      }

      return jsonResponse({ ok: true }, 200, VENTA_CORS);
    }

    if (action === 'submit-payment') {
      let body: {
        nombre?: string;
        cedula?: string;
        email?: string;
        telefono?: string;
        direccion?: string;
        ciudad?: string;
        fechaNacimiento?: string;
        paymentProofUrl?: string;
        paymentProofFileName?: string;
        paymentProofMimeType?: string;
        paymentProofAmount?: number;
        paymentValidationKey?: string;
        cedulaPhotoUrl?: string;
        cedulaPhotoFileName?: string;
        cedulaPhotoMimeType?: string;
      };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body inválido' }, 400, VENTA_CORS);
      }

      if (
        !body.nombre?.trim() ||
        !body.cedula?.trim() ||
        !body.email?.trim() ||
        !body.telefono?.trim() ||
        !body.direccion?.trim() ||
        !body.paymentProofUrl?.trim() ||
        !body.paymentValidationKey?.trim()
      ) {
        return jsonResponse({ error: 'Faltan datos obligatorios' }, 422, VENTA_CORS);
      }

      const result = await ctx.runMutation(api.saleLinks.submitClientData, {
        token,
        nombre: body.nombre.trim(),
        cedula: body.cedula.trim(),
        email: body.email.trim(),
        telefono: body.telefono.trim(),
        direccion: body.direccion.trim(),
        ciudad: body.ciudad?.trim() || undefined,
        fechaNacimiento: body.fechaNacimiento?.trim() || undefined,
        paymentProofUrl: body.paymentProofUrl.trim(),
        paymentProofFileName: body.paymentProofFileName?.trim() || undefined,
        paymentProofMimeType: body.paymentProofMimeType?.trim() || undefined,
        paymentProofAmount: body.paymentProofAmount,
        paymentValidationKey: body.paymentValidationKey.trim(),
        cedulaPhotoUrl: body.cedulaPhotoUrl?.trim() || undefined,
        cedulaPhotoFileName: body.cedulaPhotoFileName?.trim() || undefined,
        cedulaPhotoMimeType: body.cedulaPhotoMimeType?.trim() || undefined,
      });

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          not_found: 404,
          inactive: 410,
          already_submitted: 409,
          already_validated: 409,
          past_payment_step: 409,
        };
        return jsonResponse(
          result,
          statusMap[(result as { reason?: string }).reason ?? ''] ?? 400,
          VENTA_CORS,
        );
      }

      return jsonResponse({ ok: true }, 200, VENTA_CORS);
    }

    if (action === 'validate-payment') {
      let body: { validationKey?: string; validatedBy?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'Body inválido' }, 400, VENTA_CORS);
      }
      if (!body.validationKey) {
        return jsonResponse({ error: 'validationKey requerida' }, 422, VENTA_CORS);
      }
      const result = await ctx.runMutation(internal.saleLinks.validatePayment, {
        token,
        validatedBy: body.validatedBy ?? 'admin-email',
        validationKey: body.validationKey,
      });
      if (!result.ok) {
        const statusMap: Record<string, number> = { not_found: 404, invalid_key: 403 };
        return jsonResponse(result, statusMap[(result as { reason?: string }).reason ?? ''] ?? 400, VENTA_CORS);
      }
      return jsonResponse(result, 200, VENTA_CORS);
    }

    return jsonResponse({ error: 'Acción no reconocida' }, 404, VENTA_CORS);
  }),
});

// ---------------------------------------------------------------------------
// Portal de venta pública /api/venta/:token
// ---------------------------------------------------------------------------

const VENTA_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

http.route({
  pathPrefix: '/api/venta/',
  method: 'OPTIONS',
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        ...VENTA_CORS,
        'Access-Control-Max-Age': '86400',
      },
    });
  }),
});

/** GET /api/venta/:token — datos públicos del portal de venta */
http.route({
  pathPrefix: '/api/venta/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const parts = url.pathname.replace('/api/venta/', '').split('/').filter(Boolean);
    const token = parts[0];
    if (!token) {
      return jsonResponse({ error: 'Token requerido' }, 400, VENTA_CORS);
    }

    if (parts.length === 2 && parts[1] === 'payment-proof') {
      const key = url.searchParams.get('key')?.trim() ?? '';
      if (!key) {
        return jsonResponse(
          { ok: false, error: 'Clave de acceso requerida' },
          400,
          VENTA_CORS,
        );
      }

      const proof = await ctx.runQuery(
        internal.saleLinks.getPaymentProofForValidationKey,
        { token, validationKey: key },
      );

      if (!proof.ok) {
        const status =
          proof.reason === 'invalid_key'
            ? 403
            : proof.reason === 'key_required'
              ? 400
              : 404;
        const message =
          proof.reason === 'not_found'
            ? 'Link no encontrado'
            : proof.reason === 'invalid_key'
              ? 'Clave de acceso inválida'
              : proof.reason === 'no_proof'
                ? 'Comprobante no encontrado'
                : 'Clave de acceso requerida';
        return jsonResponse({ ok: false, error: message }, status, VENTA_CORS);
      }

      const fileName = proof.paymentProofFileName?.trim() || 'comprobante';
      const lower = fileName.toLowerCase();
      const mimeType =
        proof.paymentProofMimeType?.trim() ||
        (lower.endsWith('.pdf')
          ? 'application/pdf'
          : lower.match(/\.(jpe?g)$/)
            ? 'image/jpeg'
            : lower.endsWith('.png')
              ? 'image/png'
              : lower.endsWith('.webp')
                ? 'image/webp'
                : 'application/octet-stream');

      return jsonResponse(
        {
          ok: true,
          fileName,
          mimeType,
          clientName: proof.clientName,
          totalValue: proof.totalValue,
          paymentProofUrl: proof.paymentProofUrl,
        },
        200,
        VENTA_CORS,
      );
    }

    if (parts.length !== 1) {
      return jsonResponse({ error: 'Ruta no encontrada' }, 404, VENTA_CORS);
    }

    const publicData = await ctx.runQuery(internal.saleLinks.getForPortal, { token });
    if (!publicData) {
      return jsonResponse({ error: 'Link no encontrado' }, 404, VENTA_CORS);
    }
    if (publicData.status === 'cancelled') {
      return jsonResponse({ error: 'Este link fue cancelado' }, 410, VENTA_CORS);
    }
    return jsonResponse(publicData, 200, VENTA_CORS);
  }),
});

export default http;
