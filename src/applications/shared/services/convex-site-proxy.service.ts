import { HttpException, Injectable } from '@nestjs/common';

/** Misma URL/key que FincasYaWeb `lib/convex-admin.ts` (prod Convex HTTP). */
const CONVEX_SITE_URL_DEFAULT =
  'https://adventurous-octopus-651.convex.site';
const CONVEX_ADMIN_API_KEY_DEFAULT = '1d968d083e0576de40173bb2c854a4f3';

@Injectable()
export class ConvexSiteProxyService {
  private getConfig(): { baseUrl: string; apiKey: string } {
    const baseUrl = (
      process.env.CONVEX_SITE_URL || CONVEX_SITE_URL_DEFAULT
    ).replace(/\/$/, '');
    const apiKey =
      process.env.CONVEX_ADMIN_API_KEY?.trim() ||
      process.env.YCLOUD_API_KEY?.trim() ||
      CONVEX_ADMIN_API_KEY_DEFAULT;
    return { baseUrl, apiKey };
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
