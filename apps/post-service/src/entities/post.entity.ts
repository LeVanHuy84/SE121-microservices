import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Share } from './share.entity';
import { EditHistory } from './edit-history.entity';
import { Audience, Emotion, MediaItemDTO } from '@repo/dtos';
import { PostStat } from './post-stat.entity';
import { PostGroupInfo } from './post-group-info.entity';

@Entity('posts')
@Index('idx_posts_userid_createdat', ['userId', 'createdAt'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { name: 'user_id', nullable: false })
  userId: string;

  @Column('uuid', { name: 'group_id', nullable: true })
  groupId: string;

  @Column({ type: 'enum', enum: Emotion, nullable: true })
  feeling: Emotion;

  @Column({ type: 'varchar', length: 10000 })
  content: string;

  @Column('jsonb', { nullable: true })
  media: MediaItemDTO[];

  @Column({ type: 'enum', enum: Audience, default: Audience.PUBLIC })
  audience: Audience;

  @Column({ type: 'enum', enum: Emotion, nullable: true })
  mainEmotion: Emotion;

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

  @OneToOne(() => PostStat, (postStat) => postStat.post, {
    cascade: true,
  })
  postStat: PostStat;

  @OneToOne(() => PostGroupInfo, (postGroupInfo) => postGroupInfo.post, {
    cascade: true,
  })
  postGroupInfo: PostGroupInfo;

  @OneToMany(() => Share, (shares) => shares.post)
  shares: Share[];

  @OneToMany(() => EditHistory, (editHistories) => editHistories.post)
  editHistories: EditHistory[];
}
