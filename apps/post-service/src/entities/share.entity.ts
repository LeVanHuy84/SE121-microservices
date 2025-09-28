import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Post } from './post.entity';

@Entity('shares')
@Index('idx_share_user', ['userId'])
@Index('idx_share', ['id'])
export class Share {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 2000 })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column('uuid', { name: 'post_id' })
  postId: string;

  @ManyToOne(() => Post, (post) => post.shares)
  @JoinColumn({ name: 'post_id' })
  post: Post;
}
