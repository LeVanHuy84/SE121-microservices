import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaItemDTO, RootType } from '@repo/dtos';
import { CommentStat } from './comment-stat.entity';

@Entity('comments')
@Index('idx_comment_target', ['rootType', 'rootId'])
@Index('idx_comment_user', ['parentId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: false })
  userId: string;

  @Column({ name: 'root_target_type', type: 'enum', enum: RootType })
  rootType: RootType;

  @Column('uuid', { name: 'root_target_id', nullable: true })
  rootId: string;

  @Column('uuid', { name: 'parent_id', nullable: true })
  parentId: string;

  @ManyToOne(() => Comment, (comment) => comment.replies, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'parent_id' })
  parent?: Comment;

  @OneToMany(() => Comment, (comment) => comment.parent, {
    cascade: ['remove'],
  })
  replies?: Comment[];

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
