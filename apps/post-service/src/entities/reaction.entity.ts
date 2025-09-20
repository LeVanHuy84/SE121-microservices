import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Post } from "./post.entity";
import { ReactionType } from "@repo/dtos";
import { Comment } from "./comment.entity";

@Entity('reactions')
export class Reaction {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column('uuid', { name: 'user_id', nullable: false })
    userId: string;

    @Column({ name: 'type', type: 'smallint' })
    type: ReactionType;

    @ManyToOne(() => Post, (post) => post.reactions)
    @JoinColumn({ name: 'post_id' })
    post: Post;

    @ManyToOne(() => Comment, (comment) => comment.reactions)
    @JoinColumn({ name: 'comment_id' })
    comment: Comment;
}