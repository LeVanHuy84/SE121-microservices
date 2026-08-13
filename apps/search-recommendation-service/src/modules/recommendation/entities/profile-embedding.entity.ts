import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('profile_embeddings')
export class ProfileEmbedding {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'user_id' })
  userId: string;

  @Column({ type: 'text', name: 'semantic_profile_text', nullable: true })
  semanticProfileText: string | null;

  @Column({ type: 'jsonb', name: 'embedding_json' })
  embeddingJson: number[];

  @Column({ type: 'jsonb', name: 'query_embedding_json', nullable: true })
  queryEmbeddingJson: number[] | null;

  @Column({ type: 'text', name: 'embedding_vector', nullable: true })
  embeddingVector: string | null;

  @Column({ type: 'text', name: 'query_embedding_vector', nullable: true })
  queryEmbeddingVector: string | null;

  @Column({ type: 'integer' })
  dimensions: number;

  @Column({ type: 'varchar', length: 255, name: 'model_name' })
  modelName: string;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
