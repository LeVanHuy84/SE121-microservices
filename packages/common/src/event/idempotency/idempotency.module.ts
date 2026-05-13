import { DynamicModule, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyService } from './idempotency.service';

@Module({})
export class IdempotencyModule {
  static forMongo(): DynamicModule {
    const {
      MongoIdempotencyRepository,
    } = require('./adapters/mongo/mongo-idempotency.service');

    const {
      MongoProcessedEvent,
      MongoProcessedEventSchema,
    } = require('./adapters/mongo/processed-event.schema');

    return {
      module: IdempotencyModule,

      imports: [
        MongooseModule.forFeature([
          {
            name: MongoProcessedEvent.name,
            schema: MongoProcessedEventSchema,
          },
        ]),
      ],

      providers: [
        {
          provide: 'IdempotencyRepository',
          useClass: MongoIdempotencyRepository,
        },
        IdempotencyService,
      ],

      exports: [IdempotencyService],
    };
  }

  static forPostgres(): DynamicModule {
    const {
      PostgresIdempotencyRepository,
    } = require('./adapters/postgres/postgres-idempotency.service');
    const {
      PostgresProcessedEvent,
    } = require('./adapters/postgres/processed-event.entity');

    return {
      module: IdempotencyModule,
      imports: [TypeOrmModule.forFeature([PostgresProcessedEvent])],
      providers: [
        {
          provide: 'IdempotencyRepository',
          useClass: PostgresIdempotencyRepository,
        },
        IdempotencyService,
      ],
      exports: [IdempotencyService],
    };
  }
}
