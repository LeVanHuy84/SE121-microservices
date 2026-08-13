import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('recommendation_friendships')
@Index('idx_recommendation_friendships_friend_id', ['friendId'])
export class RecommendationFriendship {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'user_id' })
  userId: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'friend_id' })
  friendId: string;

  @Column({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date;
}
