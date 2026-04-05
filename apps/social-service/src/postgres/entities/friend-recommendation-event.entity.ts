import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'friend_recommendation_events' })
@Index('idx_friend_recommendation_event_user_created_at', ['userId', 'createdAt'])
@Index('idx_friend_recommendation_event_recommendation_id', ['recommendationId'])
@Index('idx_friend_recommendation_event_request_id', ['recommendationRequestId'])
export class FriendRecommendationEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  userId: string;

  @Column({ name: 'candidate_id', type: 'varchar' })
  candidateId: string;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string;

  @Column({ name: 'recommendation_id', type: 'varchar', nullable: true })
  recommendationId: string | null;

  @Column({
    name: 'recommendation_request_id',
    type: 'varchar',
    nullable: true,
  })
  recommendationRequestId: string | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
