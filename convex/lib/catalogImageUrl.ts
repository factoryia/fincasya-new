/** JPG vía proxy para catálogo Meta/WhatsApp (sin tocar S3). */
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
