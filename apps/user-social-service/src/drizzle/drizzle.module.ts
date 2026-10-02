import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";
import * as schema from "./schema/schema";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export const DRIZZLE = Symbol("drizzle-connection");

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const databaseUrl = configService.get<string>("DATABASE_URL");
        const pool = new Pool({
          connectionString: databaseUrl,
          ssl: true,
        });
        pool.setMaxListeners(0);
        const db = drizzle(pool, { schema }) as NodePgDatabase<typeof schema>;

        // Run migrations programmatically
        // await migrate(db, { migrationsFolder: "./drizzle" });

        return db;
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
