ALTER TABLE "users" ALTER COLUMN "user_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_status" SET DEFAULT 'ACTIVE'::text;--> statement-breakpoint
DROP TYPE "public"."user_status";--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'BANNED');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_status" SET DEFAULT 'ACTIVE'::"public"."user_status";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "user_status" SET DATA TYPE "public"."user_status" USING "user_status"::"public"."user_status";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "cover_image" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "cover_image_url";