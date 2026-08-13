import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_global_fallback_candidates')
@Index('idx_recommendation_global_fallback_segment_rank', [
  'segmentKey',
  'rank',
])
@Index('idx_recommendation_global_fallback_locale_language_rank', [
  'locale',
  'language',
  'rank',
])
@Index('idx_recommendation_global_fallback_rank', ['rank'])
export class RecommendationGlobalFallbackCandidate {
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'segment_key' })
  segmentKey: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'float', name: 'fallback_score' })
  fallbackScore: number;

  @Column({ type: 'integer' })
  rank: number;

  @Column({ type: 'varchar', length: 32, nullable: true })
  locale: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  language: string | null;

  @Column({ type: 'varchar', length: 255, name: 'score_version' })
  scoreVersion: string;

  @Column({ type: 'timestamp with time zone', name: 'generated_at' })
  generatedAt: Date;
}
