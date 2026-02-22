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
      };
      // Si YCloud envía eventos outbound (mensaje enviado por el negocio), podemos marcar como "human"
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
      const text =
        evt.type === "text" && evt.text?.body
          ? String(evt.text.body).trim()
          : "";
      const wamid = evt.wamid ?? evt.id;

      if (phone && text) {
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
            text,
            wamid,
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
