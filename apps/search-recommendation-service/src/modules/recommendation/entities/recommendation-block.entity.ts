import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_blocks')
@Index('idx_recommendation_blocks_blocked_id', ['blockedId'])
export class RecommendationBlock {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'blocker_id' })
  blockerId: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'blocked_id' })
  blockedId: string;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
