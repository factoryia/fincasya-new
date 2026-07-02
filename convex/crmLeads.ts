import { internalMutation } from './_generated/server';
import { v } from 'convex/values';

/**
 * Upsert check-in guests into the contacts table as leads.
 * Called after submitCheckin to ensure every guest with identifiable info
 * (cedula or phone) becomes a CRM contact.
 */
export const upsertGuestsAsLeads = internalMutation({
  args: {
    guests: v.array(
      v.object({
        nombreCompleto: v.string(),
        cedula: v.optional(v.string()),
        email: v.optional(v.string()),
        fechaNacimiento: v.optional(v.string()),
        telefono: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { guests }) => {
    const now = Date.now();
    let created = 0;
    let enriched = 0;

    for (const guest of guests) {
      if (!guest.nombreCompleto) continue;
      const cedula = guest.cedula?.trim() || undefined;
      const phone = guest.telefono?.trim() || undefined;
      const email = guest.email?.trim().toLowerCase() || undefined;
      const fechaNacimiento = guest.fechaNacimiento?.trim() || undefined;

      let existing = null;

      if (cedula) {
        existing = await ctx.db
          .query('contacts')
          .withIndex('by_cedula', (q) => q.eq('cedula', cedula))
          .first();
      }

      if (!existing && phone) {
        existing = await ctx.db
          .query('contacts')
          .withIndex('by_phone', (q) => q.eq('phone', phone))
          .first();
      }

      if (existing) {
        const patch: Record<string, unknown> = {};
        if (email && !existing.email) patch.email = email;
        if (fechaNacimiento && !existing.fechaNacimiento)
          patch.fechaNacimiento = fechaNacimiento;
        if (cedula && !existing.cedula) patch.cedula = cedula;
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = now;
          await ctx.db.patch(existing._id, patch);
          enriched++;
        }
        continue;
      }

      if (!phone) continue;

      await ctx.db.insert('contacts', {
        phone,
        name: guest.nombreCompleto,
        cedula,
        email,
        fechaNacimiento,
        crmType: 'lead' as const,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }

    return { created, enriched };
  },
});
