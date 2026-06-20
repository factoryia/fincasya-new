import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Get owner information for a specific property
 */
export const getByPropertyId = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('propertyOwnerInfo')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();
  },
});

/**
 * Get the properties owned by a specific user
 */
export const getOwnedProperties = query({
  args: { ownerUserId: v.string() },
  handler: async (ctx, args) => {
    const infos = await ctx.db
      .query('propertyOwnerInfo')
      .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
      .collect();

    if (infos.length === 0) return [];

    const properties = [];
    for (const info of infos) {
      const prop = await ctx.db.get(info.propertyId);
      if (prop) {
        properties.push({
          id: prop._id,
          title: prop.title,
          code: prop.code,
        });
      }
    }
    return properties;
  },
});

/**
 * Lista todos los propietarios que tienen al menos una cuenta bancaria guardada,
 * junto con el título/código de su finca. Para el buscador "agregar cuenta de un
 * propietario" en la configuración de medios de pago del check-in.
 */
export const listWithAccounts = query({
  args: {},
  handler: async (ctx) => {
    const infos = await ctx.db.query('propertyOwnerInfo').collect();
    const result: Array<{
      propertyId: string;
      propertyTitle: string;
      propertyCode: string | null;
      propietarioNombre: string;
      propietarioCedula: string;
      bankAccounts: Array<{
        bankName: string;
        accountNumber: string;
        accountType: string;
        accountHolderName: string;
      }>;
    }> = [];

    for (const info of infos) {
      const accounts = Array.isArray(info.bankAccounts) ? info.bankAccounts : [];
      const cleaned = accounts
        .map((a: any) => ({
          bankName: String(a?.bankName ?? '').trim(),
          accountNumber: String(a?.accountNumber ?? '').trim(),
          accountType: String(a?.accountType ?? '').trim(),
          accountHolderName: String(a?.accountHolderName ?? '').trim(),
        }))
        .filter((a) => a.bankName || a.accountNumber);
      if (cleaned.length === 0) continue;

      const prop = await ctx.db.get(info.propertyId);
      result.push({
        propertyId: info.propertyId as unknown as string,
        propertyTitle:
          (prop as { title?: string } | null)?.title ?? 'Sin nombre',
        propertyCode: (prop as { code?: string } | null)?.code ?? null,
        propietarioNombre: String(info.propietarioNombre ?? '').trim(),
        propietarioCedula: String(info.propietarioCedula ?? '').trim(),
        bankAccounts: cleaned,
      });
    }

    return result;
  },
});

/**
 * Upsert owner information for a property
 */
export const upsert = mutation({
  args: {
    propertyId: v.id('properties'),
    ownerUserId: v.string(),
    rutNumber: v.string(),
    bankName: v.string(),
    accountNumber: v.string(),
    bankAccounts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          bankName: v.string(),
          accountNumber: v.string(),
          accountType: v.optional(v.string()),
          accountHolderName: v.optional(v.string()),
        }),
      ),
    ),
    rntNumber: v.string(),
    propietarioNombre: v.optional(v.string()),
    propietarioTelefono: v.optional(v.string()),
    propietarioCedula: v.optional(v.string()),
    propietarioCorreo: v.optional(v.string()),
    checkinUbicacionUrl: v.optional(v.string()),
    checkinIndicacionesLlegada: v.optional(v.string()),
    checkinUbicacionImageUrl: v.optional(v.string()),
    checkinUbicacionImageUrls: v.optional(v.array(v.string())),
    bankCertificationUrl: v.optional(v.string()),
    idCopyUrl: v.optional(v.string()),
    rntPdfUrl: v.optional(v.string()),
    chamberOfCommerceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('propertyOwnerInfo')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();

    const timestamp = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: timestamp,
      });
      return existing._id;
    } else {
      return await ctx.db.insert('propertyOwnerInfo', {
        ...args,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  },
});
