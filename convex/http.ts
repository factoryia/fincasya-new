import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./betterAuth/auth";
import { internal } from "./_generated/api";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Webhook YCloud: recibe mensajes entrantes de WhatsApp
// URL en YCloud: https://<tu-deployment>.convex.site/webhooks/ycloud
http.route({
  path: "/webhooks/ycloud",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
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
      parsed.type === "whatsapp.inbound_message.received" &&
      parsed.whatsappInboundMessage
    ) {
      const evt = parsed.whatsappInboundMessage;
      const eventId = parsed.id ?? `evt_${Date.now()}`;
      const phone = evt.from ?? "";
      const name = (evt.customerProfile?.name ?? "").trim() || phone;
      const wamid = evt.wamid ?? evt.id;

      let content = "";
      let msgType: "text" | "image" | "audio" | "video" | "document" = "text";
      let mediaUrl = "";

      if (evt.type === "text" && evt.text?.body) {
        content = String(evt.text.body).trim();
        msgType = "text";
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
        content = (evt.document.caption ?? evt.document.filename ?? "").trim() || "[Documento]";
        msgType = "document";
        mediaUrl = evt.document.link;
      }

      if (phone && (content || mediaUrl)) {
        const dedupe = await ctx.runMutation(
          internal.ycloud.recordProcessedEvent,
          { eventId }
        );
        if (dedupe.duplicate) {
          console.log("YCloud: evento duplicado, skip", { eventId, phone });
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
      outbound.type === "whatsapp.outbound_message.sent" &&
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
        message: "Webhook recibido correctamente",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }),
});

// GET para verificar que el webhook está activo
http.route({
  path: "/webhooks/ycloud",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(
      JSON.stringify({
        message: "Webhook YCloud activo",
        webhookUrl: "POST a esta misma URL con el body de YCloud",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }),
});

export default http;
