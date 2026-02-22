import {
  Controller,
  Get,
  Post,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { KnowledgeService } from './knowledge.service';

// Convex Node actions limit args to 5 MiB; base64 ~+33% → max ~4 MB binario
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB
const ALLOWED_MIMES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

class AllowedMimeValidator {
  isValid(file?: Express.Multer.File): boolean {
    if (!file) return false;
    const mime = (file.mimetype || '').toLowerCase();
    return ALLOWED_MIMES.some(
      (allowed) => mime === allowed || mime.startsWith(allowed.split('/')[0] + '/'),
    );
  }
  buildErrorMessage(): string {
    return 'Tipo no permitido. Permitidos: PDF, texto, markdown, JSON, imágenes (JPEG, PNG, WebP, GIF).';
  }
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  /**
   * Subir un archivo al RAG (base de conocimiento vectorizada).
   * Form-data: campo "file" (archivo) y opcionalmente "category", "namespace".
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
          new AllowedMimeValidator(),
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const token = this.getConvexToken(req);
    if (!token) {
      throw new BadRequestException(
        'No se encontró token de Convex. Si usas cookie: asegúrate de enviar el header Cookie con better-auth.convex_jwt=<valor>. Si la petición es desde otro origen (otro puerto/dominio), el navegador no envía cookies; usa entonces Authorization: Bearer <jwt>.',
      );
    }
    if (token === 'TU_JWT' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new BadRequestException(
        'El token debe ser un JWT real. Tras iniciar sesión, copia el valor de la cookie better-auth.convex_jwt (no uses el literal TU_JWT).',
      );
    }

    const category = (req.body?.category as string) || undefined;
    const namespace = (req.body?.namespace as string) || undefined;

    return this.knowledgeService.addFile(
      {
        filename: file.originalname || 'document',
        mimeType: file.mimetype || 'application/octet-stream',
        bytes: file.buffer,
        category,
        namespace,
      },
      token,
    );
  }

  /**
   * Estado de una subida (poll). Si devuelve null, el documento ya está listo o falló.
   * GET /knowledge/upload/status?jobId=<id>
   */
  @Get('upload/status')
  async getUploadStatus(@Query('jobId') jobId: string, @Req() req: Request) {
    const token = this.getConvexToken(req);
    if (!token) {
      throw new BadRequestException('No se encontró token de Convex.');
    }
    if (!jobId) {
      throw new BadRequestException('Falta query jobId.');
    }
    return this.knowledgeService.getUploadStatus(jobId, token);
  }

  private getConvexToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    // Express normaliza headers a minúsculas; por si acaso revisar también 'Cookie'
    const cookieHeader = (req.headers.cookie ?? req.headers['Cookie'] ?? '') as string;
    if (!cookieHeader) return null;
    // Aceptar "better-auth.convex_jwt" o variantes con prefijo (__Host-, __Secure-)
    const pairs = cookieHeader.split(';').map((s) => s.trim());
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const nameLower = name.toLowerCase();
      if (nameLower === 'better-auth.convex_jwt' || nameLower.endsWith('.convex_jwt')) {
        try {
          return value ? decodeURIComponent(value) : null;
        } catch {
          return value || null;
        }
      }
    }
    return null;
  }
}
