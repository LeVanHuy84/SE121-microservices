import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEntity } from 'src/entities/event.entity';
import { Repository } from 'typeorm';

@Injectable()
export class EventStoreService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
  ) {}

  async append(aggregateType: string, aggregateId: string, eventType: string, data: any) {
    return this.eventRepo.save(this.eventRepo.create({
      aggregateType, aggregateId, eventType, data
    }));
  }

  async getEventsForAggregate(aggregateType: string, aggregateId: string) {
    return this.eventRepo.find({
      where: { aggregateType, aggregateId },
      order: { createdAt: 'ASC' }
    });
}
}
