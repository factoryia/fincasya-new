import { Module } from '@nestjs/common';
import { CorsProxyController } from './cors-proxy.controller';
import { CorsProxyService } from './cors-proxy.service';

@Module({
  controllers: [CorsProxyController],
  providers: [CorsProxyService],
})
export class CorsProxyModule {}
