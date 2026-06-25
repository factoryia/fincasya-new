import { BadRequestException, Injectable } from '@nestjs/common';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function assertPublicUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid url');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new BadRequestException('Unsupported protocol');
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) {
    throw new BadRequestException('Blocked host');
  }

  if (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) ||
    host.endsWith('.local')
  ) {
    throw new BadRequestException('Blocked host');
  }

  return parsed;
}

@Injectable()
export class CorsProxyService {
  async fetch(url: string): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
    const parsed = assertPublicUrl(url);
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch from url: ${response.statusText}`,
      );
    }

    return {
      buffer: await response.arrayBuffer(),
      contentType: response.headers.get('content-type'),
    };
  }

  async head(
    url: string,
  ): Promise<{ contentLength: string | null; contentType: string | null }> {
    const parsed = assertPublicUrl(url);
    const response = await fetch(parsed.toString(), { method: 'HEAD' });

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to HEAD from url: ${response.statusText}`,
      );
    }

    return {
      contentLength: response.headers.get('content-length'),
      contentType: response.headers.get('content-type'),
    };
  }
}
