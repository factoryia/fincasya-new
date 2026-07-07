import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

type PropertyImageDoc = Doc<'propertyImages'>;

/** Orden visual: `order` ascendente; empate por fecha de creación. */
export function sortPropertyImages<T extends { order?: number | null; _creationTime?: number; _id?: string }>(
  images: T[],
): T[] {
  return [...images].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    const timeDiff = (a._creationTime ?? 0) - (b._creationTime ?? 0);
    if (timeDiff !== 0) return timeDiff;
    return String(a._id ?? '').localeCompare(String(b._id ?? ''));
  });
}

export function getPrimaryPropertyImage(
  images: PropertyImageDoc[],
): PropertyImageDoc | null {
  const sorted = sortPropertyImages(images);
  return sorted[0] ?? null;
}

export function getPrimaryPropertyImageUrl(
  images: PropertyImageDoc[],
): string | null {
  const url = getPrimaryPropertyImage(images)?.url?.trim();
  return url || null;
}

export async function fetchPropertyImages(
  ctx: { db: QueryCtx['db'] },
  propertyId: Id<'properties'>,
): Promise<PropertyImageDoc[]> {
  const images = await ctx.db
    .query('propertyImages')
    .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
    .collect();
  return sortPropertyImages(images);
}

export async function fetchPrimaryPropertyImageUrl(
  ctx: { db: QueryCtx['db'] },
  propertyId: Id<'properties'>,
): Promise<string | null> {
  const images = await fetchPropertyImages(ctx, propertyId);
  return getPrimaryPropertyImageUrl(images);
}

/** Siguiente índice de orden al subir una imagen nueva (evita duplicar order 0). */
export async function nextPropertyImageOrder(
  ctx: { db: QueryCtx['db'] },
  propertyId: Id<'properties'>,
): Promise<number> {
  const images = await fetchPropertyImages(ctx, propertyId);
  if (images.length === 0) return 0;
  const maxOrder = Math.max(...images.map((img) => img.order ?? 0));
  return maxOrder + 1;
}
