import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Comment } from "./comment.entity";
import { Reaction } from "./reaction.entity";
import { Share } from "./share.entity";
import { EditHisstory } from "./edit-history.entity";
import { Report } from "./report.entity";

@Entity('posts')
export class Post {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', nullable: false })
    userId: string;

    @Column('uuid', { name: 'group_id' })
    groupId: string;

    @Column('text')
    content: string;

    @Column('jsonb')
    media: object;

    @Column('varchar', { length: 20 })
    audience: string;

    @Column('jsonb')
    stats: object;

    @Column('varchar', { length: 20 })
    status: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @OneToMany(() => Comment, (comments) => comments.post)
    comments: Comment[];

    @OneToMany(() => Reaction, (reactions) => reactions.post)
    reactions: Reaction[];

    @OneToMany(() => Share, (shares) => shares.post)
    shares: Share[];

    @OneToMany(() => EditHisstory, (editHistories) => editHistories.post)
    editHistories: EditHisstory[];

    @OneToMany(() => Report, (reports) => reports.post)
    reports: Report[];
}