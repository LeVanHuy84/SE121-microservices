import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_pending_requests')
@Index('idx_recommendation_pending_requests_receiver_id', ['receiverId'])
export class RecommendationPendingRequest {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'requester_id' })
  requesterId: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'receiver_id' })
  receiverId: string;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
