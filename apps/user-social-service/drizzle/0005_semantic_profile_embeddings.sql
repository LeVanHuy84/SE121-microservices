ALTER TABLE "profiles"
ADD COLUMN IF NOT EXISTS "semantic_profile_text" text,
ADD COLUMN IF NOT EXISTS "semantic_embedding" jsonb,
ADD COLUMN IF NOT EXISTS "semantic_embedding_updated_at" timestamp;