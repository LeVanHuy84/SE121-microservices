import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_dismissals')
@Index('idx_recommendation_dismissals_expires_at', ['expiresAt'])
export class RecommendationDismissal {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'user_id' })
  userId: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'timestamp with time zone', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
