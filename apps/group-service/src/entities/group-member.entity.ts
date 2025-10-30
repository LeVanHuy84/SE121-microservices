import { GroupMemberStatus, GroupRole } from '@repo/dtos';
import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Group } from './group.entity';

@Entity('group_members')
export class GroupMember extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'enum', enum: GroupRole, default: GroupRole.MEMBER })
  role: GroupRole;

  @Column({
    type: 'enum',
    enum: GroupMemberStatus,
    default: GroupMemberStatus.ACTIVE,
  })
  status: GroupMemberStatus;

  @ManyToOne(() => Group, (group) => group.groupMembers, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
