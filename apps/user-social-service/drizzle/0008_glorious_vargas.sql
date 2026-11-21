ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "location" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "job_title" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "company" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "school" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "interests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "semantic_profile_text" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "privacy_settings" jsonb DEFAULT '{"profileVisibility": "PUBLIC", "messagePrivacy": "EVERYONE", "friendListVisibility": "PUBLIC", "postVisibilityDefault": "PUBLIC"}'::jsonb NOT NULL;
