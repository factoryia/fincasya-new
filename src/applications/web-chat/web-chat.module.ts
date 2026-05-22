import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { WebChatController } from './web-chat.controller';

@Module({
  imports: [SharedModule],
  controllers: [WebChatController],
})
export class WebChatModule {}
