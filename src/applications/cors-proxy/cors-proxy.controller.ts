import {
  BadRequestException,
  Controller,
  Get,
  Head,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CorsProxyService } from './cors-proxy.service';

/**
 * En producción, nginx envía `/api/*` a Nest. El handler equivalente en
 * FincasYaWeb (`app/api/cors-proxy/route.ts`) solo aplica en dev o cuando
 * Next atiende `/api` directamente.
 */
@Controller('cors-proxy')
export class CorsProxyController {
  constructor(private readonly corsProxy: CorsProxyService) {}

  private setProxyHeaders(res: Response, upstream: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges, x-file-size',
    );

    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
  }

  @Get()
  async get(
    @Query('url') url: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!url?.trim()) {
      throw new BadRequestException('Missing url parameter');
    }

    try {
      const range =
        typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const upstream = await this.corsProxy.fetch(url, { range });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      this.setProxyHeaders(res, upstream);
      return res.status(upstream.status).send(buffer);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return res.status(500).send('Error fetching the requested URL');
    }
  }

  @Head()
  async head(
    @Query('url') url: string | undefined,
    @Res() res: Response,
  ) {
    if (!url?.trim()) {
      throw new BadRequestException('Missing url parameter');
    }

    try {
      const upstream = await this.corsProxy.fetch(url, { method: 'HEAD' });
      this.setProxyHeaders(res, upstream);

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) {
        res.setHeader('x-file-size', contentLength);
      }

      return res.status(200).send();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return res.status(500).send();
    }
  }
}
