CREATE TYPE "public"."privacy_level" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "privacy_level" SET DEFAULT 'public'::"public"."privacy_level";--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "privacy_level" SET DATA TYPE "public"."privacy_level" USING "privacy_level"::"public"."privacy_level";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;