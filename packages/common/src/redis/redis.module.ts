import { DynamicModule, Module, Global } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { RedisPubSubService } from './redis.service';

export interface RedisModuleOptions {
  name?: string; // nếu có nhiều redis
  config: RedisOptions;
}

@Global()
@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions): DynamicModule {
    const connectionName = options.name || 'default';

    const redisProvider = {
      provide: `REDIS_${connectionName.toUpperCase()}_CLIENT`,
      useFactory: async () => {
        const client = new Redis(options.config);
        return client;
      },
    };

    const pubSubProvider = {
      provide: `REDIS_${connectionName.toUpperCase()}`,
      useFactory: (client: Redis) => new RedisPubSubService(client),
      inject: [`REDIS_${connectionName.toUpperCase()}_CLIENT`],
    };

    return {
      module: RedisModule,
      providers: [redisProvider, pubSubProvider],
      exports: [pubSubProvider],
    };
  }

  // Nếu dùng ConfigModule hoặc env, thì có bản async
  static forRootAsync(options: {
    name?: string;
    useFactory: (
      ...args: any[]
    ) => RedisModuleOptions['config'] | Promise<RedisModuleOptions['config']>;
    inject?: any[];
    imports?: any[];
  }): DynamicModule {
    const connectionName = options.name || 'default';

    const redisProvider = {
      provide: `REDIS_${connectionName.toUpperCase()}_CLIENT`,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args);
        const client = new Redis(config);
        return client;
      },
      inject: options.inject || [],
    };

    const pubSubProvider = {
      provide: `REDIS_${connectionName.toUpperCase()}`,
      useFactory: (client: Redis) => new RedisPubSubService(client),
      inject: [`REDIS_${connectionName.toUpperCase()}_CLIENT`],
    };

    return {
      module: RedisModule,
      imports: options.imports || [],
      providers: [redisProvider, pubSubProvider],
      exports: [pubSubProvider],
    };
  }
}
