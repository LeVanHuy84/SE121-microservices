import { GroupMemberStatus, GroupPermission, GroupRole } from '@repo/dtos';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Group } from './group.entity';

@Entity('group_members')
export class GroupMember extends BaseEntity {
  @Column({ type: 'varchar', name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'enum', enum: GroupRole, default: GroupRole.MEMBER })
  role: GroupRole;

  @Column({ type: 'jsonb', nullable: true })
  customPermissions?: GroupPermission[];

  @Column({
    type: 'enum',
    enum: GroupMemberStatus,
    default: GroupMemberStatus.ACTIVE,
  })
  status: GroupMemberStatus;

  @ManyToOne(() => Group, (group) => group.groupMembers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
