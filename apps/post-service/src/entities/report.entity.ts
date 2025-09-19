import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Post } from './post.entity';
import { Comment } from './comment.entity';

@Entity('reports')
export class Report {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', nullable: false })
    userId: string;

    @Column({ type: 'text' })
    caption: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @ManyToOne(() => Post, (post) => post.reports)
    @JoinColumn({ name: 'post_id' })
    post: Post;

    @ManyToOne(() => Comment, (comment) => comment.reports)
    @JoinColumn({ name: 'comment_id' })
    comment: Comment;
}