import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_pair_features')
@Index('idx_recommendation_pair_features_candidate_id', ['candidateId'])
@Index('idx_recommendation_pair_features_last_event_at', ['lastEventAt'])
export class RecommendationPairFeature {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'viewer_id' })
  viewerId: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'candidate_id' })
  candidateId: string;

  @Column({ type: 'boolean', name: 'has_friendship', default: false })
  hasFriendship: boolean;

  @Column({ type: 'boolean', name: 'has_pending_request', default: false })
  hasPendingRequest: boolean;

  @Column({ type: 'boolean', name: 'is_blocked_either_way', default: false })
  isBlockedEitherWay: boolean;

  @Column({ type: 'boolean', name: 'has_active_dismissal', default: false })
  hasActiveDismissal: boolean;

  @Column({ type: 'integer', name: 'mutual_friend_count', default: 0 })
  mutualFriendCount: number;

  @Column({ type: 'integer', name: 'common_group_count', default: 0 })
  commonGroupCount: number;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'last_event_type',
    nullable: true,
  })
  lastEventType: string | null;

  @Column({
    type: 'timestamp with time zone',
    name: 'last_event_at',
    nullable: true,
  })
  lastEventAt: Date | null;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
