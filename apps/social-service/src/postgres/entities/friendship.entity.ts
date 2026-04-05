import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'friendships' })
@Unique('uq_friendship_user_friend', ['userId', 'friendId'])
@Index('idx_friendship_user_friend', ['userId', 'friendId'])
@Index('idx_friendship_user_since', ['userId', 'since'])
export class FriendshipEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'varchar' })
  userId: string;

  @Column({ name: 'friend_id', type: 'varchar' })
  friendId: string;

  @CreateDateColumn({ name: 'since', type: 'timestamptz' })
  since: Date;

  @Column({
    name: 'sentiment_score',
    type: 'double precision',
    default: 0,
  })
  sentimentScore: number;
}
