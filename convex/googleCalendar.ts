import { v } from "convex/values";
import { action, internalAction, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

/** Fecha calendario en Colombia (YYYY-MM-DD) a partir de un timestamp ms. */
function calendarDateColombiaISO(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
  }).format(new Date(ms));
}

/**
 * Slot de 30 min para una reserva dentro de su día de ENTRADA. Cuenta cuántas
 * reservas del mismo día de entrada se crearon antes que esta (orden por
 * createdAt) → ese índice es el slot (0 = 00:00, 1 = 00:30, ...). Determinista.
 */
export const getCalendarSlotForDay = internalQuery({
  args: { fechaEntrada: v.number(), bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const dayIso = calendarDateColombiaISO(args.fechaEntrada);
    const target = await ctx.db.get(args.bookingId);
    const targetCreatedAt = target?.createdAt ?? Date.now();
    // Ventana amplia: todas las reservas que entran ese mismo día.
    const dayStart = new Date(`${dayIso}T00:00:00-05:00`).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const sameDay = await ctx.db
      .query("bookings")
      .withIndex("by_dates", (q) =>
        q.gte("fechaEntrada", dayStart).lt("fechaEntrada", dayEnd),
      )
      .collect();
    const before = sameDay.filter(
      (b) =>
        b.status !== "CANCELLED" &&
        calendarDateColombiaISO(b.fechaEntrada) === dayIso &&
        (b.createdAt < targetCreatedAt ||
          (b.createdAt === targetCreatedAt && b._id < args.bookingId)),
    );
    return before.length; // índice de slot
  },
});

/**
 * Refresca el access token de Google usando el refresh token almacenado.
 */
async function refreshGoogleToken(refreshToken: string): Promise<{ access_token?: string; expires_in?: number; error?: string } | null> {
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

    const data = await res.json();

    if (!res.ok) {
      console.error("Error al refrescar token de Google:", res.status, data);
      return { error: data.error || "unknown_error" };
    }
    return data;
  } catch (error) {
    console.error("Excepción al refrescar token de Google:", error);
    return null;
  }
}

// ============ QUERIES ============

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("googleCalendarIntegrations").first();
    if (!row) return null;
    return {
      connected: row.connected,
      calendarId: row.calendarId,
      hasTokens: !!(row.accessToken || row.refreshToken),
      connectedEmail: row.connectedEmail,
      connectedName: row.connectedName,
      needsReauth: row.needsReauth,
    };
  },
});

/** Solo para uso interno (actions) - contiene tokens. NO exponer al cliente. */
export const getForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("googleCalendarIntegrations").first();
  },
});

/** Email conectado antes de un nuevo OAuth (evita referencia circular en actions). */
export const getPreviousConnectedEmail = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | undefined> => {
    const row = await ctx.db.query("googleCalendarIntegrations").first();
    return row?.connectedEmail;
  },
});

type ExchangeCodeResult = {
  ok: true;
  email: string | undefined;
  previousEmail: string | undefined;
  accountChanged: boolean;
  shouldResync: boolean;
};

type ResyncAllResult = {
  ok: true;
  cleared: number;
  scheduled: number;
  calendarId: string;
  connectedEmail: string | undefined;
};

// ============ MUTATIONS ============

