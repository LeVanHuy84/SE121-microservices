import { PostgresConnectionOptions } from "typeorm/driver/postgres/PostgresConnectionOptions";
import * as path from "path";
import { registerAs } from "@nestjs/config";
import { PostgresProcessedEvent } from "@repo/common";

export default registerAs(
  "dbconfig.dev",
  (): PostgresConnectionOptions => ({
    url: process.env.POSTGRES_URL,
    type: "postgres",
    entities: [
      path.resolve(__dirname, "..") + "/**/*.entity{.ts,.js}",
      PostgresProcessedEvent,
    ],
    extra: {
      max: process.env.POSTGRES_POOL_MAX
        ? parseInt(process.env.POSTGRES_POOL_MAX, 10)
        : 100,
      connectionTimeoutMillis: 5000,
    },
    synchronize: true,
  }),
);
