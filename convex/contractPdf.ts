"use node";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/** Datos para rellenar el contrato de arrendamiento (extraídos del bloque CONTRACT_PDF del LLM). */
export const contractDataValidator = v.object({
  finca: v.string(),
  ubicacion: v.string(),
  nombre: v.string(),
  cedula: v.string(),
  celular: v.string(),
  correo: v.string(),
  entrada: v.string(),
  salida: v.string(),
  noches: v.number(),
  precioTotal: v.number(),
});

export type ContractData = {
  finca: string;
  ubicacion: string;
  nombre: string;
  cedula: string;
  celular: string;
  correo: string;
  entrada: string;
  salida: string;
  noches: number;
  precioTotal: number;
};

function formatPrecio(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Genera el PDF del contrato de arrendamiento temporal y devuelve el buffer (base64).
 * Se usa desde sendContractPdfAndPaymentMethods.
 */
async function generateContractPdfBuffer(data: ContractData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]); // A4
  const margin = 50;
  let y = 792;
  const lineHeight = 18;
  const titleSize = 14;
  const bodySize = 10;

  const draw = (text: string, opts?: { bold?: boolean; size?: number }) => {
    const size = opts?.size ?? bodySize;
    const f = opts?.bold ? fontBold : font;
    page.drawText(text, { x: margin, y, size, font: f });
    y -= lineHeight;
  };

  draw("CONTRATO DE ARRENDAMIENTO TEMPORAL", { bold: true, size: titleSize });
  y -= 8;
  draw(`Inmueble: ${data.finca}, ubicación: ${data.ubicacion}.`);
  draw(`Arrendatario: ${data.nombre}, CC ${data.cedula}, cel ${data.celular}, ${data.correo}.`);
  draw(`Fechas: entrada ${data.entrada}, salida ${data.salida}.`);
  draw(`Noches: ${data.noches}.`);
  draw(`Precio total: $${formatPrecio(data.precioTotal)} COP (${data.noches} noche(s)).`);
  draw("Condiciones: abono 50% para confirmar, saldo 50% al recibir la finca. Depósito garantía y aseo según política.");
  draw("FincasYa.com");

  return await doc.save();
}

/**
 * Sube el PDF a YCloud, envía el documento por WhatsApp y luego el mensaje de métodos de pago.
 */
export const sendContractPdfAndPaymentMethods = internalAction({
  args: {
    to: v.string(),
    wamid: v.optional(v.string()),
    contractData: contractDataValidator,
    paymentMessageText: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
    }

    const pdfBuffer = await generateContractPdfBuffer(args.contractData);
    const filename = `Contrato-${args.contractData.finca.replace(/\s+/g, "-")}.pdf`;

    // Upload media: YCloud v2 POST /whatsapp/media/{phoneNumber}/upload (phoneNumber = sender WABA)
    const form = new FormData();
    const arrayBuffer = new ArrayBuffer(pdfBuffer.byteLength);
    new Uint8Array(arrayBuffer).set(pdfBuffer);
    form.append("file", new Blob([arrayBuffer], { type: "application/pdf" }), filename);

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
    if (!mediaId) {
      throw new Error("YCloud upload did not return media id");
    }

    // Send document message
    const docBody: Record<string, unknown> = {
      from: wabaNumber,
      to: args.to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption: "Contrato de arrendamiento temporal – " + args.contractData.finca,
      },
    };
    if (args.wamid) docBody.context = { message_id: args.wamid };

    const docRes = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(docBody),
    });
    if (!docRes.ok) {
      const errText = await docRes.text();
      throw new Error(`YCloud document send failed: ${docRes.status} - ${errText}`);
    }

    // Send payment methods text
    await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
      to: args.to,
      text: args.paymentMessageText,
      wamid: undefined,
      sendDirectly: true,
    });
  },
});
