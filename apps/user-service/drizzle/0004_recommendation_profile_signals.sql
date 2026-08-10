ALTER TABLE "profiles" ADD COLUMN "location" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "job_title" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "company" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "school" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "interests" jsonb DEFAULT '[]'::jsonb NOT NULL;
