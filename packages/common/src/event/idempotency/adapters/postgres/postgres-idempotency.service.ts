import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  IdempotencyContext,
  IdempotencyRepository,
} from '../../idempotency.interface';
import { PostgresProcessedEvent } from './processed-event.entity';

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(
    @InjectRepository(PostgresProcessedEvent)
    private readonly repo: Repository<PostgresProcessedEvent>,
  ) {}

  private getRepository(manager?: EntityManager) {
    return manager ? manager.getRepository(PostgresProcessedEvent) : this.repo;
  }

  async tryStart(
    context: IdempotencyContext,
  ): Promise<'STARTED' | 'DONE' | 'BUSY'> {
    const { eventId, manager } = context;
    const repository = this.getRepository(manager);

    try {
      await repository.insert({
        eventId,
        done: false,
      });
      return 'STARTED';
    } catch (err: any) {
      if (err.code === '23505') {
        const event = await repository.findOne({ where: { eventId } });

        if (event?.done) {
          return 'DONE';
        }

        return 'BUSY';
      }

      throw err;
    }
  }

  async isDone(context: IdempotencyContext): Promise<boolean> {
    const { eventId, manager } = context;
    const repository = this.getRepository(manager);
    const event = await repository.findOne({ where: { eventId } });
    return event?.done ?? false;
  }

  async markDone(context: IdempotencyContext) {
    const { eventId, manager } = context;
    const repository = this.getRepository(manager);
    await repository.update({ eventId }, { done: true });
  }
}
