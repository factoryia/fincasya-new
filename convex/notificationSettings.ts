import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/** Correos por defecto si no hay configuración guardada. */
const DEFAULT_PAYMENT_RECEIPT_EMAILS = [
  'fincasecoturisticasdelllano@gmail.com',
];

function normalizeEmails(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const email = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('notificationSettings')
      .withIndex('by_scope', (q) => q.eq('scope', 'global'))
      .first();
    const payload = (row?.payload ?? {}) as Record<string, unknown>;
    const stored = normalizeEmails(payload.paymentReceiptEmails);
    return {
      paymentReceiptEmails: stored.length
        ? stored
        : DEFAULT_PAYMENT_RECEIPT_EMAILS,
      isDefault: stored.length === 0,
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

export const setPaymentReceiptEmails = mutation({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, args) => {
    const emails = normalizeEmails(args.emails);
    const row = await ctx.db
      .query('notificationSettings')
      .withIndex('by_scope', (q) => q.eq('scope', 'global'))
      .first();
    const now = Date.now();
    if (row) {
      const payload = { ...(row.payload ?? {}), paymentReceiptEmails: emails };
      await ctx.db.patch(row._id, { payload, updatedAt: now });
    } else {
      await ctx.db.insert('notificationSettings', {
        scope: 'global',
        payload: { paymentReceiptEmails: emails },
        updatedAt: now,
      });
    }
    return { ok: true, paymentReceiptEmails: emails };
  },
});