export const saveTokens = mutation({
  args: {
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    calendarId: v.optional(v.string()),
    connectedEmail: v.optional(v.string()),
    connectedName: v.optional(v.string()),
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
      needsReauth: false,
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

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("googleCalendarIntegrations").first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      accessToken: undefined,
      refreshToken: undefined,
      connected: false,
      connectedEmail: undefined,
      connectedName: undefined,
      needsReauth: false,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});

export const setNeedsReauth = mutation({
  args: { needsReauth: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("googleCalendarIntegrations").first();
    if (existing) {
      await ctx.db.patch(existing._id, { needsReauth: args.needsReauth });
    }
  },
});

// ============ ACTIONS ============

/**
 * Genera la URL de autorización para el frontend.
 */
export const generateAuthUrl = action({
  args: {
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID no configurado");

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

/**
 * Intercambia el código por tokens y perfil de usuario.
 */
export const exchangeCodeForTokens = action({
  args: {
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args): Promise<ExchangeCodeResult> => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Credenciales de Google no configuradas");
    }

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
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let connectedEmail: string | undefined;
    let connectedName: string | undefined;

    if (profileRes.ok) {
      const profile = await profileRes.json();
      connectedEmail = profile.email;
      connectedName = profile.name;
    }

    const previousEmailRaw = await ctx.runQuery(
      internal.googleCalendar.getPreviousConnectedEmail,
      {},
    );
    const previousEmail = previousEmailRaw ?? undefined;

    await ctx.runMutation(api.googleCalendar.saveTokens, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      calendarId: "primary",
      connectedEmail,
      connectedName,
    });

    const accountChanged =
      Boolean(previousEmail) &&
      Boolean(connectedEmail) &&
      previousEmail !== connectedEmail;

    return {
      ok: true,
      email: connectedEmail,
      previousEmail,
      accountChanged,
      shouldResync: accountChanged,
    };
  },
});

export const syncBookingToCalendar = internalAction({
  args: {
    bookingId: v.id("bookings"),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.runQuery(api.bookings.getById, {
      id: args.bookingId,
    });
    if (!booking || booking.status === "CANCELLED") return;

    const gc = await ctx.runQuery(internal.googleCalendar.getForSync, {});
    if (!gc?.connected || !gc.refreshToken) {
        console.log("Google Calendar no conectado o sin refresh token");
        return;
    }

    let accessToken = gc.accessToken;
    // Refrescar si expiró o está por expirar
    if (!accessToken || (gc.expiresAt && gc.expiresAt < Date.now() + 60 * 1000)) {
      const refreshed = await refreshGoogleToken(gc.refreshToken);
      if (refreshed?.access_token) {
        accessToken = refreshed.access_token;
        await ctx.runMutation(api.googleCalendar.saveTokens, {
          accessToken: refreshed.access_token,
          expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
        });
      } else {
          if (refreshed?.error === "invalid_grant") {
            await ctx.runMutation(api.googleCalendar.setNeedsReauth, { needsReauth: true });
          }
          console.error("No se pudo refrescar el token de Google:", refreshed?.error);
          return;
      }
    }

    const calendarId = gc.calendarId ?? "primary";
    const timezone = "America/Bogota";
    const eventBelongsToCurrentCalendar =
      Boolean(booking.googleEventId) &&
      (!booking.googleCalendarId || booking.googleCalendarId === calendarId);

    // Número de noches (para título y descripción).
    const noches =
      (booking as { numeroNoches?: number }).numeroNoches ??
      Math.max(
        1,
        Math.round(
          (booking.fechaSalida - booking.fechaEntrada) /
            (24 * 60 * 60 * 1000),
        ),
      );
    const nochesTxt = `${String(noches).padStart(2, "0")} ${
      noches === 1 ? "NOCHE" : "NOCHES"
    }`;

    // Título del evento: "{código} {NOMBRE CLIENTE}, {FINCA 4 PALABRAS}, {NN NOCHE(S)}".
    // `calendarLabel`: si viene definido reemplaza a "Reserva:"; si viene vacío
    // ("") no se antepone nada; si es undefined (reservas viejas) usa "Reserva:".
    const rawLabel = (booking as { calendarLabel?: string }).calendarLabel;
    const label = rawLabel === undefined ? "Reserva:" : rawLabel.trim();
    const cliente = (booking.nombreCompleto || "").toUpperCase();
    // Solo las primeras 4 palabras del nombre de la finca (sin el código final).
    const finca = (booking.property?.title || "Finca")
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(" ");
    const cuerpo = `${cliente}, ${finca}, ${nochesTxt}`;
    const summary = label ? `${label} ${cuerpo}` : cuerpo;

    const description = [
      `Cliente: ${booking.nombreCompleto}`,
      `Cédula: ${booking.cedula}`,
      `Celular: ${booking.celular}`,
      `Correo: ${booking.correo}`,
      `Personas: ${booking.numeroPersonas}`,
      `Noches: ${noches}`,
      `Total: $${booking.precioTotal.toLocaleString("es-CO")}`,
      booking.observaciones ? `Observaciones: ${booking.observaciones}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // El evento se ubica en el DÍA DE ENTRADA, en un bloque de 30 min apilado
    // desde medianoche (00:00, 00:30, 01:00...) según el orden de creación de
    // las reservas de ese mismo día. Así varias fincas del mismo día no se
    // solapan en bloques gigantes; la duración real va como "Noches: N".
    const SLOT_MIN = 30;
    const slot = (await ctx.runQuery(
      internal.googleCalendar.getCalendarSlotForDay,
      { fechaEntrada: booking.fechaEntrada, bookingId: args.bookingId },
    )) as number;
    const dayStartUtcMs = new Date(
      `${calendarDateColombiaISO(booking.fechaEntrada)}T00:00:00-05:00`,
    ).getTime();
    const startMs = dayStartUtcMs + slot * SLOT_MIN * 60 * 1000;
    const endMs = startMs + SLOT_MIN * 60 * 1000;
    const startDateTime = new Date(startMs).toISOString();
    const endDateTime = new Date(endMs).toISOString();

    const eventBody = {
      summary,
      description,
      start: { dateTime: startDateTime, timeZone: timezone },
      end: { dateTime: endDateTime, timeZone: timezone },
      location: booking.property?.location || "",
    };

    const createEvent = async () => {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventBody),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        console.error("Error creando evento en Google Calendar:", res.status, err);
        return null;
      }
      return (await res.json()) as { id?: string };
    };

    if (!eventBelongsToCurrentCalendar) {
      const event = await createEvent();
      if (event?.id) {
        await ctx.runMutation(internal.bookings.setGoogleCalendarLink, {
          id: args.bookingId,
          googleEventId: event.id,
          googleCalendarId: calendarId,
        });
      }
      return;
    }

    const patchUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(booking.googleEventId!)}`;
    let res = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventBody),
    });

    if (res.status === 404) {
      const event = await createEvent();
      if (event?.id) {
        await ctx.runMutation(internal.bookings.setGoogleCalendarLink, {
          id: args.bookingId,
          googleEventId: event.id,
          googleCalendarId: calendarId,
        });
      }
      return;
    }

    if (!res.ok) {
      const err = await res.text();
      console.error("Error sincronizando con Google Calendar:", res.status, err);
      return;
    }

    const event = (await res.json()) as { id?: string };
    if (event?.id && !booking.googleEventId) {
      await ctx.runMutation(internal.bookings.setGoogleCalendarLink, {
        id: args.bookingId,
        googleEventId: event.id,
        googleCalendarId: calendarId,
      });
    }
  },
});

