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
import { Emotion, MediaItemDTO, RootType } from '@repo/dtos';
import { CommentStat } from './comment-stat.entity';

@Entity('comments')
@Index('idx_comment_target', ['rootType', 'rootId'])
@Index('idx_comment_user', ['parentId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'user_id', nullable: false })
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

  @Column({ type: 'enum', enum: Emotion, nullable: true })
  mainEmotion: Emotion;

  @Column({ type: 'float', nullable: true })
  mainEmotionScore: number;

  @Column({ type: 'boolean', name: 'is_deleted', default: false })
  isDeleted: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @OneToOne(() => CommentStat, (commentStat) => commentStat.comment, {
    cascade: true,
  })
  commentStat: CommentStat;
}
