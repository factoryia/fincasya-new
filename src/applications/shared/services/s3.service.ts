import { Injectable, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.bucketName = process.env.AWS_S3_BUCKET_NAME || '';

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'uploads'): Promise<string> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }
    const ext = file.originalname?.split('.').pop() || 'bin';
    const fileName = `${folder}/${randomUUID()}.${ext}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      });

      await this.s3Client.send(command);

      // Retornar URL pública del archivo
      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${fileName}`;
      return url;
    } catch (error) {
      throw new BadRequestException(`Error uploading file: ${error.message}`);
    }
  }

  async uploadMultipleFiles(files: Express.Multer.File[], folder: string = 'uploads'): Promise<string[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const uploadPromises = files.map((file) => this.uploadFile(file, folder));
    return Promise.all(uploadPromises);
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      // Extraer la clave del archivo de la URL
      const urlParts = fileUrl.split('.com/');
      if (urlParts.length < 2) {
        throw new Error('Invalid file URL');
      }
      const key = urlParts[1];

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw new BadRequestException(`Error deleting file: ${error.message}`);
    }
  }

  async uploadVideo(file: Express.Multer.File): Promise<string> {
    const ext = file?.originalname?.toLowerCase().split('.').pop();
    const videoExts = ['mp4', 'webm', 'mov'];
    const isVideo =
      file?.mimetype?.startsWith('video/') || (ext && videoExts.includes(ext));
    if (!isVideo) {
      throw new BadRequestException('File must be a video (mp4, webm, mov)');
    }
    return this.uploadFile(file, 'videos');
  }

  async uploadImage(file: Express.Multer.File): Promise<string> {
    if (!file?.mimetype?.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }
    return this.uploadFile(file, 'images');
  }

  async uploadImages(files: Express.Multer.File[]): Promise<string[]> {
    const invalidFiles = files.filter((file) => !file?.mimetype?.startsWith('image/'));
    if (invalidFiles.length > 0) {
      throw new BadRequestException('All files must be images');
    }

    return this.uploadMultipleFiles(files, 'images');
  }
}
