import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'user_blocks' })
@Unique('uq_user_block_blocker_blocked', ['blockerId', 'blockedId'])
@Index('idx_user_block_blocker_blocked', ['blockerId', 'blockedId'])
export class UserBlockEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'blocker_id', type: 'varchar' })
  blockerId: string;

  @Column({ name: 'blocked_id', type: 'varchar' })
  blockedId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
