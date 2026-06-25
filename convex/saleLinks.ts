import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Genera token UUID aleatorio (v4 sin dependencias). */
function generateToken(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type PaymentProofRecord = {
  url: string;
  fileName?: string;
  mimeType?: string;
  amount?: number;
  submittedAt: number;
};

function resolvePaymentProofs(link: {
  paymentProofs?: PaymentProofRecord[];
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  paymentProofMimeType?: string;
  paymentProofAmount?: number;
  paymentProofSubmittedAt?: number;
}): PaymentProofRecord[] {
  if (link.paymentProofs?.length) return link.paymentProofs;
  if (link.paymentProofUrl) {
    return [
      {
        url: link.paymentProofUrl,
        fileName: link.paymentProofFileName,
        mimeType: link.paymentProofMimeType,
        amount: link.paymentProofAmount,
        submittedAt: link.paymentProofSubmittedAt ?? Date.now(),
      },
    ];
  }
  return [];
}

function mapPaymentProofsForPortal(link: Parameters<typeof resolvePaymentProofs>[0]) {
  return resolvePaymentProofs(link).map((proof) => ({
    fileName: proof.fileName,
    mimeType: proof.mimeType,
    amount: proof.amount,
    submittedAt: proof.submittedAt,
  }));
}

const OWNER_ACCOUNT_PREFIX = 'owner:';

type BankAccount = {
  id: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  ownerName: string;
  ownerCedula?: string;
  imageUrls?: string[];
  qrOnly?: boolean;
  brebKey?: boolean;
};

/** Mapea cuentas del propietario seleccionadas (ids con prefijo owner:). */
function mapOwnerBankAccounts(
  ownerInfo: Doc<'propertyOwnerInfo'>,
  selectedIds: string[],
): BankAccount[] {
  const ownerIds = selectedIds.filter((id) => id.startsWith(OWNER_ACCOUNT_PREFIX));
  if (ownerIds.length === 0) return [];

  const propietarioNombre = ownerInfo.propietarioNombre?.trim() ?? '';
  const propietarioCedula = ownerInfo.propietarioCedula?.trim() ?? '';

  type OwnerRow = {
    id: string;
    bankName: string;
    accountNumber: string;
    accountType?: string;
    accountHolderName?: string;
  };

  let rows: OwnerRow[] = [];
  if (ownerInfo.bankAccounts?.length) {
    rows = ownerInfo.bankAccounts.map((account) => ({
      id: account.id,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountType: account.accountType,
      accountHolderName: account.accountHolderName,
    }));
  } else if (ownerInfo.bankName || ownerInfo.accountNumber) {
    rows = [
      {
        id: 'primary',
        bankName: ownerInfo.bankName,
        accountNumber: ownerInfo.accountNumber,
        accountType: '',
        accountHolderName: propietarioNombre,
      },
    ];
  }

  return rows
    .filter((row) => ownerIds.includes(`${OWNER_ACCOUNT_PREFIX}${row.id}`))
    .map((row) => ({
      id: `${OWNER_ACCOUNT_PREFIX}${row.id}`,
      bankName: row.bankName,
      accountType: row.accountType?.trim() || 'Ahorros',
      accountNumber: row.accountNumber,
      ownerName: row.accountHolderName?.trim() || propietarioNombre,
      ownerCedula: propietarioCedula,
      imageUrls: [] as string[],
    }));
}

/** URLs de imágenes de la finca (tabla propertyImages). */
async function getPropertyImageUrls(
  ctx: any,
  propertyId: Id<'properties'>,
): Promise<string[]> {
  const images = await ctx.db
    .query('propertyImages')
    .withIndex('by_property', (q: any) => q.eq('propertyId', propertyId))
    .collect();

  return images
    .sort((a: Doc<'propertyImages'>, b: Doc<'propertyImages'>) =>
      (a.order ?? 0) - (b.order ?? 0),
    )
    .map((img: Doc<'propertyImages'>) => img.url?.trim())
    .filter((url: string | undefined): url is string => !!url);
}

/** Resuelve los datos de la propiedad para mostrar al cliente. */
async function resolveProperty(ctx: any, propertyId: Id<'properties'>) {
  const prop = await ctx.db.get(propertyId);
  if (!prop) return null;
  const images = await getPropertyImageUrls(ctx, propertyId);
  return {
    id: prop._id,
    title: prop.title ?? '',
    location: prop.location ?? '',
    code: prop.code ?? '',
    slug: prop.slug ?? '',
    images,
    maxGuests: prop.capacity ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Admin mutations (llamados desde NestJS con API key)
// ---------------------------------------------------------------------------

export const create = internalMutation({
  args: {
    propertyId: v.id('properties'),
    createdBy: v.string(),
    createdByName: v.optional(v.string()),
    checkIn: v.number(),
    checkOut: v.number(),
    nights: v.number(),
    guests: v.number(),
    checkInTime: v.optional(v.string()),
    checkOutTime: v.optional(v.string()),
    totalValue: v.number(),
    rentalValue: v.number(),
    depositAmount: v.number(),
    cleaningFee: v.number(),
    petDeposit: v.optional(v.number()),
    petSurcharge: v.optional(v.number()),
    petCount: v.optional(v.number()),
    selectedBankAccountIds: v.array(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const token = generateToken();
    const now = Date.now();
    const id = await ctx.db.insert('saleLinks', {
      token,
      ...args,
      clientStep: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    return { id, token };
  },
});

export const update = internalMutation({
  args: {
    id: v.id('saleLinks'),
    propertyId: v.optional(v.id('properties')),
    checkIn: v.optional(v.number()),
    checkOut: v.optional(v.number()),
    nights: v.optional(v.number()),
    guests: v.optional(v.number()),
    checkInTime: v.optional(v.string()),
    checkOutTime: v.optional(v.string()),
    totalValue: v.optional(v.number()),
    rentalValue: v.optional(v.number()),
    depositAmount: v.optional(v.number()),
    cleaningFee: v.optional(v.number()),
    petDeposit: v.optional(v.number()),
    petSurcharge: v.optional(v.number()),
    petCount: v.optional(v.number()),
    selectedBankAccountIds: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    status: v.optional(v.union(v.literal('active'), v.literal('completed'), v.literal('cancelled'))),
  },
  handler: async (ctx, { id, ...patch }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('Sale link not found');
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const remove = internalMutation({
  args: { id: v.id('saleLinks') },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return { ok: true };
  },
});

export const setContractUrl = internalMutation({
  args: {
    id: v.id('saleLinks'),
    contractUrl: v.string(),
  },
  handler: async (ctx, { id, contractUrl }) => {
    await ctx.db.patch(id, {
      contractUrl,
      contractGeneratedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const setCrUrl = internalMutation({
  args: {
    id: v.id('saleLinks'),
    crUrl: v.string(),
    bookingId: v.optional(v.id('bookings')),
  },
  handler: async (ctx, { id, crUrl, bookingId }) => {
    const patch: Record<string, unknown> = {
      crUrl,
      crGeneratedAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (bookingId) patch.bookingId = bookingId;
    await ctx.db.patch(id, patch);
  },
});

export const validatePayment = internalMutation({
  args: {
    token: v.string(),
    validatedBy: v.string(),
    validationKey: v.string(),
  },
  handler: async (ctx, { token, validatedBy, validationKey }) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.paymentValidationKey !== validationKey) {
      return { ok: false, reason: 'invalid_key' };
    }
    if (link.paymentValidated) return { ok: true, alreadyValidated: true };
    await ctx.db.patch(link._id, {
      paymentValidated: true,
      paymentValidatedAt: Date.now(),
      paymentValidatedBy: validatedBy,
      clientStep: 4,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export const list = internalQuery({
  args: {
    createdBy: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { createdBy, status }) => {
    let docs: Doc<'saleLinks'>[];
    if (createdBy) {
      docs = await ctx.db
        .query('saleLinks')
        .withIndex('by_created_by', (q) => q.eq('createdBy', createdBy))
        .order('desc')
        .collect();
    } else {
      docs = await ctx.db.query('saleLinks').order('desc').collect();
    }
    if (status) {
      docs = docs.filter((d) => d.status === status);
    }
    return docs;
  },
});

export const getById = internalQuery({
  args: { id: v.id('saleLinks') },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

export const getByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
  },
});

// ---------------------------------------------------------------------------
// Public mutations (llamados desde el portal cliente, sin auth)
// ---------------------------------------------------------------------------

/** Guarda borrador del portal (paso 2) sin avanzar clientStep — sincroniza entre dispositivos. */
export const saveClientPortalDraft = internalMutation({
  args: {
    token: v.string(),
    clientPortalUiStep: v.optional(v.number()),
    clientDraftPhase: v.optional(
      v.union(v.literal('datos'), v.literal('pago')),
    ),
    nombre: v.optional(v.string()),
    cedula: v.optional(v.string()),
    email: v.optional(v.string()),
    telefono: v.optional(v.string()),
    direccion: v.optional(v.string()),
    ciudad: v.optional(v.string()),
    paymentAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.status !== 'active') return { ok: false, reason: 'inactive' };
    if (link.paymentValidated) return { ok: false, reason: 'already_validated' };
    if (link.clientStep >= 4) return { ok: false, reason: 'past_payment_step' };

    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };

    if (args.clientPortalUiStep !== undefined) {
      patch.clientPortalUiStep = Math.max(1, Math.min(6, args.clientPortalUiStep));
    }
    if (args.clientDraftPhase) {
      patch.clientDraftPhase = args.clientDraftPhase;
    }
    if (args.paymentAmount !== undefined && args.paymentAmount > 0) {
      patch.clientDraftPaymentAmount = args.paymentAmount;
    }

    const nombre = args.nombre?.trim();
    const cedula = args.cedula?.trim();
    const email = args.email?.trim();
    const telefono = args.telefono?.trim();
    const direccion = args.direccion?.trim();
    const ciudad = args.ciudad?.trim();
    const hasAnyField = !!(nombre || cedula || email || telefono || direccion || ciudad);

    if (hasAnyField) {
      const prev = link.clientData;
      patch.clientData = {
        nombre: nombre || prev?.nombre || '',
        cedula: cedula || prev?.cedula || '',
        email: email || prev?.email || '',
        telefono: telefono || prev?.telefono || '',
        direccion: direccion || prev?.direccion || '',
        ciudad: ciudad || prev?.ciudad,
        filledAt: prev?.filledAt ?? now,
      };
    }

    await ctx.db.patch(link._id, patch);
    return { ok: true };
  },
});

/** Guarda los datos del cliente + soporte de pago (paso 2 → 3). */
export const submitClientData = mutation({
  args: {
    token: v.string(),
    nombre: v.string(),
    cedula: v.string(),
    email: v.string(),
    telefono: v.string(),
    direccion: v.string(),
    ciudad: v.optional(v.string()),
    paymentProofUrl: v.string(),
    paymentProofFileName: v.optional(v.string()),
    paymentProofMimeType: v.optional(v.string()),
    paymentProofAmount: v.optional(v.number()),
    paymentValidationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.status !== 'active') return { ok: false, reason: 'inactive' };
    if (link.paymentValidated) return { ok: false, reason: 'already_validated' };
    if (link.clientStep >= 4) return { ok: false, reason: 'past_payment_step' };

    const now = Date.now();
    const newProof: PaymentProofRecord = {
      url: args.paymentProofUrl,
      fileName: args.paymentProofFileName,
      mimeType: args.paymentProofMimeType,
      amount: args.paymentProofAmount,
      submittedAt: now,
    };
    const paymentProofs = [...resolvePaymentProofs(link), newProof];
    const isFirstSubmission = link.clientStep < 3;

    const patch: Record<string, unknown> = {
      clientData: {
        nombre: args.nombre,
        cedula: args.cedula,
        email: args.email,
        telefono: args.telefono,
        direccion: args.direccion,
        ciudad: args.ciudad,
        filledAt: link.clientData?.filledAt ?? now,
      },
      paymentProofUrl: args.paymentProofUrl,
      paymentProofFileName: args.paymentProofFileName,
      paymentProofMimeType: args.paymentProofMimeType,
      paymentProofAmount: args.paymentProofAmount,
      paymentProofSubmittedAt: now,
      paymentProofs,
      paymentValidationKey: args.paymentValidationKey,
      updatedAt: now,
    };

    if (isFirstSubmission) {
      patch.clientStep = 3;
      patch.clientPortalUiStep = undefined;
      patch.clientDraftPhase = undefined;
      patch.clientDraftPaymentAmount = undefined;
    }

    await ctx.db.patch(link._id, patch);
    return { ok: true, appended: !isFirstSubmission };
  },
});

/** Admin: reinicia comprobante y datos de cliente para volver a probar el flujo. */
export const resetPaymentSubmission = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.paymentValidated) return { ok: false, reason: 'already_validated' };
    if (!link.paymentProofUrl && link.clientStep < 3) {
      return { ok: false, reason: 'nothing_to_reset' };
    }

    await ctx.db.patch(link._id, {
      clientStep: 1,
      clientPortalUiStep: undefined,
      clientDraftPhase: undefined,
      clientDraftPaymentAmount: undefined,
      clientData: undefined,
      paymentProofUrl: undefined,
      paymentProofFileName: undefined,
      paymentProofMimeType: undefined,
      paymentProofAmount: undefined,
      paymentProofSubmittedAt: undefined,
      paymentProofs: undefined,
      paymentValidationKey: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** El cliente sube el contrato firmado (paso 4 → 5). */
export const submitSignedContract = mutation({
  args: {
    token: v.string(),
    signedContractUrl: v.string(),
    signedContractFileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.clientStep < 4) return { ok: false, reason: 'not_ready' };

    const now = Date.now();
    await ctx.db.patch(link._id, {
      signedContractUrl: args.signedContractUrl,
      signedContractFileName: args.signedContractFileName,
      signedContractSubmittedAt: now,
      clientStep: 5,
      updatedAt: now,
    });
    return { ok: true };
  },
});

/** El cliente confirma haber descargado/visto el CR (paso 5 → 6). */
export const confirmCr = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.clientStep < 5) return { ok: false, reason: 'not_ready' };

    await ctx.db.patch(link._id, {
      clientStep: 6,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

type SaleLinkCheckinResult =
  | { ok: true; bookingId: Id<'bookings'> }
  | { ok: false; reason: string; index?: number };

type CreateFromSaleLinkResult =
  | { ok: true; bookingId: Id<'bookings'> }
  | { ok: false; reason: 'not_found' | 'no_client' | 'unavailable' };

async function finalizeSaleLinkCheckin(
  ctx: MutationCtx,
  link: Doc<'saleLinks'>,
  args: {
    guests: Array<{
      nombreCompleto: string;
      cedula?: string;
      tipoDocumento?: string;
      esMenor?: boolean;
    }>;
    placas?: string;
    observaciones?: string;
  },
): Promise<SaleLinkCheckinResult> {
  if (args.guests.length < 1) {
    return { ok: false as const, reason: 'missing_guests' as const };
  }
  for (let i = 0; i < args.guests.length; i++) {
    const g = args.guests[i];
    if (!g.nombreCompleto.trim()) {
      return { ok: false as const, reason: 'missing_name' as const, index: i };
    }
    if (!g.esMenor && !g.cedula?.trim()) {
      return { ok: false as const, reason: 'missing_document' as const, index: i };
    }
  }

  const menoresDe2 = args.guests.filter((g) => g.esMenor).length;
  const guestDisplayName =
    args.guests
      .map((g) => g.nombreCompleto.trim())
      .filter(Boolean)
      .join(' · ') ||
    link.clientData?.nombre ||
    'Cliente';

  const bookingResult = (await ctx.runMutation(internal.bookings.createFromSaleLink, {
    saleLinkId: link._id,
    guestDisplayName,
    guests: args.guests,
    menoresDe2: menoresDe2 || undefined,
    mascotas: link.petCount ?? undefined,
    placas: args.placas,
    observaciones: args.observaciones,
  })) as CreateFromSaleLinkResult;

  if (!bookingResult.ok) {
    return bookingResult;
  }

  const now = Date.now();
  await ctx.db.patch(link._id, {
    checkinGuests: args.guests,
    checkinMenoresDe2: menoresDe2 || undefined,
    checkinMascotas: link.petCount ?? undefined,
    checkinPlacas: args.placas,
    checkinObservaciones: args.observaciones,
    checkinCompleted: true,
    checkinCompletedAt: now,
    bookingId: bookingResult.bookingId,
    status: 'completed',
    updatedAt: now,
  });

  return { ok: true as const, bookingId: bookingResult.bookingId };
}

/** El cliente envía el check-in (paso 6 → completado). */
export const submitCheckin = mutation({
  args: {
    token: v.string(),
    guests: v.array(
      v.object({
        nombreCompleto: v.string(),
        cedula: v.optional(v.string()),
        tipoDocumento: v.optional(v.string()),
        esMenor: v.optional(v.boolean()),
      }),
    ),
    menoresDe2: v.optional(v.number()),
    mascotas: v.optional(v.number()),
    placas: v.optional(v.string()),
    observaciones: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.clientStep < 6) return { ok: false, reason: 'not_ready' };

    return finalizeSaleLinkCheckin(ctx, link, {
      guests: args.guests,
      placas: args.placas,
      observaciones: args.observaciones,
    });
  },
});

// ---------------------------------------------------------------------------
// Public query (portal del cliente)
// ---------------------------------------------------------------------------

/** InternalMutation: confirmar CR desde HTTP route */
export const confirmCrInternal = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.clientStep < 5) return { ok: false, reason: 'not_ready' };
    await ctx.db.patch(link._id, {
      clientStep: 6,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/** InternalMutation: check-in desde HTTP route */
export const submitCheckinInternal = internalMutation({
  args: {
    token: v.string(),
    guests: v.array(
      v.object({
        nombreCompleto: v.string(),
        cedula: v.optional(v.string()),
        tipoDocumento: v.optional(v.string()),
        esMenor: v.optional(v.boolean()),
      }),
    ),
    menoresDe2: v.optional(v.number()),
    mascotas: v.optional(v.number()),
    placas: v.optional(v.string()),
    observaciones: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
    if (!link) return { ok: false, reason: 'not_found' };
    if (link.clientStep < 6) return { ok: false, reason: 'not_ready' };

    return finalizeSaleLinkCheckin(ctx, link, {
      guests: args.guests,
      placas: args.placas,
      observaciones: args.observaciones,
    });
  },
});

/** Query pública para el portal del cliente (React hooks). */
export const getPublicByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!link) return null;

    const property = await resolveProperty(ctx, link.propertyId);
    const settings = await ctx.db
      .query('adminContractSettings')
      .withIndex('by_scope', (q) => q.eq('scope', 'global'))
      .unique();

    let bankAccounts: BankAccount[] = [];
    if (settings?.payload?.bankAccounts && link.selectedBankAccountIds.length > 0) {
      const allAccounts = settings.payload.bankAccounts as BankAccount[];
      const globalIds = link.selectedBankAccountIds.filter(
        (id) => !id.startsWith(OWNER_ACCOUNT_PREFIX),
      );
      bankAccounts = allAccounts.filter((a) => globalIds.includes(a.id));
    }
    if (
      link.selectedBankAccountIds.some((id) => id.startsWith(OWNER_ACCOUNT_PREFIX))
    ) {
      const ownerInfo = await ctx.db
        .query('propertyOwnerInfo')
        .withIndex('by_property', (q) => q.eq('propertyId', link.propertyId))
        .unique();
      if (ownerInfo) {
        bankAccounts = [
          ...bankAccounts,
          ...mapOwnerBankAccounts(ownerInfo, link.selectedBankAccountIds),
        ];
      }
    }

    return {
      token: link.token,
      status: link.status,
      clientStep: link.clientStep,
      clientPortalUiStep: link.clientPortalUiStep,
      clientDraftPhase: link.clientDraftPhase,
      clientDraftPaymentAmount: link.clientDraftPaymentAmount,
      property,
      checkIn: link.checkIn,
      checkOut: link.checkOut,
      nights: link.nights,
      guests: link.guests,
      checkInTime: link.checkInTime,
      checkOutTime: link.checkOutTime,
      totalValue: link.totalValue,
      rentalValue: link.rentalValue,
      depositAmount: link.depositAmount,
      cleaningFee: link.cleaningFee,
      petDeposit: link.petDeposit,
      petSurcharge: link.petSurcharge,
      petCount: link.petCount,
      bankAccounts,
      clientDataFilled: !!link.clientData,
      clientName: link.clientData?.nombre,
      clientData: link.clientData
        ? {
            nombre: link.clientData.nombre,
            cedula: link.clientData.cedula,
            email: link.clientData.email,
            telefono: link.clientData.telefono,
            direccion: link.clientData.direccion,
            ciudad: link.clientData.ciudad,
          }
        : undefined,
      paymentProofSubmitted: !!link.paymentProofUrl,
      paymentProofFileName: link.paymentProofFileName,
      paymentProofSubmittedAt: link.paymentProofSubmittedAt,
      paymentProofAmount: link.paymentProofAmount,
      paymentProofs: mapPaymentProofsForPortal(link),
      paymentValidated: !!link.paymentValidated,
      contractUrl: link.contractUrl,
      signedContractSubmitted: !!link.signedContractUrl,
      crUrl: link.crUrl,
      checkinCompleted: link.checkinCompleted,
      checkinGuests: link.checkinGuests,
    };
  },
});

/** InternalQuery equivalente para HTTP routes (mismo output que getPublicByToken). */
export const getForPortal = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query('saleLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique();
    if (!link) return null;

    const property = await resolveProperty(ctx, link.propertyId);
    const settings = await ctx.db
      .query('adminContractSettings')
      .withIndex('by_scope', (q) => q.eq('scope', 'global'))
      .unique();

    let bankAccounts: BankAccount[] = [];
    if (settings?.payload?.bankAccounts && link.selectedBankAccountIds.length > 0) {
      const allAccounts = settings.payload.bankAccounts as BankAccount[];
      const globalIds = link.selectedBankAccountIds.filter(
        (id) => !id.startsWith(OWNER_ACCOUNT_PREFIX),
      );
      bankAccounts = allAccounts.filter((a) => globalIds.includes(a.id));
    }
    if (
      link.selectedBankAccountIds.some((id) => id.startsWith(OWNER_ACCOUNT_PREFIX))
    ) {
      const ownerInfo = await ctx.db
        .query('propertyOwnerInfo')
        .withIndex('by_property', (q) => q.eq('propertyId', link.propertyId))
        .unique();
      if (ownerInfo) {
        bankAccounts = [
          ...bankAccounts,
          ...mapOwnerBankAccounts(ownerInfo, link.selectedBankAccountIds),
        ];
      }
    }

    return {
      token: link.token,
      status: link.status,
      clientStep: link.clientStep,
      clientPortalUiStep: link.clientPortalUiStep,
      clientDraftPhase: link.clientDraftPhase,
      clientDraftPaymentAmount: link.clientDraftPaymentAmount,
      property,
      checkIn: link.checkIn,
      checkOut: link.checkOut,
      nights: link.nights,
      guests: link.guests,
      checkInTime: link.checkInTime,
      checkOutTime: link.checkOutTime,
      totalValue: link.totalValue,
      rentalValue: link.rentalValue,
      depositAmount: link.depositAmount,
      cleaningFee: link.cleaningFee,
      petDeposit: link.petDeposit,
      petSurcharge: link.petSurcharge,
      petCount: link.petCount,
      bankAccounts,
      clientDataFilled: !!link.clientData,
      clientName: link.clientData?.nombre,
      clientData: link.clientData
        ? {
            nombre: link.clientData.nombre,
            cedula: link.clientData.cedula,
            email: link.clientData.email,
            telefono: link.clientData.telefono,
            direccion: link.clientData.direccion,
            ciudad: link.clientData.ciudad,
          }
        : undefined,
      paymentProofSubmitted: !!link.paymentProofUrl,
      paymentProofFileName: link.paymentProofFileName,
      paymentProofSubmittedAt: link.paymentProofSubmittedAt,
      paymentProofAmount: link.paymentProofAmount,
      paymentProofs: mapPaymentProofsForPortal(link),
      paymentValidated: !!link.paymentValidated,
      contractUrl: link.contractUrl,
      signedContractSubmitted: !!link.signedContractUrl,
      crUrl: link.crUrl,
      checkinCompleted: link.checkinCompleted,
      checkinGuests: link.checkinGuests,
    };
  },
});
