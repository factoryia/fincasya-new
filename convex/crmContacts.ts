/**
 * CRM contacts listing with streak/frequency segmentation.
 *
 * Read-only query — reads from contacts + bookings. No writes to existing tables.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { textMatchesSearchTerm } from "./lib/searchText";

export type CrmContactRow = {
  _id: Id<"contacts">;
  name: string;
  phone: string;
  email?: string;
  cedula?: string;
  city?: string;
  crmType?: "lead" | "client";
  fechaNacimiento?: string;
  dataConsentStatus?: "granted" | "denied";
  totalBookings: number;
  ltv: number;
  lastBookingAt?: number;
  streakLabel: "frecuente" | "intermedio" | "nuevo" | "inactivo";
  birthdayThisMonth: boolean;
  createdAt: number;
};

type BookingStats = {
  count: number;
  ltv: number;
  lastAt?: number;
};

function computeStreakLabel(
  totalBookings: number,
  lastBookingAt: number | undefined,
): CrmContactRow["streakLabel"] {
  if (totalBookings === 0) return "nuevo";
  const now = Date.now();
  const sixMonths = 180 * 24 * 60 * 60 * 1000;
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  if (lastBookingAt && now - lastBookingAt > oneYear) return "inactivo";
  if (totalBookings >= 3) return "frecuente";
  if (totalBookings >= 1 && lastBookingAt && now - lastBookingAt < sixMonths)
    return "intermedio";
  return "nuevo";
}

function isBirthdayThisMonth(
  fechaNacimiento: string | undefined,
): boolean {
  if (!fechaNacimiento) return false;
  const parts = fechaNacimiento.split("-");
  if (parts.length < 2) return false;
  const month = parseInt(parts[1], 10);
  const currentMonth = new Date().getMonth() + 1;
  return month === currentMonth;
}

function mergeBookingStats(
  map: Map<string, BookingStats>,
  key: string | undefined,
  booking: Doc<"bookings">,
) {
  if (!key) return;
  const existing = map.get(key) ?? { count: 0, ltv: 0, lastAt: undefined };
  const amount = Math.max(0, Math.floor(Number(booking.precioTotal) || 0));
  const entryAt = booking.fechaEntrada ?? 0;
  map.set(key, {
    count: existing.count + 1,
    ltv: existing.ltv + amount,
    lastAt:
      existing.lastAt == null
        ? entryAt
        : Math.max(existing.lastAt, entryAt),
  });
}

function contactMatchesSearch(contact: Doc<"contacts">, search: string): boolean {
  if (!search) return true;
  return (
    textMatchesSearchTerm(contact.name ?? "", search) ||
    textMatchesSearchTerm(contact.phone ?? "", search) ||
    textMatchesSearchTerm(contact.email ?? "", search) ||
    textMatchesSearchTerm(contact.cedula ?? "", search)
  );
}

function buildBookingStatsByContact(
  bookings: Doc<"bookings">[],
): Map<Id<"contacts">, BookingStats> {
  const byContact = new Map<Id<"contacts">, BookingStats>();
  for (const booking of bookings) {
    if (booking.status === "CANCELLED") continue;
    if (!booking.userId) continue;
    mergeBookingStats(
      byContact as Map<string, BookingStats>,
      String(booking.userId),
      booking,
    );
  }
  return byContact;
}

export const listForCrm = query({
  args: {
    search: v.optional(v.string()),
    streakFilter: v.optional(
      v.union(
        v.literal("frecuente"),
        v.literal("intermedio"),
        v.literal("nuevo"),
        v.literal("inactivo"),
        v.literal("all"),
      ),
    ),
    birthdayMonth: v.optional(v.boolean()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    /** @deprecated Usar page/pageSize */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = args.search?.trim() ?? "";
    const page = Math.max(1, Math.floor(args.page ?? 1));
    const pageSize = Math.min(
      Math.max(args.pageSize ?? args.limit ?? 25, 1),
      100,
    );
    const offset = (page - 1) * pageSize;

    const [allContacts, allBookings] = await Promise.all([
      ctx.db.query("contacts").collect(),
      ctx.db.query("bookings").collect(),
    ]);

    const bookingsByContact = buildBookingStatsByContact(allBookings);
    const rows: CrmContactRow[] = [];

    let statsTotal = 0;
    let statsClients = 0;
    let statsFrecuentes = 0;
    let statsBirthdays = 0;
    let statsTotalLtv = 0;

    for (const contact of allContacts) {
      if (contact.dataConsentStatus === "denied") continue;
      if (!contactMatchesSearch(contact, search)) continue;

      const stats = bookingsByContact.get(contact._id) ?? {
        count: 0,
        ltv: 0,
        lastAt: undefined,
      };
      const streakLabel = computeStreakLabel(stats.count, stats.lastAt);
      const birthdayThisMonth = isBirthdayThisMonth(contact.fechaNacimiento);

      if (args.streakFilter && args.streakFilter !== "all") {
        if (streakLabel !== args.streakFilter) continue;
      }
      if (args.birthdayMonth && !birthdayThisMonth) continue;

      statsTotal += 1;
      if (contact.crmType === "client") statsClients += 1;
      if (streakLabel === "frecuente") statsFrecuentes += 1;
      if (birthdayThisMonth) statsBirthdays += 1;
      statsTotalLtv += stats.ltv;

      rows.push({
        _id: contact._id,
        name: contact.name ?? "Sin nombre",
        phone: contact.phone,
        email: contact.email,
        cedula: contact.cedula,
        city: contact.city,
        crmType: contact.crmType,
        fechaNacimiento: contact.fechaNacimiento,
        dataConsentStatus: contact.dataConsentStatus,
        totalBookings: stats.count,
        ltv: stats.ltv,
        lastBookingAt: stats.lastAt,
        streakLabel,
        birthdayThisMonth,
        createdAt: contact.createdAt,
      });
    }

    rows.sort((a, b) => b.ltv - a.ltv || b.createdAt - a.createdAt);

    const total = rows.length;
    const pageRows = rows.slice(offset, offset + pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return {
      rows: pageRows,
      total,
      page,
      pageSize,
      totalPages,
      stats: {
        total: statsTotal,
        clients: statsClients,
        frecuentes: statsFrecuentes,
        birthdays: statsBirthdays,
        totalLtv: statsTotalLtv,
      },
    };
  },
});
