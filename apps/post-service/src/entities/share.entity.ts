import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from './post.entity';
import { ShareStat } from './share-stat.entity';
import { Audience } from '@repo/dtos';

@Entity('shares')
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'enum', enum: Audience, default: Audience.PUBLIC })
  audience: Audience;

  @Column({ type: 'varchar', length: 2000 })
  content: string;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => "CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'",
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @Column('uuid', { name: 'post_id', nullable: true })
  postId: string;

  @ManyToOne(() => Post, (post) => post.shares, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @OneToOne(() => ShareStat, (shareStat) => shareStat.share, { cascade: true })
  shareStat: ShareStat;
}
