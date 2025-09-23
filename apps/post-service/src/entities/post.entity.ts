import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Comment } from "./comment.entity";
import { Share } from "./share.entity";
import { EditHistory } from "./edit-history.entity";
import { Report } from "./report.entity";
import { Audience, Feeling, MediaDto, PostStatus, StatsDto } from "@repo/dtos";
import { PostStat } from "./post-stat.entity";

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: false })
  userId: string;

  @Column('uuid', { name: 'group_id', nullable: true })
  groupId: string;

  @Column('smallint', { nullable: true })
  feeling: Feeling;

  @Column('text')
  content: string;

  @Column('jsonb')
  media: MediaDto;

  @Column('smallint', { default: Audience.PUBLIC })
  audience: Audience;

  @Column('smallint', { default: PostStatus.ACTIVE })
  status: PostStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(
    () => PostStat,
    (postStat) => postStat.post,
    { cascade: true, eager: true },
  )
  postStat: PostStat;

  @OneToMany(() => Share, (shares) => shares.post)
  shares: Share[];

  @OneToMany(() => EditHistory, (editHistories) => editHistories.post)
  editHistories: EditHistory[];

  @OneToMany(() => Report, (reports) => reports.post)
  reports: Report[];
}