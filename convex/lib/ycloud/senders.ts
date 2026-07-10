import { FALLBACK_CATALOG_ID, MAX_CATALOG_PRODUCTS_PER_SEND, CATALOG_BETWEEN_SENDS_MS } from "./constants";

/** Filas devueltas al orquestador: alinea cada producto con el wamid del mensaje enviado (si la API lo devolvió). */
export type CatalogOutboundSendRow = {
  productRetailerId: string;
  wamid?: string;
  /**
   * `false` si esta ficha NO se pudo enviar (ej. el producto no está en el
   * catálogo Meta → error 131009). Se omite para no abortar el resto del
   * envío; el orquestador no registra esa finca como enviada.
   */
  ok: boolean;
};

/** Extrae wamid del JSON de respuesta de sendDirectly (YCloud / WhatsApp). */
export function wamidFromYcloudSendResponse(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const o = parsed as Record<string, unknown>;
  if (typeof o.wamid === "string" && o.wamid.length > 6) return o.wamid.trim();
  const nested = o.whatsappMessage;
  if (nested && typeof nested === "object") {
    const w = (nested as Record<string, unknown>).wamid;
    if (typeof w === "string" && w.length > 6) return w.trim();
  }
  const msgs = o.messages;
  if (Array.isArray(msgs) && msgs[0] && typeof msgs[0] === "object") {
    const id = (msgs[0] as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 6) return id.trim();
  }
  return undefined;
}

function requireYcloudEnv() {
  const apiKey = process.env.YCLOUD_API_KEY;
  const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
  if (!apiKey || !wabaNumber) {
    throw new Error("Configura YCLOUD_API_KEY y YCLOUD_WABA_NUMBER en Convex");
  }
  return { apiKey, wabaNumber };
}

export async function sendTextToYcloud(args: {
  to: string;
  text: string;
  wamid?: string;
  sendDirectly?: boolean;
}) {
  const { apiKey, wabaNumber } = requireYcloudEnv();
  const endpoint = args.sendDirectly
    ? "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly"
    : "https://api.ycloud.com/v2/whatsapp/messages";
  const body: Record<string, unknown> = {
    from: wabaNumber,
    to: args.to,
    type: "text",
    text: { body: args.text.replace(/\[CONTRACT_PDF:.*?\]/g, "").trim() },
  };
  if (args.wamid) body.context = { message_id: args.wamid };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const textRes = await res.text();
  if (!res.ok) throw new Error(`YCloud error ${res.status}: ${textRes}`);
  const parsed = textRes ? JSON.parse(textRes) : {};
  const wamid = wamidFromYcloudSendResponse(parsed);
  const rawStatus = ((): unknown => {
    if (typeof parsed !== "object" || !parsed) return undefined;
    const o = parsed as Record<string, unknown>;
    if (typeof o.status === "string") return o.status;
    const nested = o.whatsappMessage;
    if (nested && typeof nested === "object") {
      const s = (nested as Record<string, unknown>).status;
      if (typeof s === "string") return s;
    }
    return undefined;
  })();
  const status =
    typeof rawStatus === "string" ? rawStatus.toLowerCase() : undefined;
  return { wamid, status };
}

/** Componente de plantilla ya armado para el payload de YCloud/Meta. */
export type TemplateComponent = {
  type: "header" | "body" | "button";
  /** Solo para botones tipo `url`/`quick_reply` que admiten índice. */
  sub_type?: string;
  index?: string;
  parameters: Array<Record<string, unknown>>;
};

/**
 * Envía un mensaje de **plantilla preaprobada por Meta** (`type: "template"`).
 *
 * Es la ÚNICA forma permitida por Meta de iniciar conversación fuera de la
 * ventana de 24h (recordatorios programados, avisos al propietario, etc.).
 * Mensajes de texto libre fuera de ventana son rechazados por la API.
 *
 * `bodyParams`/`headerParams` rellenan las variables posicionales `{{1}}`,
 * `{{2}}`… de la plantilla en el MISMO orden en que aparecen en su cuerpo.
 */
