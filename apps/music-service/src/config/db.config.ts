import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import * as path from 'path';
import { registerAs } from '@nestjs/config';
import { PostgresProcessedEvent } from '@repo/common';

export default registerAs(
  'dbconfig.dev',
  (): PostgresConnectionOptions => ({
    url: process.env.MUSIC_DATABASE_URL,
    type: 'postgres',

    ssl: {
      rejectUnauthorized: false,
    },

    entities: [
      path.resolve(__dirname, '..') + '/**/*.entity{.ts,.js}',
      PostgresProcessedEvent,
    ],

    synchronize: true,
  }),
);
