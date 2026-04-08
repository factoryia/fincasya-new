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
        type?: string;
        text?: { body?: string };
        image?: { link?: string; caption?: string };
        audio?: { link?: string };
        video?: { link?: string; caption?: string };
        document?: { link?: string; caption?: string; filename?: string };
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
      }

      if (phone && (content || mediaUrl)) {
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
            type: msgType,
            mediaUrl: mediaUrl || undefined,
          });
        }
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

    const name = (file as File).name?.toLowerCase() ?? '';
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
          error: item.error,
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

export default http;
