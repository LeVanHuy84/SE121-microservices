import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudinaryModule } from 'src/cloudinary/cloudinary.module';
import { Media } from 'src/entities/media.entity';
import { OutboxModule } from 'src/outbox/outbox.module';
import { SagaOrchestratorModule } from 'src/saga-orchestrator/saga-orchestrator.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Outbox } from 'src/entities/outbox.entity';
import { EventStoreModule } from 'src/event-store/event-store.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, Outbox]),
    EventStoreModule,
    CloudinaryModule,
    SagaOrchestratorModule,
    OutboxModule
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService]
})
export class MediaModule {}
