import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEntity } from 'src/entities/event.entity';
import { EventStoreService } from './event-store.service';

@Module({
  imports: [TypeOrmModule.forFeature([EventEntity])],
  providers: [EventStoreService],
  exports: [EventStoreService]
})
export class EventStoreModule {}
