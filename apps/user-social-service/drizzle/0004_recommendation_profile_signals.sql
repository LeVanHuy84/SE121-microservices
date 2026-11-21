ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "location" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "job_title" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "company" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "school" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "interests" jsonb DEFAULT '[]'::jsonb NOT NULL;