import { Injectable } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

export interface AddFileToRagParams {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  category?: string;
  namespace?: string;
}

/** Respuesta de subida: el documento se procesa en background (evita timeout). */
export interface AddFileToRagResult {
  url: string;
  jobId: string;
  status: 'processing';
  message: string;
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly convexService: ConvexService) {}

  async addFile(params: AddFileToRagParams, token: string): Promise<AddFileToRagResult> {
    const bytesBase64 = params.bytes.toString('base64');
    return this.convexService.action(
      'knowledge:addFile',
      {
        filename: params.filename,
        mimeType: params.mimeType,
        bytesBase64,
        ...(params.category != null && { category: params.category }),
        ...(params.namespace != null && { namespace: params.namespace }),
      },
      token,
    ) as Promise<AddFileToRagResult>;
  }

  /** Estado de una subida (para poll). Si devuelve null, el documento ya está listo o falló. */
  async getUploadStatus(jobId: string, token: string): Promise<{ status: 'processing' } | null> {
    const job = await this.convexService.query('knowledge:getPendingUpload', { jobId }, token);
    if (!job) return null;
    return { status: 'processing' };
  }
}
