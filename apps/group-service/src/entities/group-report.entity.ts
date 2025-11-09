import { Column, Entity, ManyToOne } from 'typeorm';
import { GroupTargetReportType } from '@repo/dtos';
import { AuditableEntity } from './auditable.entity';
import { Group } from './group.entity';

@Entity()
export class GroupReport extends AuditableEntity {
  @Column({ type: 'varchar', name: 'reporter_id', nullable: false })
  reporterId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({
    type: 'enum',
    enum: GroupTargetReportType,
    name: 'target_type',
    nullable: false,
  })
  target_type: GroupTargetReportType;

  @Column({ type: 'varchar', name: 'target_id', nullable: false })
  targetId: string;

  @Column({ type: 'text', name: 'reason', nullable: true })
  reason: string;

  @ManyToOne(() => Group, (group) => group.groupReports, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
