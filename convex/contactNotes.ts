/**
 * Notas manuales del asesor sobre un contacto (CRM-1).
 *
 * Única tabla nueva de la Ficha 360. CRUD completo.
 * No toca contacts.ts, bookings.ts ni fincas.ts.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("contactNotes")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    contactId: v.id("contacts"),
    content: v.string(),
    authorUserId: v.optional(v.string()),
    authorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contacto no encontrado");
    const trimmed = args.content.trim();
    if (!trimmed) throw new Error("La nota no puede estar vacía");

    return ctx.db.insert("contactNotes", {
      contactId: args.contactId,
      content: trimmed,
      authorUserId: args.authorUserId,
      authorName: args.authorName,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    noteId: v.id("contactNotes"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new Error("Nota no encontrada");
    const trimmed = args.content.trim();
    if (!trimmed) throw new Error("La nota no puede estar vacía");

    await ctx.db.patch(args.noteId, {
      content: trimmed,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { noteId: v.id("contactNotes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new Error("Nota no encontrada");
    await ctx.db.delete(args.noteId);
  },
});
