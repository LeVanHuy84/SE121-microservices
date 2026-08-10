DROP INDEX IF EXISTS "profiles_semantic_embedding_cosine_idx";

ALTER TABLE "profiles"
DROP COLUMN IF EXISTS "semantic_embedding",
DROP COLUMN IF EXISTS "semantic_embedding_updated_at";