export async function sendTemplateToYcloud(args: {
  to: string;
  /** Nombre exacto de la plantilla aprobada (ej. `inicio_checkin_turista`). */
  templateName: string;
  /** Código de idioma de la plantilla aprobada. Default `es`. */
  languageCode?: string;
  bodyParams?: string[];
  headerParams?: string[];
  /** Componentes ya armados (botones con URL dinámica, etc.). Tienen prioridad. */
  components?: TemplateComponent[];
  sendDirectly?: boolean;
}): Promise<{ wamid?: string; status?: string }> {
  const { apiKey, wabaNumber } = requireYcloudEnv();
  const endpoint = (args.sendDirectly ?? true)
    ? "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly"
    : "https://api.ycloud.com/v2/whatsapp/messages";

  const components: Array<Record<string, unknown>> = [];
  if (args.components && args.components.length > 0) {
    components.push(...args.components);
  } else {
    if (args.headerParams && args.headerParams.length > 0) {
      components.push({
        type: "header",
        parameters: args.headerParams.map((text) => ({ type: "text", text })),
      });
    }
    if (args.bodyParams && args.bodyParams.length > 0) {
      components.push({
        type: "body",
        parameters: args.bodyParams.map((text) => ({ type: "text", text })),
      });
    }
  }

  const body: Record<string, unknown> = {
    from: wabaNumber,
    to: args.to,
    type: "template",
    template: {
      name: args.templateName,
      language: { code: args.languageCode ?? "es" },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const textRes = await res.text();
  if (!res.ok) {
    throw new Error(
      `YCloud template "${args.templateName}" error ${res.status}: ${textRes}`,
    );
  }
  const parsed = textRes ? JSON.parse(textRes) : {};
  const wamid = wamidFromYcloudSendResponse(parsed);
  const rawStatus = ((): unknown => {
    if (typeof parsed !== "object" || !parsed) return undefined;
    const o = parsed as Record<string, unknown>;
    if (typeof o.status === "string") return o.status;
    const nested = o.whatsappMessage;
    if (nested && typeof nested === "object") {
      const s = (nested as Record<string, unknown>).status;
      if (typeof s === "string") return s;
    }
    return undefined;
  })();
  const status =
    typeof rawStatus === "string" ? rawStatus.toLowerCase() : undefined;
  return { wamid, status };
}

const SEND_DIRECTLY = "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly";

async function uploadMediaBufferToYcloud(args: {
  buffer: Uint8Array;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const { apiKey, wabaNumber } = requireYcloudEnv();
  const form = new FormData();
  const arrayBuffer = new ArrayBuffer(args.buffer.byteLength);
  new Uint8Array(arrayBuffer).set(args.buffer);
  form.append(
    "file",
    new Blob([arrayBuffer], { type: args.mimeType }),
    args.filename,
  );

  const uploadUrl = `https://api.ycloud.com/v2/whatsapp/media/${encodeURIComponent(wabaNumber)}/upload`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
    body: form,
    duplex: "half",
  } as RequestInit);

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`YCloud upload failed: ${uploadRes.status} - ${errText}`);
  }
  const uploadResult = (await uploadRes.json()) as { id?: string };
  const mediaId = uploadResult?.id;
  if (!mediaId) throw new Error("YCloud upload did not return media id");
  return mediaId;
}

