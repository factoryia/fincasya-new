import { FALLBACK_CATALOG_ID, MAX_CATALOG_PRODUCTS_PER_SEND } from "./constants";

/** Filas devueltas al orquestador: alinea cada producto con el wamid del mensaje enviado (si la API lo devolvió). */
export type CatalogOutboundSendRow = {
  productRetailerId: string;
  wamid?: string;
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
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(body),
  });
  const textRes = await res.text();
  if (!res.ok) throw new Error(`YCloud error ${res.status}: ${textRes}`);
  return JSON.parse(textRes);
}

const SEND_DIRECTLY = "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly";
const BETWEEN_SENDS_MS = 320;

/** Cuerpo cuando no hay línea de precio pero sí hay más fichas (sin numerar ni texto interno). */
const BODY_WHEN_QUOTE_MISSING = "Aquí va otra opción 🏡";

/**
 * Envía **una tarjeta de producto por finca** (interactive type `product`), no `product_list`.
 * Máximo `MAX_CATALOG_PRODUCTS_PER_SEND` por llamada para alinear con la política comercial.
 */
export async function sendCatalogToYcloud(args: {
  to: string;
  productRetailerIds: string[];
  /** Una línea por id (ej. 💰 Para tus fechas…); si viene, es el cuerpo de cada mensaje `interactive`. */
  productQuoteLines?: string[];
  bodyText?: string;
  catalogId?: string;
  wamid?: string;
}): Promise<CatalogOutboundSendRow[]> {
  const ids = args.productRetailerIds.slice(0, MAX_CATALOG_PRODUCTS_PER_SEND);
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
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  };

  const parsedBodies: unknown[] = [];

  let r = await sendOne(ids[0], bodyForIndex(0), true);
  const invalidCatalog =
    !r.ok &&
    r.status === 400 &&
    /invalid.*catalog|131009/i.test(r.text);
  if (invalidCatalog && catalogId !== FALLBACK_CATALOG_ID) {
    catalogId = FALLBACK_CATALOG_ID;
    r = await sendOne(ids[0], bodyForIndex(0), true);
  }
  if (!r.ok) throw new Error(`YCloud error ${r.status}: ${r.text}`);
  try {
    parsedBodies.push(JSON.parse(r.text));
  } catch {
    parsedBodies.push({ raw: r.text });
  }

  for (let i = 1; i < ids.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, BETWEEN_SENDS_MS));
    const r2 = await sendOne(ids[i], bodyForIndex(i), false);
    if (!r2.ok) {
      throw new Error(`YCloud error (ficha ${i + 1}/${ids.length}) ${r2.status}: ${r2.text}`);
    }
    try {
      parsedBodies.push(JSON.parse(r2.text));
    } catch {
      parsedBodies.push({ raw: r2.text });
    }
  }

  return ids.map((productRetailerId, i) => ({
    productRetailerId,
    wamid: wamidFromYcloudSendResponse(parsedBodies[i]),
  }));
}
