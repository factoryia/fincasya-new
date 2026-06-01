export type YcloudMessageMediaType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document";

export type ParsedYcloudMessage = {
  content: string;
  msgType: YcloudMessageMediaType;
  mediaUrl?: string;
};

/** E.164 con + (mismo criterio que n8n / webhook entrante). */
export function normalizeWhatsappPhone(raw: string): string {
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  if (!s) return "";
  const digits = s.replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export function phoneDigits(raw: string): string {
  return normalizeWhatsappPhone(raw).replace(/\D/g, "");
}

/** Mensaje saliente del negocio (WABA) hacia el cliente. */
export function isOutboundFromBusiness(
  from: string | undefined,
  wabaNumber: string | undefined,
): boolean {
  const waba = phoneDigits(wabaNumber ?? "");
  const sender = phoneDigits(from ?? "");
  if (!waba || !sender) return true;
  return sender === waba;
}

type YcloudMessageBody = {
  type?: string;
  /** WhatsApp usa `{ body }`; en fallback defensivo a veces viene string en raíz. */
  text?: { body?: string } | string;
  image?: { link?: string; caption?: string };
  audio?: { link?: string };
  video?: { link?: string; caption?: string };
  document?: { link?: string; caption?: string; filename?: string };
  order?: {
    catalog_id?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number;
    }>;
    text?: string;
  };
  product_items?: unknown[];
  catalog_id?: string;
};

/** Extrae contenido y tipo desde payload YCloud (entrante u saliente). */
export function parseYcloudWhatsappBody(
  evt: YcloudMessageBody,
): ParsedYcloudMessage | null {
  let content = "";
  let msgType: YcloudMessageMediaType = "text";
  let mediaUrl: string | undefined;

  if (evt.type === "text" && evt.text) {
    const body =
      typeof evt.text === "string" ? evt.text : evt.text.body;
    const trimmed = String(body ?? "").trim();
    if (trimmed) {
      content = trimmed;
      msgType = "text";
    }
  } else if (evt.type === "image" && evt.image?.link) {
    content = (evt.image.caption ?? "").trim() || "[Imagen]";
    msgType = "image";
    mediaUrl = evt.image.link;
  } else if (evt.type === "audio" && evt.audio?.link) {
    content = "[Audio]";
    msgType = "audio";
    mediaUrl = evt.audio.link;
  } else if (evt.type === "video" && evt.video?.link) {
    content = (evt.video.caption ?? "").trim() || "[Video]";
    msgType = "video";
    mediaUrl = evt.video.link;
  } else if (evt.type === "document" && evt.document?.link) {
    content =
      (evt.document.caption ?? evt.document.filename ?? "").trim() ||
      "[Documento]";
    msgType = "document";
    mediaUrl = evt.document.link;
  } else if (evt.type === "order" && evt.order?.product_items?.length) {
    const firstItem = evt.order.product_items[0];
    const retailerId = firstItem?.product_retailer_id?.trim();
    const qty = firstItem?.quantity ?? 1;
    const catalogId = evt.order.catalog_id?.trim();
    const baseText =
      evt.order.text?.trim() || "Seleccioné una finca del catálogo.";
    content = retailerId
      ? `${baseText}\nproduct_retailer_id: ${retailerId}\nquantity: ${qty}${catalogId ? `\ncatalog_id: ${catalogId}` : ""}`
      : baseText;
    msgType = "text";
  } else {
    const productItems = Array.isArray(evt.product_items) ? evt.product_items : [];
    if (productItems.length > 0) {
      const firstItem = productItems[0] as {
        product_retailer_id?: string;
        quantity?: number;
      };
      const retailerId = String(firstItem?.product_retailer_id ?? "").trim();
      const qty = Number(firstItem?.quantity ?? 1);
      const catalogId = String(evt.catalog_id ?? "").trim();
      const rootText =
        typeof evt.text === "string" ? evt.text : "";
      const text =
        String(rootText).trim() || "Seleccioné una finca del catálogo.";
      content = retailerId
        ? `${text}\nproduct_retailer_id: ${retailerId}\nquantity: ${qty}${catalogId ? `\ncatalog_id: ${catalogId}` : ""}`
        : text;
      msgType = "text";
    }
  }

  const normalizedContent = String(content || "").trim();
  if (!normalizedContent && !mediaUrl) return null;
  return { content: normalizedContent || "[Mensaje]", msgType, mediaUrl };
}
