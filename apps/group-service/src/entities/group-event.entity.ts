import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GroupEventLog } from '@repo/dtos';
import { Group } from './group.entity';

@Entity('group_events')
export class GroupEvent extends BaseEntity {
  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId: string;

  @Column({
    type: 'enum',
    enum: GroupEventLog,
    name: 'event_type',
    nullable: false,
  })
  eventType: GroupEventLog;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Object;

  @ManyToOne(() => Group, (group) => group.groupEvents, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
