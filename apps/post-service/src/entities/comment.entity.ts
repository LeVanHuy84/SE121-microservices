import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Report } from "./report.entity";
import { MediaDto } from "@repo/dtos";
import { CommentStat } from "./comment-stat.entity";

@Entity('comments')
export class Comment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column('uuid', { name: 'user_id', nullable: false })
    userId: string;

    @Column('text')
    content: string;

    @Column('jsonb')
    media: MediaDto;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @OneToOne(
        () => CommentStat,
        (commentStat) => commentStat.comment,
        { cascade: true, eager: true },
    )
    commentStat: CommentStat;

    @OneToMany(() => Report, (reports) => reports.comment)
    reports: Report[];
}