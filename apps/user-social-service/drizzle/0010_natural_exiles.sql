CREATE TYPE "public"."group_event_log" AS ENUM('GROUP_UPDATED', 'GROUP_SETTING_CHANGED', 'JOIN_REQUEST_APPROVED', 'JOIN_REQUEST_REJECTED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'MEMBER_BANNED', 'MEMBER_UNBANNED', 'POST_APPROVED', 'POST_REJECTED', 'INVITE_SENT', 'MEMBER_ROLE_CHANGED', 'MEMBER_PERMISSION_CHANGED');--> statement-breakpoint
CREATE TYPE "public"."group_member_status" AS ENUM('ACTIVE', 'BANNED');--> statement-breakpoint
CREATE TYPE "public"."group_privacy" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('ACTIVE', 'INACTIVE', 'BANNED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('PENDING', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "group_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"invitee_id" varchar(255) NOT NULL,
	"inviters" text[],
	"status" "invite_status" DEFAULT 'PENDING' NOT NULL,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"status" "join_request_status" DEFAULT 'PENDING' NOT NULL,
	"created_by" varchar(255),
	"updated_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"event_type" "group_event_log" NOT NULL,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"group_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'MEMBER' NOT NULL,
	"custom_permissions" jsonb,
	"status" "group_member_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" varchar(255) NOT NULL,
	"group_id" uuid NOT NULL,
	"reason" text,
	"status" "report_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"required_post_approval" boolean DEFAULT false NOT NULL,
	"allow_member_invite" boolean DEFAULT true NOT NULL,
	"max_members" integer DEFAULT 1000 NOT NULL,
	"created_by" varchar(255),
	"updated_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_statistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"date" date NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"join_count" integer DEFAULT 0 NOT NULL,
	"leave_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(1000),
	"avatar" jsonb,
	"cover_image" jsonb,
	"privacy" "group_privacy" DEFAULT 'PUBLIC' NOT NULL,
	"rules" varchar(10000),
	"members" integer DEFAULT 1 NOT NULL,
	"reports" integer DEFAULT 0 NOT NULL,
	"owner" jsonb,
	"status" "group_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" varchar(255),
	"updated_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_recommendation_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"candidate_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"candidate_id" varchar(255) NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"recommendation_id" varchar(255),
	"recommendation_request_id" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" varchar(255) NOT NULL,
	"receiver_id" varchar(255) NOT NULL,
	"recommendation_id" varchar(255),
	"recommendation_request_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"friend_id" varchar(255) NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"sentiment_score" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" varchar(255) NOT NULL,
	"blocked_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" RENAME COLUMN "stats" TO "post_count";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "friend_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_reporter_group" ON "group_reports" USING btree ("reporter_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_friend_recommendation_dismissal_user_candidate" ON "friend_recommendation_dismissals" USING btree ("user_id","candidate_id");--> statement-breakpoint
CREATE INDEX "idx_friend_recommendation_dismissal_user_candidate" ON "friend_recommendation_dismissals" USING btree ("user_id","candidate_id");--> statement-breakpoint
CREATE INDEX "idx_friend_recommendation_dismissal_user_expires" ON "friend_recommendation_dismissals" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_friend_recommendation_event_user_created_at" ON "friend_recommendation_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_friend_recommendation_event_recommendation_id" ON "friend_recommendation_events" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "idx_friend_recommendation_event_request_id" ON "friend_recommendation_events" USING btree ("recommendation_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_friend_request_requester_receiver" ON "friend_requests" USING btree ("requester_id","receiver_id");--> statement-breakpoint
CREATE INDEX "idx_friend_request_receiver_requester" ON "friend_requests" USING btree ("receiver_id","requester_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_friendship_user_friend" ON "friendships" USING btree ("user_id","friend_id");--> statement-breakpoint
CREATE INDEX "idx_friendship_user_friend" ON "friendships" USING btree ("user_id","friend_id");--> statement-breakpoint
CREATE INDEX "idx_friendship_user_since" ON "friendships" USING btree ("user_id","since");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_block_blocker_blocked" ON "user_blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "idx_user_block_blocker_blocked" ON "user_blocks" USING btree ("blocker_id","blocked_id");