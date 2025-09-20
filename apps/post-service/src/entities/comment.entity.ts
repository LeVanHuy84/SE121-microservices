import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Post } from "./post.entity";
import { Reaction } from "./reaction.entity";
import { Report } from "./report.entity";

@Entity('comments')
export class Comment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column('uuid', { name: 'user_id', nullable: false })
    userId: string;

    @Column('text')
    content: string;

    @Column('jsonb')
    stats: object;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @ManyToOne(() => Post, (post) => post.comments)
    @JoinColumn({ name: 'post_id' })
    post: Post;

    @OneToMany(() => Reaction, (reactions) => reactions.comment)
    reactions: Reaction[];

    @ManyToOne(() => Comment, (comment) => comment.children, { nullable: true })
    @JoinColumn({ name: 'parent_id' })
    parent?: Comment;

    @OneToMany(() => Comment, (comment) => comment.parent)
    children: Comment[];

    @OneToMany(() => Report, (reports) => reports.comment)
    reports: Report[];
}