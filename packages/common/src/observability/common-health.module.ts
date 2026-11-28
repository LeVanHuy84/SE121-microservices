import { Global, Inject, Injectable, Module, OnModuleInit, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import { Connection } from 'mongoose';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { registerHealthCheck } from './otel';

const IOREDIS_DEFAULT_TOKEN = 'default_IORedisModuleConnectionToken';

@Injectable()
export class CommonHealthService implements OnModuleInit {
  constructor(
    @Optional()
    @InjectConnection()
    private readonly mongoConnection?: Connection,
    @Optional()
    @InjectDataSource()
    private readonly typeOrmDataSource?: DataSource,
    @Optional()
    @Inject(IOREDIS_DEFAULT_TOKEN)
    private readonly redisClient?: Redis,
  ) {}

  onModuleInit(): void {
    if (this.redisClient) {
      const redis = this.redisClient;
      registerHealthCheck('redis', async () => {
        const pong = await redis.ping();
        return { ok: pong === 'PONG', detail: pong };
      });
    }

    if (this.mongoConnection) {
      const conn = this.mongoConnection;
      registerHealthCheck('mongodb', async () => {
        if (conn.readyState !== 1) {
          return { ok: false, detail: `readyState=${conn.readyState}` };
        }
        await conn.db?.admin().ping();
        return { ok: true };
      });
    }

    if (this.typeOrmDataSource) {
      const ds = this.typeOrmDataSource;
      registerHealthCheck('postgres', async () => {
        await ds.query('SELECT 1');
        return { ok: true };
      });
    }
  }
}

@Global()
@Module({
  providers: [CommonHealthService],
  exports: [CommonHealthService],
})
export class CommonHealthModule {}
