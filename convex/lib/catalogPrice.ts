export type CatalogPriceFields = {
  price: string;
  sale_price: string;
};

/** Meta/WhatsApp: price = tachado, sale_price = precio actual. */
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
