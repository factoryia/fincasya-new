import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { authComponent, createAuth } from './betterAuth/auth';
import { internal } from './_generated/api';
import { parseWorkbookSheetsToPayloads } from './lib/whatsappTemplateSheet';

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
      const phone = evt.from ?? '';
      const name = (evt.customerProfile?.name ?? '').trim() || phone;
      const wamid = evt.wamid ?? evt.id;
      const replyToWamid =
        typeof evt.context?.id === "string" && evt.context.id.trim().length > 6
          ? evt.context.id.trim()
          : undefined;

      let content = '';
      let msgType: 'text' | 'image' | 'audio' | 'video' | 'document' = 'text';
      let mediaUrl = '';

      if (evt.type === 'text' && evt.text?.body) {
        content = String(evt.text.body).trim();
        msgType = 'text';
      } else if (evt.type === 'image' && evt.image?.link) {
        content = (evt.image.caption ?? '').trim() || '[Imagen]';
        msgType = 'image';
        mediaUrl = evt.image.link;
      } else if (evt.type === 'audio' && evt.audio?.link) {
        content = '[Audio]';
        msgType = 'audio';
        mediaUrl = evt.audio.link;
      } else if (evt.type === 'video' && evt.video?.link) {
        content = (evt.video.caption ?? '').trim() || '[Video]';
        msgType = 'video';
        mediaUrl = evt.video.link;
      } else if (evt.type === 'document' && evt.document?.link) {
        content =
          (evt.document.caption ?? evt.document.filename ?? '').trim() ||
          '[Documento]';
        msgType = 'document';
        mediaUrl = evt.document.link;
      } else if (evt.type === 'order' && evt.order?.product_items?.length) {
        const firstItem = evt.order.product_items[0];
        const retailerId = firstItem?.product_retailer_id?.trim();
        const qty = firstItem?.quantity ?? 1;
        const catalogId = evt.order.catalog_id?.trim();
        const baseText =
          evt.order.text?.trim() || 'Seleccioné una finca del catálogo.';
        content = retailerId
          ? `${baseText}\nproduct_retailer_id: ${retailerId}\nquantity: ${qty}${catalogId ? `\ncatalog_id: ${catalogId}` : ''}`
          : baseText;
        msgType = 'text';
      } else {
        // Fallback defensivo: algunos proveedores envían product_items en raíz del evento.
        const anyEvt = evt as any;
        const productItems = Array.isArray(anyEvt?.product_items)
          ? anyEvt.product_items
          : [];
        if (productItems.length > 0) {
          const firstItem = productItems[0];
          const retailerId = String(firstItem?.product_retailer_id ?? '').trim();
          const qty = Number(firstItem?.quantity ?? 1);
          const catalogId = String(anyEvt?.catalog_id ?? '').trim();
          const text = String(anyEvt?.text ?? '').trim() || 'Seleccioné una finca del catálogo.';
          content = retailerId
            ? `${text}\nproduct_retailer_id: ${retailerId}\nquantity: ${qty}${catalogId ? `\ncatalog_id: ${catalogId}` : ''}`
            : text;
          msgType = 'text';
        }
      }

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
      }
    }

    // Si YCloud envía evento de mensaje enviado por el negocio (humano desde dashboard),
    // escalar a "human" para que la IA no siga respondiendo hasta que se vuelva a "ai".
    const outbound = body as {
      type?: string;
      whatsappOutboundMessage?: { to?: string };
    };
    if (
      outbound.type === 'whatsapp.outbound_message.sent' &&
      outbound.whatsappOutboundMessage?.to
    ) {
      await ctx.runMutation(internal.ycloud.markOutboundAsHuman, {
        phone: outbound.whatsappOutboundMessage.to,
      });
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
    const denied = requireYCloudApiKey(request);
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
    const denied = requireYCloudApiKey(request);
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

export default http;
