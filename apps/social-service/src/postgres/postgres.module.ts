import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createSocialPostgresConfig } from './postgres.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: createSocialPostgresConfig,
    }),
  ],
  exports: [TypeOrmModule],
})
export class PostgresModule {}
