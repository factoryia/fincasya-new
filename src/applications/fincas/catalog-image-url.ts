/**
 * URLs de imagen para catálogo Meta/WhatsApp (feed CSV y sync API).
 * Redimensiona y comprime vía proxy — sin tocar S3.
 * JPG explícito: el scraper de WhatsApp/Meta suele fallar con WebP.
 */
export function buildCatalogImageUrl(rawUrl: string): string {
  const url = String(rawUrl ?? '').trim();
  if (!url.startsWith('http')) return url;
  if (url.includes('images.weserv.nl') || url.includes('/_next/image')) {
    return url;
  }
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=1200&h=1200&fit=cover&output=jpg&q=75`;
}

export function buildCatalogImageUrls(urls: string[]): string[] {
  return urls.filter(Boolean).map(buildCatalogImageUrl);
}
