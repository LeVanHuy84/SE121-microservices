ALTER TABLE "profiles" ADD COLUMN "location" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "job_title" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "company" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "school" varchar(120);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "interests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "semantic_profile_text" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "privacy_settings" jsonb DEFAULT '{"profileVisibility": "PUBLIC", "messagePrivacy": "EVERYONE", "friendListVisibility": "PUBLIC", "postVisibilityDefault": "PUBLIC"}'::jsonb NOT NULL;