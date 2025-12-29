import { InviteStatus } from '@repo/dtos';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { Group } from './group.entity';
import { BaseEntity } from './base.entity';

@Entity('group_invites')
export class GroupInvite extends BaseEntity {
  @Column({
    type: 'text',
    array: true,
    name: 'inviters',
    nullable: true,
  })
  inviters: string[];

  @Column({ type: 'varchar', name: 'invitee_id', nullable: false })
  inviteeId: string;

  @Column({
    type: 'enum',
    enum: InviteStatus,
    default: InviteStatus.PENDING,
  })
  status: InviteStatus;

  @Column({
    name: 'expired_at',
    type: 'timestamptz',
    nullable: true,
    default: () => "now() + interval '7 days'",
  })
  expiredAt: Date;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @ManyToOne(() => Group, (group) => group.groupInvites, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
