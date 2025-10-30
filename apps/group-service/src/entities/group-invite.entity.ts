import { InviteStatus } from '@repo/dtos';
import { Column, Entity, ManyToOne } from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Group } from './group.entity';

@Entity('group_invites')
export class GroupInvite extends AuditableEntity {
  @Column({ type: 'uuid', name: 'inviter_id', nullable: false })
  inviterId: string;

  @Column({ type: 'uuid', name: 'invitee_id', nullable: false })
  inviteeId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'enum', enum: InviteStatus, default: InviteStatus.PENDING })
  status: InviteStatus;

  @ManyToOne(() => Group, (group) => group.groupInvites, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
