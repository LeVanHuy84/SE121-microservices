import { Module } from '@nestjs/common';
import { ConversationActivityService } from './conversation-activity.service';
import { PresenceService } from './presence.service';

@Module({
  providers: [PresenceService, ConversationActivityService],
  exports: [ConversationActivityService],
})
export class PresenceModule {}
