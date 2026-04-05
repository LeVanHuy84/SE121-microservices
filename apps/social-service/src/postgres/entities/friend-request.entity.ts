import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'friend_requests' })
@Unique('uq_friend_request_requester_receiver', ['requesterId', 'receiverId'])
@Index('idx_friend_request_receiver_requester', ['receiverId', 'requesterId'])
export class FriendRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'requester_id', type: 'varchar' })
  requesterId: string;

  @Column({ name: 'receiver_id', type: 'varchar' })
  receiverId: string;

  @Column({ name: 'recommendation_id', type: 'varchar', nullable: true })
  recommendationId: string | null;

  @Column({
    name: 'recommendation_request_id',
    type: 'varchar',
    nullable: true,
  })
  recommendationRequestId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
