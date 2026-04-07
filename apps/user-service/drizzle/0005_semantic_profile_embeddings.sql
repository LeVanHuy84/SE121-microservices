ALTER TABLE "profiles"
ADD COLUMN "semantic_profile_text" text,
ADD COLUMN "semantic_embedding" jsonb,
ADD COLUMN "semantic_embedding_updated_at" timestamp;
