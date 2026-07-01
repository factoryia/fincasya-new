import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SaleLinksService } from './sale-links.service';

function formatValidatedBy(user?: {
  id?: string;
  name?: string;
  email?: string;
}): string {
  const name = user?.name?.trim();
  const email = user?.email?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user?.id || 'admin panel';
}

/**
 * Alias usado por el panel admin (`/api/admin/sale-link-validation/:token`).
 * En producción nginx enruta /api/* al backend Nest; la ruta homónima de Next.js no aplica.
 */
@Controller('admin/sale-link-validation')
export class SaleLinkValidationController {
  constructor(private readonly saleLinksService: SaleLinksService) {}

  @Post(':token')
  async validatePayment(
    @Param('token') token: string,
    @Body() body: { validatedBy?: string },
    @Req() req: Request,
  ) {
    const user = (req as unknown as { user?: { id?: string; name?: string; email?: string } })
      .user;
    const validatedBy =
      String(body?.validatedBy ?? '').trim() || formatValidatedBy(user);
    return this.saleLinksService.validatePaymentAsAdmin(token, validatedBy);
  }
}
