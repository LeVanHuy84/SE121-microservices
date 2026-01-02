import { Module } from '@nestjs/common';
import { ConsumerModule } from './modules/consumer/consumer.module';
import { PostgresModule } from './postgres/postgres.module';

@Module({
  imports: [PostgresModule, ConsumerModule],
})
export class KafkaAppModule {}
