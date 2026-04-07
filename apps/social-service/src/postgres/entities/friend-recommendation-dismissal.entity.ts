import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'friend_recommendation_dismissals' })
@Unique('uq_friend_recommendation_dismissal_user_candidate', [
  'userId',
  'candidateId',
])
@Index('idx_friend_recommendation_dismissal_user_candidate', [
  'userId',
  'candidateId',
])
@Index('idx_friend_recommendation_dismissal_user_expires', [
  'userId',
  'expiresAt',
])
export class FriendRecommendationDismissalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  userId: string;

  @Column({ name: 'candidate_id', type: 'varchar' })
  candidateId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
