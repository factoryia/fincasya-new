"use node";

import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';

type CreateTokenResult = { token: string; isNew: boolean };
type FillTokenResult =
  | { ok: false; reason: 'not_found' | 'already_filled' | 'expired' }
  | { ok: true; conversationId?: Id<'conversations'>; source?: 'inbox' | 'admin' };
type SendContractFillLinkResult = { ok: true; token: string; link: string };
type ProcessFillSubmitResult =
  | { ok: false; reason: 'not_found' | 'already_filled' | 'expired' }
  | { ok: true };

/** URL del frontend Next.js (FincasYaWeb), NO el API Nest en app.fincasya.cloud. */
function contractFillPublicBaseUrl(): string {
  return (
    process.env.CONTRACT_FILL_BASE_URL ??
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://fincasya.com'
  ).replace(/\/$/, '');
}

/**
 * Crea el token y devuelve el link público del formulario.
 * El envío al cliente lo hace Nest vía `inbox:sendMessage` (misma ruta que un mensaje manual).
 */
export const prepareContractFillLink = action({
  args: {
    conversationId: v.id('conversations'),
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    cupo: v.optional(v.number()),
    precioTotal: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SendContractFillLinkResult> => {
    const { token } = (await ctx.runMutation(internal.contractFillTokens.createToken, {
      conversationId: args.conversationId,
      propertyTitle: args.propertyTitle,
      propertyLocation: args.propertyLocation,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
      cupo: args.cupo,
      precioTotal: args.precioTotal,
    })) as CreateTokenResult;

    const link = `${contractFillPublicBaseUrl()}/contrato/${token}`;
    return { ok: true, token, link };
  },
});

/** Crea link de contrato desde el módulo admin (borrador completo sin datos del cliente). */
export const prepareAdminContractLink = internalAction({
  args: {
    contractDraftJson: v.string(),
    contractSettingsJson: v.string(),
    propertyMetaJson: v.string(),
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    cupo: v.optional(v.number()),
    precioTotal: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SendContractFillLinkResult> => {
    const { token } = (await ctx.runMutation(
      internal.contractFillTokens.createAdminToken,
      args,
    )) as CreateTokenResult;

    const link = `${contractFillPublicBaseUrl()}/contrato/${token}`;
    return { ok: true, token, link };
  },
});

/**
 * Acción invocada por el HTTP endpoint POST /api/contract-fill/:token (Convex http.ts)
 * después de recibir los datos del cliente. Guarda los datos y notifica al asesor.
 */
export const processFillSubmit = internalAction({
  args: {
    token: v.string(),
    nombre: v.string(),
    cedula: v.string(),
    email: v.string(),
    telefono: v.string(),
    direccion: v.string(),
    ciudad: v.optional(v.string()),
    cedulaPhotoUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<ProcessFillSubmitResult> => {
    const result = (await ctx.runMutation(internal.contractFillTokens.fillToken, {
      token: args.token,
      nombre: args.nombre,
      cedula: args.cedula,
      email: args.email,
      telefono: args.telefono,
      direccion: args.direccion,
      ciudad: args.ciudad,
      cedulaPhotoUrls: args.cedulaPhotoUrls,
    })) as FillTokenResult;

    if (!result.ok) return result;

    await ctx.runMutation(internal.contacts.upsertFromContractFillForm, {
      conversationId: result.conversationId,
      nombre: args.nombre,
      cedula: args.cedula,
      email: args.email,
      telefono: args.telefono,
      direccion: args.direccion,
      ciudad: args.ciudad,
      cedulaPhotoUrls: args.cedulaPhotoUrls,
    });

    if (result.conversationId) {
      // Notifica al asesor en el inbox con los datos listos
      const summary = [
        `📋 *Datos de contrato completados por el cliente*`,
        `👤 ${args.nombre} · CC ${args.cedula}`,
        `📧 ${args.email} · 📱 ${args.telefono}`,
        `🏠 ${args.direccion}${args.ciudad ? `, ${args.ciudad}` : ''}`,
        ...(args.cedulaPhotoUrls?.length
          ? [`🪪 Fotos cédula: ${args.cedulaPhotoUrls.join('\n')}`]
          : []),
        ``,
        `✅ Datos listos para generar el contrato desde el panel.`,
      ].join('\n');

      await ctx.runMutation(internal.messages.insertSystemMessage, {
        conversationId: result.conversationId,
        content: summary,
        createdAt: Date.now(),
      });
    }

    return { ok: true };
  },
});
