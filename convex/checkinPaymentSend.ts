"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendImageToYcloud, sendTextToYcloud } from "./lib/ycloud/senders";

function normalizeOutboundPhone(raw: string | undefined | null): string {
  const cleaned = String(raw ?? "").replace(/[^\d]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 10 && cleaned.startsWith("3")) return `57${cleaned}`;
  return cleaned;
}

async function resolveImageBytes(
  imageUrl: string,
): Promise<{ buffer: Uint8Array; mimeType: string; filename: string }> {
  const dataMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (dataMatch) {
    const mimeType = dataMatch[1];
    const buffer = Uint8Array.from(Buffer.from(dataMatch[2], "base64"));
    const ext = mimeType.split("/")[1]?.split("+")[0] || "jpg";
    return { buffer, mimeType, filename: `pago.${ext}` };
  }

  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la imagen (${res.status})`);
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const ext = mimeType.split("/")[1]?.split("+")[0] || "jpg";
  return { buffer, mimeType, filename: `pago.${ext}` };
}

/**
 * Envía resumen de pago + imágenes (QR/flyer) por WhatsApp Business (YCloud)
 * al celular de la reserva.
 */
export const sendPaymentSummaryToBooking = action({
  args: {
    bookingId: v.id("bookings"),
    messageText: v.string(),
    images: v.array(
      v.object({
        label: v.optional(v.string()),
        imageUrl: v.string(),
      }),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const b = await ctx.runQuery(internal.checkinMessaging.getBookingForSend, {
      bookingId: args.bookingId,
    });
    if (!b) {
      return { ok: false as const, error: "Reserva no encontrada" };
    }

    const to = normalizeOutboundPhone(b.celular);
    if (!to) {
      return {
        ok: false as const,
        error: "La reserva no tiene un celular valido.",
      };
    }

    if (args.dryRun) {
      return {
        ok: true as const,
        dryRun: true,
        to,
        preview: args.messageText,
        imageCount: args.images.length,
      };
    }

    try {
      const { wamid, status } = await sendTextToYcloud({
        to,
        text: args.messageText,
        sendDirectly: true,
      });

      await ctx.runMutation(internal.checkinMessaging.logTemplateToInbox, {
        phone: to,
        name: b.nombreCompleto,
        content: args.messageText,
        wamid,
      });

      let imagesSent = 0;
      const imageErrors: string[] = [];

      for (const image of args.images) {
        try {
          const { buffer, mimeType, filename } = await resolveImageBytes(
            image.imageUrl,
          );
          await sendImageToYcloud({
            to,
            imageBuffer: buffer,
            mimeType,
            filename,
            caption: image.label?.trim() || "Medios de pago FincasYa",
          });
          imagesSent++;
          await new Promise((resolve) => setTimeout(resolve, 350));
        } catch (err) {
          imageErrors.push(
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      return {
        ok: true as const,
        to,
        wamid,
        status,
        imagesSent,
        imageErrors: imageErrors.length > 0 ? imageErrors : undefined,
      };
    } catch (e) {
      return {
        ok: false as const,
        to,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
