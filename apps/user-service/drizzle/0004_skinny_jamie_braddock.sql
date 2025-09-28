ALTER TABLE "profiles" ADD COLUMN "first_name" varchar(100);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_name" varchar(100);--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "full_name";