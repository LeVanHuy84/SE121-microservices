import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaItemDTO } from '@repo/dtos';
import { CommentStat } from './comment-stat.entity';

@Entity('comments')
@Index('idx_comment_post', ['postId'])
@Index('idx_comment_reply', ['replyId'])
@Index('idx_comment_user', ['userId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: false })
  userId: string;

  @Column('uuid', { name: 'post_id' })
  postId: string;

  @Column('uuid', { name: 'reply_id', nullable: true })
  replyId: string;

  @Column({ type: 'varchar', length: 1000 })
  content: string;

  @Column('jsonb', { nullable: true })
  media: MediaItemDTO;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => CommentStat, (commentStat) => commentStat.comment, {
    cascade: true,
  })
  commentStat: CommentStat;
}
