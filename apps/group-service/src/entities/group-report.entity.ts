import { Column, Entity, ManyToOne, Unique } from 'typeorm';
import { Group } from './group.entity';
import { BaseEntity } from './base.entity';
import { ReportStatus } from '@repo/dtos';

@Entity()
@Unique(['reporterId', 'groupId'])
export class GroupReport extends BaseEntity {
  @Column({
    type: 'varchar',
    name: 'reporter_id',
    nullable: false,
  })
  reporterId: string;

  @Column({ type: 'uuid', name: 'group_id', nullable: false })
  groupId: string;

  @Column({ type: 'text', name: 'reason', nullable: true })
  reason: string;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.PENDING })
  status: ReportStatus;

  @ManyToOne(() => Group, (group) => group.groupReports, {
    onDelete: 'CASCADE',
  })
  group: Group;
}
