import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('recommendation_graph_event_journal')
@Index('idx_recommendation_graph_event_journal_user_target', [
  'userId',
  'targetUserId',
  'id',
])
@Index('idx_recommendation_graph_event_journal_event_type', ['eventType', 'id'])
export class RecommendationGraphEventJournal {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'event_type' })
  eventType: string;

  @Column({ type: 'varchar', length: 255, name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 255, name: 'target_user_id' })
  targetUserId: string;

  @Column({ type: 'timestamp with time zone', name: 'occurred_at' })
  occurredAt: Date;

  @Column({ type: 'varchar', length: 128 })
  source: string;

  @Column({ type: 'jsonb', name: 'payload_json' })
  payloadJson: Record<string, any>;

  @Column({ type: 'timestamp with time zone', name: 'ingested_at' })
  ingestedAt: Date;
}