export async function sendImageToYcloud(args: {
  to: string;
  imageBuffer: Uint8Array;
  mimeType: string;
  filename?: string;
  caption?: string;
}): Promise<{ wamid?: string; status?: string }> {
  const { apiKey, wabaNumber } = requireYcloudEnv();
  const mediaId = await uploadMediaBufferToYcloud({
    buffer: args.imageBuffer,
    mimeType: args.mimeType,
    filename: args.filename || "pago.jpg",
  });

  const body: Record<string, unknown> = {
    from: wabaNumber,
    to: args.to,
    type: "image",
    image: {
      id: mediaId,
      ...(args.caption?.trim() ? { caption: args.caption.trim() } : {}),
    },
  };

  const res = await fetch(SEND_DIRECTLY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const textRes = await res.text();
  if (!res.ok) {
    throw new Error(`YCloud image send failed: ${res.status}: ${textRes}`);
  }
  const parsed = textRes ? JSON.parse(textRes) : {};
  const wamid = wamidFromYcloudSendResponse(parsed);
  const rawStatus = ((): unknown => {
    if (typeof parsed !== "object" || !parsed) return undefined;
    const o = parsed as Record<string, unknown>;
    if (typeof o.status === "string") return o.status;
    const nested = o.whatsappMessage;
    if (nested && typeof nested === "object") {
      const s = (nested as Record<string, unknown>).status;
      if (typeof s === "string") return s;
    }
    return undefined;
  })();
  const status =
    typeof rawStatus === "string" ? rawStatus.toLowerCase() : undefined;
  return { wamid, status };
}

function normalizeWhatsAppAudioMime(
  mimeType: string,
  filename: string,
): { mimeType: string; filename: string } {
  const base = mimeType.split(";")[0].trim().toLowerCase() || "audio/ogg";
  let mime = base;
  let name = filename || "voice.ogg";

  if (mime === "audio/webm" || mime === "video/webm") {
    throw new Error(
      "Formato WebM no compatible con WhatsApp. Vuelve a grabar el audio o envíalo desde Safari.",
    );
  } else if (mime === "audio/aac" || mime === "audio/x-m4a") {
    mime = "audio/mp4";
    if (!/\.m4a$/i.test(name)) name = name.replace(/\.\w+$/i, "") + ".m4a";
  } else if (mime === "audio/mpeg" || mime === "audio/mp3") {
    mime = "audio/mpeg";
    if (!/\.mp3$/i.test(name)) name = name.replace(/\.\w+$/i, "") + ".mp3";
  } else if (mime.includes("ogg")) {
    mime = "audio/ogg";
    if (!/\.ogg$/i.test(name)) name = name.replace(/\.\w+$/i, "") + ".ogg";
  }

  return { mimeType: mime, filename: name };
}

export async function sendAudioToYcloud(args: {
  to: string;
  audioBuffer: Uint8Array;
  mimeType: string;
  filename?: string;
  wamid?: string;
}): Promise<{ wamid?: string; status?: string }> {
  const { apiKey, wabaNumber } = requireYcloudEnv();
  const normalized = normalizeWhatsAppAudioMime(
    args.mimeType,
    args.filename || "voice.ogg",
  );

  const mediaId = await uploadMediaBufferToYcloud({
    buffer: args.audioBuffer,
    mimeType: normalized.mimeType,
    filename: normalized.filename,
  });

  const body: Record<string, unknown> = {
    from: wabaNumber,
    to: args.to,
    type: "audio",
    audio: {
      id: mediaId,
      voice: true,
    },
  };
  if (args.wamid) body.context = { message_id: args.wamid };

  const res = await fetch(SEND_DIRECTLY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const textRes = await res.text();
  if (!res.ok) {
    throw new Error(`YCloud audio send failed: ${res.status}: ${textRes}`);
  }
  const parsed = textRes ? JSON.parse(textRes) : {};
  const wamid = wamidFromYcloudSendResponse(parsed);
  const rawStatus = ((): unknown => {
    if (typeof parsed !== "object" || !parsed) return undefined;
    const o = parsed as Record<string, unknown>;
    if (typeof o.status === "string") return o.status;
    const nested = o.whatsappMessage;
    if (nested && typeof nested === "object") {
      const s = (nested as Record<string, unknown>).status;
      if (typeof s === "string") return s;
    }
    return undefined;
  })();
  const status =
    typeof rawStatus === "string" ? rawStatus.toLowerCase() : undefined;
  return { wamid, status };
}

const BETWEEN_SENDS_MS = CATALOG_BETWEEN_SENDS_MS;

/** Cuerpo cuando no hay línea de precio pero sí hay más fichas (sin numerar ni texto interno). */
const BODY_WHEN_QUOTE_MISSING = "Aquí va otra opción 🏡";

/**
 * Envía **una tarjeta de producto por finca** (interactive type `product`), no `product_list`.
 * Por defecto limita a `MAX_CATALOG_PRODUCTS_PER_SEND` para envíos automáticos del bot.
 * Pasa `limit` explícito para envíos manuales del asesor (ej. el total seleccionado).
 */
export async function sendCatalogToYcloud(args: {
  to: string;
  productRetailerIds: string[];
  /** Una línea por id (ej. 💰 Para tus fechas…); si viene, es el cuerpo de cada mensaje `interactive`. */
  productQuoteLines?: string[];
  bodyText?: string;
  catalogId?: string;
  wamid?: string;
  /** Máximo de fichas a enviar. Por defecto MAX_CATALOG_PRODUCTS_PER_SEND (12). */
  limit?: number;
  onProductSent?: (row: CatalogOutboundSendRow) => void | Promise<void>;
}): Promise<CatalogOutboundSendRow[]> {
  const ids = args.productRetailerIds.slice(0, args.limit ?? MAX_CATALOG_PRODUCTS_PER_SEND);
  if (ids.length === 0) return [];

  const { apiKey, wabaNumber } = requireYcloudEnv();
  let catalogId = args.catalogId ?? FALLBACK_CATALOG_ID;
  const headerFallback = args.bodyText ?? "Estas son nuestras fincas disponibles:";
  const quotes = args.productQuoteLines ?? [];

  const bodyForIndex = (i: number): string => {
    const q = quotes[i]?.trim();
    if (q) return q;
    if (ids.length === 1) return headerFallback;
    return i === 0 ? headerFallback : BODY_WHEN_QUOTE_MISSING;
  };

  const sendOne = async (
    productRetailerId: string,
    bodyText: string,
    includeReplyContext: boolean,
  ): Promise<{ ok: boolean; status: number; text: string }> => {
    const body: Record<string, unknown> = {
      from: wabaNumber,
      to: args.to,
      type: "interactive",
      interactive: {
        type: "product",
        body: { text: bodyText },
        footer: { text: "FincasYa" },
        action: { catalog_id: catalogId, product_retailer_id: productRetailerId },
      },
    };
    if (includeReplyContext && args.wamid) {
      body.context = { message_id: args.wamid };
    }
    const res = await fetch(SEND_DIRECTLY, {
      method: "POST",
      headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-API-Key": apiKey,
    },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  };

  // RESILIENCIA: una ficha que falle (ej. producto no registrado en el
  // catálogo Meta → error 131009 "product not found") NO debe abortar el
  // envío completo. Antes se lanzaba en el primer fallo → `processInbound-
  // MessageV2` reventaba y el cliente solo recibía las fichas previas al
  // error (y el catálogo nunca se registraba → la paginación "ver más"
  // re-enviaba las mismas). Ahora cada ficha mala se OMITE (se loguea) y se
  // sigue con el resto; `ok:false` marca las que no salieron.
  const rows: CatalogOutboundSendRow[] = [];
  const pushRow = async (
    productRetailerId: string,
    resp: { ok: boolean; status: number; text: string },
    indexLabel: string,
  ): Promise<void> => {
    if (resp.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(resp.text);
      } catch {
        parsed = { raw: resp.text };
      }
      const row: CatalogOutboundSendRow = {
        productRetailerId,
        wamid: wamidFromYcloudSendResponse(parsed),
        ok: true,
      };
      rows.push(row);
      if (args.onProductSent) await args.onProductSent(row);
    } else {
      console.error(
        `[catalog] ficha ${indexLabel} (${productRetailerId}) falló — se omite: ${resp.status} ${resp.text.slice(0, 220)}`,
      );
      rows.push({ productRetailerId, ok: false });
    }
  };

  // Ficha #1: incluye el contexto de reply + el retry de catálogo inválido.
  let r = await sendOne(ids[0], bodyForIndex(0), true);
  const invalidCatalog =
    !r.ok &&
    r.status === 400 &&
    /invalid.*catalog|131009/i.test(r.text);
  if (invalidCatalog && catalogId !== FALLBACK_CATALOG_ID) {
    catalogId = FALLBACK_CATALOG_ID;
    r = await sendOne(ids[0], bodyForIndex(0), true);
  }
  await pushRow(ids[0], r, `1/${ids.length}`);

  for (let i = 1; i < ids.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, BETWEEN_SENDS_MS));
    const r2 = await sendOne(ids[i], bodyForIndex(i), false);
    await pushRow(ids[i], r2, `${i + 1}/${ids.length}`);
  }

  return rows;
}
