import { PostGroupStatus } from '@repo/dtos';
import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Post } from './post.entity';

@Entity('post_group_infos')
export class PostGroupInfo {
  @PrimaryColumn('uuid', { name: 'post_id' })
  postId: string;

  @OneToOne(() => Post, (post) => post.postGroupInfo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;

  @Column({
    type: 'enum',
    enum: PostGroupStatus,
    default: PostGroupStatus.PENDING,
  })
  status: PostGroupStatus;

  @Column('boolean', { name: 'is_private_group', default: false })
  isPrivateGroup: boolean;
}
