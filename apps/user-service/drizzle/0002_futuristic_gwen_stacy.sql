CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'BANNED', 'SUSPENDED', 'DELETED');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "user_status" "user_status" DEFAULT 'ACTIVE' NOT NULL;