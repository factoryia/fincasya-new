"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBookingFromCalendar = exports.syncBookingToCalendar = exports.exchangeCodeForTokens = exports.generateAuthUrl = exports.disconnect = exports.saveTokens = exports.getForSync = exports.get = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
async function refreshGoogleToken(refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        console.error("Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en Convex");
        return null;
    }
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
    });
    try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });
        if (!res.ok) {
            const err = await res.text();
            console.error("Error al refrescar token de Google:", res.status, err);
            return null;
        }
        return res.json();
    }
    catch (error) {
        console.error("Excepción al refrescar token de Google:", error);
        return null;
    }
}
exports.get = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const row = await ctx.db.query("googleCalendarIntegrations").first();
        if (!row)
            return null;
        return {
            connected: row.connected,
            calendarId: row.calendarId,
            hasTokens: !!(row.accessToken || row.refreshToken),
            connectedEmail: row.connectedEmail,
            connectedName: row.connectedName,
        };
    },
});
exports.getForSync = (0, server_1.internalQuery)({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("googleCalendarIntegrations").first();
    },
});
exports.saveTokens = (0, server_1.mutation)({
    args: {
        accessToken: values_1.v.string(),
        refreshToken: values_1.v.optional(values_1.v.string()),
        expiresAt: values_1.v.optional(values_1.v.number()),
        calendarId: values_1.v.optional(values_1.v.string()),
        connectedEmail: values_1.v.optional(values_1.v.string()),
        connectedName: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db.query("googleCalendarIntegrations").first();
        const payload = {
            accessToken: args.accessToken,
            refreshToken: args.refreshToken ?? existing?.refreshToken,
            expiresAt: args.expiresAt,
            calendarId: args.calendarId ?? existing?.calendarId ?? "primary",
            connected: true,
            connectedEmail: args.connectedEmail ?? existing?.connectedEmail,
            connectedName: args.connectedName ?? existing?.connectedName,
            updatedAt: now,
        };
        if (existing) {
            await ctx.db.patch(existing._id, payload);
            return existing._id;
        }
        return await ctx.db.insert("googleCalendarIntegrations", {
            ...payload,
            createdAt: now,
        });
    },
});
exports.disconnect = (0, server_1.mutation)({
    args: {},
    handler: async (ctx) => {
        const existing = await ctx.db.query("googleCalendarIntegrations").first();
        if (!existing)
            return null;
        await ctx.db.patch(existing._id, {
            accessToken: undefined,
            refreshToken: undefined,
            connected: false,
            connectedEmail: undefined,
            connectedName: undefined,
            updatedAt: Date.now(),
        });
        return existing._id;
    },
});
exports.generateAuthUrl = (0, server_1.action)({
    args: {
        redirectUri: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId)
            throw new Error("GOOGLE_CLIENT_ID no configurado");
        const scopes = [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "openid"
        ];
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: args.redirectUri,
            response_type: "code",
            scope: scopes.join(" "),
            access_type: "offline",
            prompt: "consent"
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    },
});
exports.exchangeCodeForTokens = (0, server_1.action)({
    args: {
        code: values_1.v.string(),
        redirectUri: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (!clientId || !clientSecret)
            throw new Error("Credenciales de Google no configuradas");
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code: args.code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: args.redirectUri,
                grant_type: "authorization_code",
            }).toString(),
        });
        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            throw new Error(`Google Token Error: ${err}`);
        }
        const tokens = await tokenRes.json();
        const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        let connectedEmail;
        let connectedName;
        if (profileRes.ok) {
            const profile = await profileRes.json();
            connectedEmail = profile.email;
            connectedName = profile.name;
        }
        await ctx.runMutation(api_1.api.googleCalendar.saveTokens, {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
            connectedEmail,
            connectedName,
        });
        return { ok: true, email: connectedEmail };
    },
});
exports.syncBookingToCalendar = (0, server_1.internalAction)({
    args: {
        bookingId: values_1.v.id("bookings"),
    },
    handler: async (ctx, args) => {
        const booking = await ctx.runQuery(api_1.api.bookings.getById, {
            id: args.bookingId,
        });
        if (!booking || booking.status === "CANCELLED")
            return;
        const gc = await ctx.runQuery(api_1.internal.googleCalendar.getForSync, {});
        if (!gc?.connected || !gc.refreshToken) {
            console.log("Google Calendar no conectado o sin refresh token");
            return;
        }
        let accessToken = gc.accessToken;
        if (!accessToken || (gc.expiresAt && gc.expiresAt < Date.now() + 60 * 1000)) {
            const refreshed = await refreshGoogleToken(gc.refreshToken);
            if (refreshed) {
                accessToken = refreshed.access_token;
                await ctx.runMutation(api_1.api.googleCalendar.saveTokens, {
                    accessToken: refreshed.access_token,
                    expiresAt: Date.now() + refreshed.expires_in * 1000,
                });
            }
            else {
                console.error("No se pudo refrescar el token de Google");
                return;
            }
        }
        const calendarId = gc.calendarId ?? "primary";
        const timezone = "America/Bogota";
        const summary = `Reserva: ${booking.property?.title || "Finca"} - ${booking.nombreCompleto}`;
        const description = [
            `Cliente: ${booking.nombreCompleto}`,
            `Cédula: ${booking.cedula}`,
            `Celular: ${booking.celular}`,
            `Correo: ${booking.correo}`,
            `Personas: ${booking.numeroPersonas}`,
            `Total: $${booking.precioTotal.toLocaleString("es-CO")}`,
            booking.observaciones ? `Observaciones: ${booking.observaciones}` : null,
        ]
            .filter(Boolean)
            .join("\n");
        const startDateTime = new Date(booking.fechaEntrada).toISOString();
        const endDateTime = new Date(booking.fechaSalida).toISOString();
        const url = booking.googleEventId
            ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.googleEventId)}`
            : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
        const method = booking.googleEventId ? "PATCH" : "POST";
        const res = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                summary,
                description,
                start: { dateTime: startDateTime, timeZone: timezone },
                end: { dateTime: endDateTime, timeZone: timezone },
                location: booking.property?.location || "",
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            console.error("Error sincronizando con Google Calendar:", res.status, err);
            return;
        }
        const event = (await res.json());
        if (event?.id && !booking.googleEventId) {
            await ctx.runMutation(api_1.api.bookings.update, {
                id: args.bookingId,
                googleEventId: event.id,
                googleCalendarId: calendarId,
            });
        }
    },
});
exports.deleteBookingFromCalendar = (0, server_1.internalAction)({
    args: {
        googleEventId: values_1.v.string(),
        googleCalendarId: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const gc = await ctx.runQuery(api_1.internal.googleCalendar.getForSync, {});
        if (!gc?.connected || !gc.refreshToken)
            return;
        let accessToken = gc.accessToken;
        if (!accessToken || (gc.expiresAt && gc.expiresAt < Date.now() + 60 * 1000)) {
            const refreshed = await refreshGoogleToken(gc.refreshToken);
            if (refreshed) {
                accessToken = refreshed.access_token;
                await ctx.runMutation(api_1.api.googleCalendar.saveTokens, {
                    accessToken: refreshed.access_token,
                    expiresAt: Date.now() + refreshed.expires_in * 1000,
                });
            }
            else {
                return;
            }
        }
        const calendarId = args.googleCalendarId || gc.calendarId || "primary";
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(args.googleEventId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
            const err = await res.text();
            console.error("Error eliminando evento de Google Calendar:", res.status, err);
        }
    },
});
//# sourceMappingURL=googleCalendar.js.map