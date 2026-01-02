import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Comment } from './comment.entity';

@Entity('comment_stats')
export class CommentStat {
  @PrimaryColumn('uuid', { name: 'comment_id' })
  commentId: string;

  @OneToOne(() => Comment, (comment) => comment.commentStat, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'comment_id' })
  comment: Comment;

  @Column({ type: 'int', default: 0 }) reactions: number;
  @Column({ type: 'int', default: 0 }) likes: number;
  @Column({ type: 'int', default: 0 }) loves: number;
  @Column({ type: 'int', default: 0 }) hahas: number;
  @Column({ type: 'int', default: 0 }) wows: number;
  @Column({ type: 'int', default: 0 }) sads: number;
  @Column({ type: 'int', default: 0 }) angrys: number;

  @Column({ type: 'int', default: 0 }) replies: number;
  @Column({ type: 'int', default: 0 }) reports: number;
}
