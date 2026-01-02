import { JoinRequestStatus } from '@repo/dtos';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AuditableEntity } from './auditable.entity';
import { Group } from './group.entity';

@Entity('group_join_requests')
export class GroupJoinRequest extends AuditableEntity {
  @Column({ type: 'varchar', name: 'user_id', nullable: false })
  userId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({
    type: 'enum',
    enum: JoinRequestStatus,
    default: JoinRequestStatus.PENDING,
  })
  status: JoinRequestStatus;

  @ManyToOne(() => Group, (group) => group.groupJoinRequests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
