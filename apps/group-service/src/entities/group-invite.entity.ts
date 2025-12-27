import { InviteStatus } from '@repo/dtos';
import { Column, Entity, ManyToOne } from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Group } from './group.entity';

@Entity('group_invites')
export class GroupInvite extends AuditableEntity {
  @Column({ type: 'varchar', name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'varchar', name: 'inviter_id', nullable: false })
  inviterId: string;

  @Column({ type: 'varchar', name: 'invitee_id ', nullable: false })
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

  @ManyToOne(() => Group, (group) => group.groupInvites, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
