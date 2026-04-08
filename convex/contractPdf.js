"use node";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendContractPdfAndPaymentMethods = exports.contractDataValidator = void 0;
const pdf_lib_1 = require("pdf-lib");
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
exports.contractDataValidator = values_1.v.object({
    finca: values_1.v.string(),
    ubicacion: values_1.v.string(),
    nombre: values_1.v.string(),
    cedula: values_1.v.string(),
    celular: values_1.v.string(),
    correo: values_1.v.string(),
    ciudad: values_1.v.string(),
    direccion: values_1.v.string(),
    entradaHora: values_1.v.optional(values_1.v.string()),
    salidaHora: values_1.v.optional(values_1.v.string()),
    entrada: values_1.v.string(),
    salida: values_1.v.string(),
    noches: values_1.v.number(),
    precioTotal: values_1.v.number(),
});
function formatPrecio(n) {
    return new Intl.NumberFormat("es-CO", {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(n);
}
async function generateContractPdfBuffer(data) {
    const doc = await pdf_lib_1.PDFDocument.create();
    const font = await doc.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]);
    const margin = 50;
    let y = 792;
    const lineHeight = 18;
    const titleSize = 14;
    const bodySize = 10;
    const draw = (text, opts) => {
        const size = opts?.size ?? bodySize;
        const f = opts?.bold ? fontBold : font;
        page.drawText(text, { x: margin, y, size, font: f });
        y -= lineHeight;
    };
    draw("CONTRATO DE ARRENDAMIENTO TEMPORAL", { bold: true, size: titleSize });
    y -= 8;
    draw(`Inmueble: ${data.finca}, ubicación: ${data.ubicacion}.`);
    draw(`Arrendatario: ${data.nombre}, CC ${data.cedula}, ${data.ciudad}, ${data.direccion}.`);
    draw(`Contacto: ${data.celular}, ${data.correo}.`);
    draw(`Fechas: entrada ${data.entrada}, salida ${data.salida}.`);
    draw(`Noches: ${data.noches}.`);
    draw(`Precio total: $${formatPrecio(data.precioTotal)} COP (${data.noches} noche(s)).`);
    draw("Condiciones: abono 50% para confirmar, saldo 50% al recibir la finca. Depósito garantía y aseo según política.");
    draw("FincasYa.com");
    return await doc.save();
}
exports.sendContractPdfAndPaymentMethods = (0, server_1.internalAction)({
    args: {
        to: values_1.v.string(),
        wamid: values_1.v.optional(values_1.v.string()),
        contractData: exports.contractDataValidator,
        paymentMessageText: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const apiKey = process.env.YCLOUD_API_KEY;
        const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
        if (!apiKey || !wabaNumber) {
            throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
        }
        const pdfBuffer = await generateContractPdfBuffer(args.contractData);
        const filename = `Contrato-${args.contractData.finca.replace(/\s+/g, "-")}.pdf`;
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
        });
        if (!uploadRes.ok) {
            const errText = await uploadRes.text();
            throw new Error(`YCloud upload failed: ${uploadRes.status} - ${errText}`);
        }
        const uploadResult = (await uploadRes.json());
        const mediaId = uploadResult?.id;
        if (!mediaId) {
            throw new Error("YCloud upload did not return media id");
        }
        const docBody = {
            from: wabaNumber,
            to: args.to,
            type: "document",
            document: {
                id: mediaId,
                filename,
                caption: "Contrato de arrendamiento temporal – " + args.contractData.finca,
            },
        };
        if (args.wamid)
            docBody.context = { message_id: args.wamid };
        const docRes = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
            body: JSON.stringify(docBody),
        });
        if (!docRes.ok) {
            const errText = await docRes.text();
            throw new Error(`YCloud document send failed: ${docRes.status} - ${errText}`);
        }
        await ctx.runAction(api_1.internal.ycloud.sendWhatsAppMessage, {
            to: args.to,
            text: args.paymentMessageText,
            wamid: undefined,
            sendDirectly: true,
        });
    },
});
//# sourceMappingURL=contractPdf.js.map