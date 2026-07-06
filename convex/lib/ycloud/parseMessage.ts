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
  sticker?: { link?: string };
  document?: { link?: string; caption?: string; filename?: string };
  reaction?: { emoji?: string; message_id?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    body?: { text?: string };
    button_reply?: { title?: string; id?: string };
    list_reply?: { title?: string; description?: string; id?: string };
    action?: { catalog_id?: string; product_retailer_id?: string };
  };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
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

/** Eco de ficha de catálogo WhatsApp — no persistir como mensaje de texto en inbox. */
export function isCatalogInteractiveEcho(evt: {
  type?: string;
  interactive?: { type?: string };
}): boolean {
  if (evt.type !== "interactive" || !evt.interactive) return false;
  const t = String(evt.interactive.type ?? "").toLowerCase();
  return (
    t === "product" || t === "product_list" || t === "catalog_message"
  );
}

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
  } else if (evt.type === "sticker" && evt.sticker?.link) {
    content = "[Sticker]";
    msgType = "image";
    mediaUrl = evt.sticker.link;
  } else if (evt.type === "reaction" && evt.reaction) {
    const emoji = String(evt.reaction.emoji ?? "").trim();
    content = emoji ? `Reacción: ${emoji}` : "[Reacción eliminada]";
    msgType = "text";
  } else if (evt.type === "button" && evt.button) {
    const label = String(evt.button.text ?? evt.button.payload ?? "").trim();
    if (!label) return null;
    content = label;
    msgType = "text";
  } else if (evt.type === "interactive" && evt.interactive) {
    const ir = evt.interactive;
    const interactiveType = String(ir.type ?? "").toLowerCase();

    // Tarjetas de catálogo / producto (salientes o clic "Ver Finca"): no crear mensaje fantasma.
    if (
      interactiveType === "product" ||
      interactiveType === "product_list" ||
      interactiveType === "catalog_message"
    ) {
      return null;
    }

    const label =
      ir.button_reply?.title ??
      ir.list_reply?.title ??
      ir.list_reply?.description ??
      ir.button_reply?.id ??
      ir.list_reply?.id ??
      "";
    const trimmed = String(label).trim();
    if (!trimmed) return null;
    content = trimmed;
    msgType = "text";
  } else if (evt.type === "location" && evt.location) {
    const name = String(evt.location.name ?? evt.location.address ?? "").trim();
    const coords = `${evt.location.latitude ?? ""}, ${evt.location.longitude ?? ""}`;
    content = name ? `📍 ${name}` : `📍 Ubicación (${coords})`;
    msgType = "text";
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
