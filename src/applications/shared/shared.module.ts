import { Module } from '@nestjs/common';
import { ConvexService } from './services/convex.service';
import { S3Service } from './services/s3.service';

@Module({
  providers: [ConvexService, S3Service],
  exports: [ConvexService, S3Service],
})
export class SharedModule {}
