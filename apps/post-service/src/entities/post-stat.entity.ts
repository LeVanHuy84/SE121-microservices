import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, PrimaryGeneratedColumn } from "typeorm";
import { Post } from "./post.entity";

@Entity('post_stats')
export class PostStat {
    @PrimaryColumn('uuid', { name: 'post_id' })
    postId: string;

    @OneToOne(() => Post, (post) => post.postStat, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'post_id' })
    post: Post;

    @Column({ type: 'int', default: 0 }) reactions: number;

    @Column({ type: 'int', default: 0 }) likes: number;
    @Column({ type: 'int', default: 0 }) loves: number;
    @Column({ type: 'int', default: 0 }) hahas: number;
    @Column({ type: 'int', default: 0 }) wows: number;
    @Column({ type: 'int', default: 0 }) sads: number;
    @Column({ type: 'int', default: 0 }) angrys: number;

    @Column({ type: 'int', default: 0 }) comments: number;

    @Column({ type: 'int', default: 0 }) shares: number;
}