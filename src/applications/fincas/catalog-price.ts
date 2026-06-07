export type CatalogPriceFields = {
  /** Precio regular en Meta (se muestra tachado si hay sale_price). */
  price: string;
  /** Precio con descuento / precio actual. Vacío si no aplica. */
  sale_price: string;
};

/**
 * Meta/WhatsApp Commerce: `price` = precio original (tachado),
 * `sale_price` = precio actual cuando priceOriginal > priceBase.
 */
export function buildCatalogPriceFields(
  priceBase: number | undefined,
  priceOriginal?: number | undefined,
): CatalogPriceFields {
  const base = Math.max(0, Math.floor(priceBase ?? 0));
  const original = Math.max(0, Math.floor(priceOriginal ?? 0));
  if (original > 0 && original > base) {
    return {
      price: `${original} COP`,
      sale_price: `${base} COP`,
    };
  }
  return {
    price: `${base} COP`,
    sale_price: '',
  };
}
