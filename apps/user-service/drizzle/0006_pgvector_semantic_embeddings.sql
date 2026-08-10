CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "profiles"
ADD COLUMN "semantic_embedding_vector" vector(768);

UPDATE "profiles"
SET "semantic_embedding_vector" = REPLACE("semantic_embedding"::text, ' ', '')::vector
WHERE "semantic_embedding" IS NOT NULL;

ALTER TABLE "profiles"
DROP COLUMN "semantic_embedding";

ALTER TABLE "profiles"
RENAME COLUMN "semantic_embedding_vector" TO "semantic_embedding";

CREATE INDEX IF NOT EXISTS "profiles_semantic_embedding_cosine_idx"
ON "profiles"
USING ivfflat ("semantic_embedding" vector_cosine_ops)
WITH (lists = 100);
