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

@Entity('posts')
@Index('idx_posts_userid_createdat', ['userId', 'createdAt'])
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id', nullable: false })
  userId: string;

  @Column('uuid', { name: 'group_id', nullable: true })
  groupId: string;

  @Column('smallint', { nullable: true })
  feeling: Emotion;

  @Column({ type: 'varchar', length: 10000 })
  content: string;

  @Column('jsonb', { nullable: true })
  media: MediaItemDTO[];

  @Column('smallint', { default: Audience.PUBLIC })
  audience: Audience;

  @Column('smallint', { nullable: true })
  mainEmotion: Emotion;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => PostStat, (postStat) => postStat.post, {
    cascade: true,
  })
  postStat: PostStat;

  @OneToMany(() => Share, (shares) => shares.post)
  shares: Share[];

  @OneToMany(() => EditHistory, (editHistories) => editHistories.post)
  editHistories: EditHistory[];
}
