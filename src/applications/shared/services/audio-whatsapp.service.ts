import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WHATSAPP_AUDIO_MIMES = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
]);

@Injectable()
export class AudioWhatsappService {
  /**
   * WhatsApp solo acepta OGG/Opus, AAC/M4A, MP3 y AMR.
   * Chrome graba WebM/Opus: lo convertimos a OGG antes de subir a S3/YCloud.
   */
  async ensureCompatible(
    file: Express.Multer.File,
  ): Promise<Express.Multer.File> {
    const mime = (file.mimetype || '').toLowerCase();
    if (!mime.includes('webm')) {
      return this.withExtension(file);
    }

    let ffmpegPath: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ffmpegPath = require('ffmpeg-static') as string;
    } catch {
      ffmpegPath = null;
    }

    if (!ffmpegPath) {
      throw new Error(
        'El audio grabado en este navegador (WebM) no es compatible con WhatsApp. Usa Safari o graba desde el celular.',
      );
    }

    const id = randomUUID();
    const inPath = join(tmpdir(), `fy-audio-${id}.webm`);
    const outPath = join(tmpdir(), `fy-audio-${id}.ogg`);

    try {
      await writeFile(inPath, file.buffer);
      await execFileAsync(ffmpegPath, [
        '-y',
        '-i',
        inPath,
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-f',
        'ogg',
        outPath,
      ]);
      const outBuffer = await readFile(outPath);
      return {
        ...file,
        buffer: outBuffer,
        mimetype: 'audio/ogg',
        originalname: file.originalname.replace(/\.webm$/i, '.ogg') || 'voice.ogg',
        size: outBuffer.length,
      };
    } finally {
      await unlink(inPath).catch(() => undefined);
      await unlink(outPath).catch(() => undefined);
    }
  }

  private withExtension(file: Express.Multer.File): Express.Multer.File {
    const mime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
    if (WHATSAPP_AUDIO_MIMES.has(mime)) return file;

    const name = file.originalname || 'voice.ogg';
    if (mime.includes('ogg')) {
      return { ...file, mimetype: 'audio/ogg' };
    }
    if (mime.includes('mpeg') || mime.includes('mp3')) {
      return { ...file, mimetype: 'audio/mpeg' };
    }
    if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')) {
      return { ...file, mimetype: 'audio/mp4' };
    }
    return file;
  }
}