export const resyncAllBookingsToCalendar = action({
  args: {
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ResyncAllResult> => {
    const gc = await ctx.runQuery(internal.googleCalendar.getForSync, {});
    if (!gc?.connected || !gc.refreshToken) {
      throw new Error("Google Calendar no conectado");
    }

    const clearResult = await ctx.runMutation(
      internal.bookings.clearAllGoogleCalendarLinks,
      {},
    );
    const cleared = clearResult.cleared;

    const bookings = await ctx.runQuery(internal.bookings.listForCalendarResync, {
      includePast: args.includePast ?? true,
    });

    let scheduled = 0;
    for (const booking of bookings) {
      await ctx.scheduler.runAfter(
        scheduled * 150,
        internal.googleCalendar.syncBookingToCalendar,
        { bookingId: booking._id },
      );
      scheduled++;
    }

    return {
      ok: true,
      cleared,
      scheduled,
      calendarId: gc.calendarId ?? "primary",
      connectedEmail: gc.connectedEmail,
    };
  },
});

export const deleteBookingFromCalendar = internalAction({
  args: {
    googleEventId: v.string(),
    googleCalendarId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const gc = await ctx.runQuery(internal.googleCalendar.getForSync, {});
    if (!gc?.connected || !gc.refreshToken) return;

    let accessToken = gc.accessToken;
    if (!accessToken || (gc.expiresAt && gc.expiresAt < Date.now() + 60 * 1000)) {
      const refreshed = await refreshGoogleToken(gc.refreshToken);
      if (refreshed?.access_token) {
        accessToken = refreshed.access_token;
        await ctx.runMutation(api.googleCalendar.saveTokens, {
          accessToken: refreshed.access_token,
          expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
        });
      } else {
          if (refreshed?.error === "invalid_grant") {
            await ctx.runMutation(api.googleCalendar.setNeedsReauth, { needsReauth: true });
          }
          return;
      }
    }

    const calendarId = args.googleCalendarId || gc.calendarId || "primary";
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(args.googleEventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!res.ok) {
        const err = await res.text();
        console.error("Error eliminando evento de Google Calendar:", res.status, err);
    }
  },
});
