import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_emotion_profiles')
@Index('idx_recommendation_emotion_profiles_updated_at', ['updatedAt'])
@Index('idx_recommendation_emotion_profiles_source_event_at', ['sourceEventAt'])
export class RecommendationEmotionProfile {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'user_id' })
  userId: string;

  @Column({ type: 'float', name: 'risk_score', default: 0.0 })
  riskScore: number;

  @Column({ type: 'float', name: 'recent_negativity_score', default: 0.0 })
  recentNegativityScore: number;

  @Column({
    type: 'varchar',
    length: 64,
    name: 'dominant_emotion',
    nullable: true,
  })
  dominantEmotion: string | null;

  @Column({ type: 'jsonb', name: 'emotion_scores_json' })
  emotionScoresJson: Record<string, number>;

  @Column({ type: 'timestamp with time zone', name: 'source_event_at' })
  sourceEventAt: Date;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
