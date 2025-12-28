import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { GroupEventLog } from '@repo/dtos';
import { Group } from './group.entity';

@Entity('group_logs')
export class GroupLog extends BaseEntity {
  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'varchar', name: 'user_id', nullable: false })
  userId: string;

  @Column({
    type: 'enum',
    enum: GroupEventLog,
    name: 'event_type',
    nullable: false,
  })
  eventType: GroupEventLog;

  @Column({ type: 'text', nullable: true })
  content: string;

  @ManyToOne(() => Group, (group) => group.groupLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'group_id' })
  group: Group;
}
