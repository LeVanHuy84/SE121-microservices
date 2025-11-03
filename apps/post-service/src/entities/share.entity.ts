import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { Post } from './post.entity';
import { ShareStat } from './share-stat.entity';
import { Audience } from '@repo/dtos';

@Entity('shares')
@Index('idx_share_user', ['userId'])
@Index('idx_share', ['id'])
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'enum', enum: Audience, default: Audience.PUBLIC })
  audience: Audience;

  @Column({ type: 'varchar', length: 2000 })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

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
