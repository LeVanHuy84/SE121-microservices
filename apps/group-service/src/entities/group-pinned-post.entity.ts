import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Group } from './group.entity';

@Entity()
export class GroupPinnedPost extends BaseEntity {
  @Column({ type: 'uuid', name: 'post_id', nullable: false })
  postId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId: string;

  @ManyToOne(() => Group, (group) => group.groupPinnedPosts, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
