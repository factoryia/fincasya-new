import {
  BadRequestException,
  Controller,
  Get,
  Head,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CorsProxyService } from './cors-proxy.service';

/**
 * En producción, nginx envía `/api/*` a Nest. El handler equivalente en
 * FincasYaWeb (`app/api/cors-proxy/route.ts`) solo aplica en dev o cuando
 * Next atiende `/api` directamente.
 */
@Controller('cors-proxy')
export class CorsProxyController {
  constructor(private readonly corsProxy: CorsProxyService) {}

  @Get()
  async get(@Query('url') url: string | undefined, @Res() res: Response) {
    if (!url?.trim()) {
      throw new BadRequestException('Missing url parameter');
    }

    try {
      const { buffer, contentType } = await this.corsProxy.fetch(url);
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(Buffer.from(buffer));
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return res.status(500).send('Error fetching the requested URL');
    }
  }

  @Head()
  async head(@Query('url') url: string | undefined, @Res() res: Response) {
    if (!url?.trim()) {
      throw new BadRequestException('Missing url parameter');
    }

    try {
      const { contentLength } = await this.corsProxy.head(url);
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (contentLength) {
        res.setHeader('x-file-size', contentLength);
        res.setHeader('Access-Control-Expose-Headers', 'x-file-size');
      }
      return res.status(200).send();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return res.status(500).send();
    }
  }
}
