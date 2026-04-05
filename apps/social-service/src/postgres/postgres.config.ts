import * as path from 'path';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export function createSocialPostgresConfig(): PostgresConnectionOptions {
  return {
    url: process.env.SOCIAL_DATABASE_URL,
    type: 'postgres',
    entities: [path.resolve(__dirname, '..') + '/**/*.entity{.ts,.js}'],
    synchronize: true,
  };
}
