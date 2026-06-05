import { HttpException, Injectable } from '@nestjs/common';

/** Misma URL/key que FincasYaWeb `lib/convex-production.ts` (quemado por ahora). */
const CONVEX_SITE_URL =
  'https://adventurous-octopus-651.convex.site';
const CONVEX_ADMIN_API_KEY = '9c4729daf24f97b8adac2965af19d3a4';

@Injectable()
export class ConvexSiteProxyService {
  private getConfig(): { baseUrl: string; apiKey: string } {
    return { baseUrl: CONVEX_SITE_URL.replace(/\/$/, ''), apiKey: CONVEX_ADMIN_API_KEY };
  }

  async forwardJson(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    convexPath: string,
    body?: unknown,
  ): Promise<unknown> {
    const { baseUrl, apiKey } = this.getConfig();
    const res = await fetch(`${baseUrl}${convexPath}`, {
      method,
      headers: {
        'X-API-Key': apiKey,
        ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let payload: unknown = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: text || res.statusText };
    }
    if (!res.ok) {
      throw new HttpException(payload as object, res.status);
    }
    return payload;
  }
}
