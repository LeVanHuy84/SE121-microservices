import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as path from "path";
import * as fs from "fs";

async function runMigrations() {
  const databaseUrl =
    process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!databaseUrl) {
    console.error(
      "❌ [Drizzle Migration] DATABASE_URL / POSTGRES_URL is not defined!",
    );
    process.exit(1);
  }

  const hasSsl =
    databaseUrl.includes("sslmode=require") ||
    process.env.DATABASE_SSL === "true";

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: hasSsl ? { rejectUnauthorized: false } : false,
  });

  // Preflight: Ensure required extensions exist in PostgreSQL
  console.log("🔧 [Drizzle Migration] Running preflight checks...");
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "vector";

    DO $$ BEGIN
      CREATE TYPE "public"."privacy_level" AS ENUM('public', 'private');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
  `);

  const db = drizzle(pool);

  const candidatePaths = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "apps/user-social-service/drizzle"),
    path.resolve(__dirname, "../../../drizzle"),
    path.resolve(__dirname, "../../drizzle"),
  ];
  const migrationsFolder = candidatePaths.find((p) => fs.existsSync(p));

  if (!migrationsFolder) {
    console.error(
      "❌ [Drizzle Migration] Migrations folder not found in candidates:",
      candidatePaths,
    );
    process.exit(1);
  }

  console.log(`🚀 [Drizzle Migration] Running migrations from: ${migrationsFolder}`);
  try {
    await migrate(db, { migrationsFolder });
    console.log("✅ [Drizzle Migration] All migrations applied successfully!");
  } catch (error) {
    console.error("💥 [Drizzle Migration] Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
