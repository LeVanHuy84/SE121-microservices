import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Comment } from "./comment.entity";
import { Share } from "./share.entity";
import { EditHisstory } from "./edit-history.entity";
import { Report } from "./report.entity";
import { Audience, Feeling, MediaDto, PostStatus, StatsDto } from "@repo/dtos";

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

  @Column({
    type: 'jsonb',
    default: () => `'
        {
          "totalReactions": 0,
          "reactions": {
            "like": 0,
            "love": 0,
            "haha": 0,
            "wow": 0,
            "angry": 0,
            "sad": 0
          },
          "comments": 0,
          "shares": 0
        }
      '`,
  })
  stats: StatsDto;

  @Column('smallint', { default: PostStatus.ACTIVE })
  status: PostStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Comment, (comments) => comments.post)
  comments: Comment[];

  @OneToMany(() => Share, (shares) => shares.post)
  shares: Share[];

  @OneToMany(() => EditHisstory, (editHistories) => editHistories.post)
  editHistories: EditHisstory[];

  @OneToMany(() => Report, (reports) => reports.post)
  reports: Report[];
}