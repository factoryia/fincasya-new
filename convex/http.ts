import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './betterAuth/auth';
import { internal } from './_generated/api';
import { parseWorkbookSheetsToPayloads } from './lib/whatsappTemplateSheet';
import {
  isOutboundFromBusiness,
  normalizeWhatsappPhone,
  parseYcloudWhatsappBody,
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
      const parsedMsg = parseYcloudWhatsappBody(evt);
      if (phone && parsedMsg) {
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
      } else if (phone) {
        await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
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
      const parsedMsg = parseYcloudWhatsappBody(evt);
      if (phone && parsedMsg) {
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
      } else if (phone) {
        await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
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
          const parsedMsg = parseYcloudWhatsappBody(wm);
          if (phone && parsedMsg) {
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

/** GET /api/contract-fill/:token → devuelve datos del deal para precargar el form. */
http.route({
  pathPrefix: '/api/contract-fill/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const token = url.pathname.replace('/api/contract-fill/', '').trim();

    if (!token || token.length < 8) {
      return jsonResponse({ error: 'Token inválido' }, 400);
    }

    const row = await ctx.runQuery(internal.contractFillTokens.getByToken, { token });

    if (!row) return jsonResponse({ error: 'Link no encontrado' }, 404);
    if (row.status === 'filled') return jsonResponse({ error: 'already_filled', message: 'Este link ya fue utilizado.' }, 409);
    if (row.status === 'expired' || row.expiresAt < Date.now()) {
      return jsonResponse({ error: 'expired', message: 'Este link ha expirado. Solicita uno nuevo al asesor.' }, 410);
    }

    return jsonResponse({
      ok: true,
      source: row.source ?? 'inbox',
      deal: {
        propertyTitle: row.propertyTitle ?? null,
        propertyLocation: row.propertyLocation ?? null,
        fechaEntrada: row.fechaEntrada ?? null,
        fechaSalida: row.fechaSalida ?? null,
        cupo: row.cupo ?? null,
        precioTotal: row.precioTotal ?? null,
      },
    }, 200, {
      'Access-Control-Allow-Origin': '*',
    });
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
      return jsonResponse({ error: 'Token inválido' }, 400);
    }

    let body: {
      nombre?: string;
      cedula?: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      ciudad?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Body JSON inválido' }, 400);
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
      );
    }

    const result = await ctx.runAction(
      internal.contractFillTokensAction.processFillSubmit,
      { token, nombre, cedula, email, telefono, direccion, ciudad },
    );

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        not_found: 404,
        already_filled: 409,
        expired: 410,
      };
      const reason = (result as { reason?: string }).reason ?? 'error';
      return jsonResponse({ error: reason }, statusMap[reason] ?? 400, {
        'Access-Control-Allow-Origin': '*',
      });
    }

    return jsonResponse({ ok: true, message: '¡Datos recibidos! Tu asesor los revisará muy pronto.' }, 200, {
      'Access-Control-Allow-Origin': '*',
    });
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

export default http;
